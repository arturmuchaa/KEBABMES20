"""Karton magazynowy = jednostka pakowa BEZ zamówienia.

Biuro tworzy karton (spec + carton_no). Magazynier skanuje WYPRODUKOWANE sztuki
do kartonu (finished_units.carton_id). Później karton można powiązać z zamówieniem.
Sztuki pochodzą z realnej produkcji — pełna traceability co do sztuki.
"""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.production import StockCartonCreate
from app.utils.ids import cuid, format_carton_no, next_seq, now_iso
from app.utils.unit_codes import parse_unit_qr

logger = get_logger(__name__)


def _kg(v: Any) -> float:
    return round(float(v or 0), 3)


def create_stock_carton(dto: StockCartonCreate) -> Dict:
    """Utwórz pusty karton magazynowy (status open) z globalnym numerem.

    Blokada duplikatu: jeśli istnieje już OTWARTY karton o tym samym składzie
    (klient+receptura+rodzaj+tuleja+waga), nie pozwalamy utworzyć kolejnego —
    najpierw trzeba go spakować (inaczej mnożyłyby się puste, identyczne kartony).
    """
    with transaction() as conn:
        dup = cx_query_one(
            conn,
            """
            SELECT carton_no FROM stock_cartons
            WHERE status='open' AND linked_order_id IS NULL
              AND COALESCE(client_id,'')=%s AND COALESCE(recipe_id,'')=%s
              AND COALESCE(product_type_id,'')=%s AND COALESCE(packaging_id,'')=%s
              AND kg_per_unit=%s
            LIMIT 1
            """,
            (dto.client_id, dto.recipe_id or "", dto.product_type_id or "",
             dto.packaging_id or "", float(dto.kg_per_unit)),
        )
        if dup:
            raise HTTPException(
                409,
                f"Taki karton już istnieje (nr {format_carton_no(dup['carton_no'])}) "
                "— najpierw go spakuj",
            )
        carton_no = next_seq("carton_seq")
        row = cx_query_one(
            conn,
            """
            INSERT INTO stock_cartons
                (id, carton_no, client_id, client_name, recipe_id, recipe_name,
                 product_type_id, product_type_name, packaging_id, packaging_name,
                 kg_per_unit, target_qty, packed_qty, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,'open',%s)
            RETURNING *
            """,
            (
                cuid(), carton_no, dto.client_id, dto.client_name or "",
                dto.recipe_id or "", dto.recipe_name or "",
                dto.product_type_id or "", dto.product_type_name or "",
                dto.packaging_id or "", dto.packaging_name or "",
                float(dto.kg_per_unit), int(dto.qty), now_iso(),
            ),
        )
    logger.info("stock_cartons.created",
                extra={"id": row["id"], "carton_no": carton_no, "target_qty": dto.qty})
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
        if int(carton["packed_qty"]) >= int(carton["target_qty"]):
            raise HTTPException(409, "Karton jest pełny")
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")
        if unit.get("status") != "produced":
            raise HTTPException(
                409,
                f"Sztuka musi być wyprodukowana (status {unit.get('status')}) — "
                "najpierw skan produkcji",
            )
        if unit.get("carton_id"):
            raise HTTPException(409, "Sztuka jest już w innym kartonie")
        # Zgodność fizyczna: receptura + rodzaj + tuleja + waga sztuki.
        if (unit.get("recipe_id") or "") != (carton.get("recipe_id") or ""):
            raise HTTPException(409, "Sztuka ma inną recepturę niż karton")
        if (unit.get("product_type_id") or "") != (carton.get("product_type_id") or ""):
            raise HTTPException(409, "Sztuka ma inny rodzaj niż karton")
        if (unit.get("tuleja") or "") != (carton.get("packaging_name") or ""):
            raise HTTPException(409, "Sztuka ma inną tuleję niż karton")
        if _kg(unit.get("weight_kg")) != _kg(carton.get("kg_per_unit")):
            raise HTTPException(409, "Sztuka ma inną wagę niż karton")

        cx_execute(
            conn,
            "UPDATE finished_units SET carton_id=%s, status='packed' WHERE id=%s",
            (carton_id, unit_id),
        )
        new_packed = int(carton["packed_qty"]) + 1
        full = new_packed >= int(carton["target_qty"])
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
        "targetQty": int(carton["target_qty"]),
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


def get_carton(carton_id: str) -> Dict:
    row = query_one("SELECT * FROM stock_cartons WHERE id=%s", (carton_id,))
    if not row:
        raise HTTPException(404, "Karton nie znaleziony")
    return row


def list_open_cartons() -> List[Dict]:
    return query_all(
        "SELECT * FROM stock_cartons WHERE status='open' ORDER BY carton_no"
    )


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
        out.append(r)
    return out
