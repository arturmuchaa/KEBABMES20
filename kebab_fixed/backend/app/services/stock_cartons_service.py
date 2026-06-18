"""Karton magazynowy = jednostka pakowa BEZ zamówienia.

Biuro tworzy karton (spec + carton_no). Magazynier skanuje WYPRODUKOWANE sztuki
do kartonu (finished_units.carton_id). Później karton można powiązać z zamówieniem.
Sztuki pochodzą z realnej produkcji — pełna traceability co do sztuki.
"""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.production import StockCartonCreate, StockCartonLineDto
from app.utils.ids import cuid, format_carton_no, next_seq, now_iso
from app.utils.unit_codes import parse_unit_qr

logger = get_logger(__name__)


def _kg(v: Any) -> float:
    return round(float(v or 0), 3)


def pick_line_for_unit(unit: Dict[str, Any], lines: List[Dict[str, Any]]):
    """Pierwsza pozycja kartonu z wolnym miejscem, zgodna ze specyfikacją sztuki
    (receptura + rodzaj + tuleja==packaging_name + waga). Sztuka nie ma packaging_id,
    więc tuleję dopasowujemy po nazwie."""
    for ln in lines:
        if int(ln.get("packed_qty") or 0) >= int(ln.get("target_qty") or 0):
            continue
        if (unit.get("recipe_id") or "") != (ln.get("recipe_id") or ""):
            continue
        if (unit.get("product_type_id") or "") != (ln.get("product_type_id") or ""):
            continue
        if (unit.get("tuleja") or "") != (ln.get("packaging_name") or ""):
            continue
        if _kg(unit.get("weight_kg")) != _kg(ln.get("kg_per_unit")):
            continue
        return ln
    return None


def _lines_from_dto(dto: StockCartonCreate) -> List[StockCartonLineDto]:
    """Pozycje z DTO; wstecznie: pojedynczy spec → jedna pozycja."""
    lines = list(getattr(dto, "lines", None) or [])
    if lines:
        return lines
    return [StockCartonLineDto(
        recipe_id=dto.recipe_id, recipe_name=dto.recipe_name or "",
        product_type_id=dto.product_type_id, product_type_name=dto.product_type_name or "",
        packaging_id=dto.packaging_id or "", packaging_name=dto.packaging_name or "",
        kg_per_unit=float(dto.kg_per_unit), qty=int(dto.qty),
    )]


def _line_signature(lines: List[StockCartonLineDto]):
    """Sygnatura składu (do dedupu) niezależna od kolejności pozycji."""
    return sorted((l.recipe_id or "", l.product_type_id or "", l.packaging_id or "",
                   _kg(l.kg_per_unit), int(l.qty)) for l in lines)


def create_stock_carton(dto: StockCartonCreate) -> Dict:
    """Utwórz karton magazynowy (nagłówek + pozycje) z globalnym numerem.

    Skład mieszany: lista pozycji (rodzaj+receptura+tuleja+waga+ilość) dla jednego
    klienta. Blokada duplikatu: otwarty, niepowiązany karton tego klienta o
    identycznym ZESTAWIE pozycji — najpierw trzeba go spakować.
    """
    lines = _lines_from_dto(dto)
    if not lines:
        raise HTTPException(400, "Karton musi mieć co najmniej jedną pozycję")
    sig = _line_signature(lines)
    with transaction() as conn:
        candidates = cx_query_all(
            conn,
            """SELECT id, carton_no FROM stock_cartons
               WHERE status='open' AND linked_order_id IS NULL
                 AND COALESCE(client_id,'')=%s""",
            (dto.client_id,),
        )
        for cand in candidates:
            cl = cx_query_all(
                conn,
                "SELECT recipe_id, product_type_id, packaging_id, kg_per_unit, target_qty "
                "FROM stock_carton_lines WHERE carton_id=%s",
                (cand["id"],),
            )
            cand_sig = sorted((r.get("recipe_id") or "", r.get("product_type_id") or "",
                               r.get("packaging_id") or "", _kg(r.get("kg_per_unit")),
                               int(r.get("target_qty") or 0)) for r in cl)
            if cand_sig == sig:
                raise HTTPException(
                    409,
                    f"Taki karton już istnieje (nr {format_carton_no(cand['carton_no'])}) "
                    "— najpierw go spakuj",
                )
        carton_no = next_seq("carton_seq")
        total_qty = sum(int(l.qty) for l in lines)
        row = cx_query_one(
            conn,
            """
            INSERT INTO stock_cartons
                (id, carton_no, client_id, client_name, kg_per_unit, target_qty,
                 packed_qty, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,0,'open',%s)
            RETURNING *
            """,
            (cuid(), carton_no, dto.client_id, dto.client_name or "",
             _kg(lines[0].kg_per_unit), total_qty, now_iso()),
        )
        for l in lines:
            cx_execute(
                conn,
                """INSERT INTO stock_carton_lines
                     (id, carton_id, recipe_id, recipe_name, product_type_id, product_type_name,
                      packaging_id, packaging_name, kg_per_unit, target_qty, packed_qty)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0)""",
                (cuid(), row["id"], l.recipe_id or "", l.recipe_name or "",
                 l.product_type_id or "", l.product_type_name or "",
                 l.packaging_id or "", l.packaging_name or "",
                 _kg(l.kg_per_unit), int(l.qty)),
            )
    logger.info("stock_cartons.created",
                extra={"carton_no": carton_no, "target_qty": total_qty, "n_lines": len(lines)})
    return row


def scan_unit_into_carton(carton_id: str, code: str) -> Dict[str, Any]:
    """Skan WYPRODUKOWANEJ sztuki do kartonu. Walidacja zgodności specyfikacji
    + stanu sztuki; sukces ustawia carton_id, status='packed', inkrementuje karton."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        carton = cx_query_one(
            conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (carton_id,)
        )
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        lines = cx_query_all(
            conn,
            "SELECT * FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit",
            (carton_id,),
        )
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")
        # Idempotencja (retry/dubel z kolejki offline): sztuka już w TYM kartonie
        # → zwróć OK bez podwajania.
        if unit.get("carton_id") == carton_id:
            agg = cx_query_one(
                conn,
                "SELECT COALESCE(SUM(packed_qty),0) AS p, COALESCE(SUM(target_qty),0) AS t "
                "FROM stock_carton_lines WHERE carton_id=%s",
                (carton_id,),
            )
            return {
                "ok": True,
                "cartonNo": format_carton_no(carton["carton_no"]),
                "packedQty": int(agg["p"]),
                "targetQty": int(agg["t"]),
                "full": int(agg["p"]) >= int(agg["t"]),
                "batchNo": unit.get("batch_no") or "",
            }
        if unit.get("status") != "produced":
            raise HTTPException(
                409,
                f"Sztuka musi być wyprodukowana (status {unit.get('status')}) — "
                "najpierw skan produkcji",
            )
        if unit.get("carton_id"):
            raise HTTPException(409, "Sztuka jest już w innym kartonie")
        # Dopasuj sztukę do pozycji kartonu z wolnym miejscem (skład mieszany).
        line = pick_line_for_unit(unit, lines)
        if line is None:
            raise HTTPException(
                409,
                "Brak wolnej pozycji kartonu dla tej sztuki "
                "(niezgodna receptura/rodzaj/tuleja/waga albo pozycja pełna)",
            )
        cx_execute(
            conn,
            "UPDATE finished_units SET carton_id=%s, status='packed' WHERE id=%s",
            (carton_id, unit_id),
        )
        cx_execute(
            conn,
            "UPDATE stock_carton_lines SET packed_qty=packed_qty+1 WHERE id=%s",
            (line["id"],),
        )
        agg = cx_query_one(
            conn,
            "SELECT COALESCE(SUM(packed_qty),0) AS p, COALESCE(SUM(target_qty),0) AS t "
            "FROM stock_carton_lines WHERE carton_id=%s",
            (carton_id,),
        )
        new_packed, target = int(agg["p"]), int(agg["t"])
        full = new_packed >= target
        cx_execute(
            conn,
            "UPDATE stock_cartons SET packed_qty=%s, status=%s, closed_at=%s WHERE id=%s",
            (new_packed, "packed" if full else "open",
             now_iso() if full else None, carton_id),
        )
    return {
        "ok": True,
        "cartonNo": format_carton_no(carton["carton_no"]),
        "packedQty": new_packed,
        "targetQty": target,
        "full": full,
        "batchNo": unit.get("batch_no") or "",
    }


def assign_carton_to_order(carton_id: str, order_id: str) -> Dict:
    """Powiąż karton magazynowy z zamówieniem (Faza 2). Waliduje klienta,
    ustawia linked_order, stempluje order_id na sztukach kartonu."""
    with transaction() as conn:
        carton = cx_query_one(
            conn, "SELECT * FROM stock_cartons WHERE id=%s FOR UPDATE", (carton_id,)
        )
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        if carton.get("linked_order_id"):
            raise HTTPException(409, "Karton jest już powiązany z zamówieniem")
        packed = cx_query_one(
            conn,
            "SELECT COALESCE(SUM(packed_qty),0) AS p FROM stock_carton_lines WHERE carton_id=%s",
            (carton_id,),
        )
        if int(packed["p"]) <= 0:
            raise HTTPException(409, "Karton jest pusty — najpierw spakuj sztuki")
        order = cx_query_one(
            conn, "SELECT id, order_no, client_id FROM client_orders WHERE id=%s",
            (order_id,),
        )
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        if (carton.get("client_id") or "") != (order.get("client_id") or ""):
            raise HTTPException(409, "Karton należy do innego klienta niż zamówienie")
        cx_execute(
            conn,
            "UPDATE stock_cartons SET linked_order_id=%s, linked_order_no=%s WHERE id=%s",
            (order["id"], order["order_no"], carton_id),
        )
        cx_execute(
            conn,
            "UPDATE finished_units SET order_id=%s WHERE carton_id=%s",
            (order["id"], carton_id),
        )
    logger.info("stock_cartons.assigned",
                extra={"carton_id": carton_id, "order_id": order_id})
    return {"ok": True, "cartonId": carton_id, "orderNo": order["order_no"]}


def _eligible_for_spec(recipe_id, product_type_id, packaging_name, kg) -> List[Dict]:
    rows = query_all(
        """
        SELECT qr_code, batch_no FROM finished_units
        WHERE status='produced' AND carton_id IS NULL
          AND COALESCE(recipe_id,'')=%s AND COALESCE(product_type_id,'')=%s
          AND COALESCE(tuleja,'')=%s AND weight_kg=%s
        ORDER BY batch_no, qr_seq
        """,
        (recipe_id or "", product_type_id or "", packaging_name or "", _kg(kg)),
    )
    return [{"code": r["qr_code"], "batchNo": r.get("batch_no") or ""} for r in rows]


def eligible_units_for_line(line_id: str) -> List[Dict]:
    """Sztuki uprawnione do TEJ pozycji kartonu (produced, niespakowane, zgodna spec)."""
    line = query_one("SELECT * FROM stock_carton_lines WHERE id=%s", (line_id,))
    if not line:
        raise HTTPException(404, "Pozycja kartonu nie znaleziona")
    return _eligible_for_spec(line.get("recipe_id"), line.get("product_type_id"),
                              line.get("packaging_name"), line.get("kg_per_unit"))


def add_units_to_carton_line(carton_id: str, line_id: str, qty: int) -> Dict:
    """Biuro: dorzuć do `qty` uprawnionych sztuk (FIFO po partii) do pozycji —
    przez tę samą operację co skan na hali (pełna walidacja + traceability)."""
    codes = [u["code"] for u in eligible_units_for_line(line_id)]
    added = 0
    for code in codes[: max(0, int(qty))]:
        scan_unit_into_carton(carton_id, code)
        added += 1
    return {"ok": True, "added": added}


def eligible_units_for_carton(carton_id: str) -> List[Dict]:
    """Sztuki uprawnione do kartonu (suma po pozycjach z wolnym miejscem) — do
    walidacji lokalnej offline. Bez duplikatów kodów."""
    carton = query_one("SELECT id FROM stock_cartons WHERE id=%s", (carton_id,))
    if not carton:
        raise HTTPException(404, "Karton nie znaleziony")
    lines = query_all(
        "SELECT recipe_id, product_type_id, packaging_name, kg_per_unit "
        "FROM stock_carton_lines WHERE carton_id=%s AND packed_qty < target_qty",
        (carton_id,),
    )
    out: List[Dict] = []
    seen = set()
    for ln in lines:
        for u in _eligible_for_spec(ln.get("recipe_id"), ln.get("product_type_id"),
                                    ln.get("packaging_name"), ln.get("kg_per_unit")):
            if u["code"] not in seen:
                seen.add(u["code"])
                out.append(u)
    return out


def _carton_lines(carton_id: str) -> List[Dict]:
    return query_all(
        "SELECT id, recipe_id, recipe_name, product_type_id, product_type_name, "
        "       packaging_id, packaging_name, kg_per_unit, target_qty, packed_qty "
        "FROM stock_carton_lines WHERE carton_id=%s ORDER BY kg_per_unit",
        (carton_id,),
    )


def _attach_lines(row: Dict) -> Dict:
    row["lines"] = _carton_lines(row["id"])
    return row


def get_carton(carton_id: str) -> Dict:
    row = query_one("SELECT * FROM stock_cartons WHERE id=%s", (carton_id,))
    if not row:
        raise HTTPException(404, "Karton nie znaleziony")
    return _attach_lines(row)


def list_open_cartons() -> List[Dict]:
    rows = query_all(
        "SELECT * FROM stock_cartons WHERE status='open' ORDER BY carton_no"
    )
    return [_attach_lines(r) for r in rows]


def list_cartons() -> List[Dict]:
    """Wszystkie kartony do sekcji „Spakowane kebaby" — ze statusem. Kartony,
    których sztuki w całości wyjechały (wydane), znikają z listy."""
    rows = query_all(
        """
        SELECT sc.*,
               (SELECT count(*) FROM finished_units fu
                 WHERE fu.carton_id = sc.id AND fu.status='shipped') AS shipped_qty
        FROM stock_cartons sc
        ORDER BY sc.carton_no DESC
        """,
    )
    out: List[Dict] = []
    for r in rows:
        packed = int(r.get("packed_qty") or 0)
        shipped = int(r.get("shipped_qty") or 0)
        if packed > 0 and shipped >= packed:
            continue  # wyjechało → znika
        out.append(_attach_lines(r))
    return out
