"""Dokument WZ (Wydanie Zewnętrzne) — numeracja, budowa pozycji, generowanie.

Wzorzec jak HDI: numer WZ/NN/MM/RR z MAX(seq) per year_month, idempotencja
per (source_type, source_id), druk przez headless Chrome.
"""
import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.services.settings_service import get_company
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def format_wz_number(seq: int, year_month: str) -> str:
    # year_month = "RRMM" (np. "2606"); numer = WZ/NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"WZ/{seq}/{mm}/{yy}"


def build_wz_lines(items: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Zbuduj pozycje WZ. valued=True → cena + wartość.

    Pozycje z kg_per_unit (wyroby gotowe) są wyceniane ZA KG:
    total_kg = qty * kg_per_unit, value = total_kg * price.
    Pozycje bez kg_per_unit liczą się po staremu: value = qty * price.
    """
    lines: List[Dict[str, Any]] = []
    total = 0.0
    for it in items or []:
        qty = float(it.get("qty") or 0)
        kg_per_unit = float(it.get("kg_per_unit") or 0)
        line: Dict[str, Any] = {
            "name": it.get("name") or "",
            "qty": round(qty, 3),
            "unit": it.get("unit") or "kg",
            "batch_no": it.get("batch_no"),
            "price": None,
            "value": None,
        }
        if kg_per_unit > 0:
            line["kg_per_unit"] = round(kg_per_unit, 3)
            line["total_kg"] = round(qty * kg_per_unit, 3)
        if valued:
            price = float(it.get("price") or 0)
            base = line.get("total_kg") if kg_per_unit > 0 else qty
            value = round(float(base) * price, 2)
            line["price"] = round(price, 2)
            line["value"] = value
            total += value
        lines.append(line)
    return lines, round(total, 2)


def build_manual_wz_lines(selections: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Mapuje wybór magazynu na pozycje WZ (reużywa build_wz_lines) i dokleja
    ślad magazynowy (stock_type/stock_id) do każdej pozycji."""
    items = [
        {"name": s.get("name"), "qty": s.get("qty"), "unit": s.get("unit"),
         "price": s.get("price"), "batch_no": s.get("batch_no"),
         "kg_per_unit": s.get("kg_per_unit")}
        for s in (selections or [])
    ]
    lines, total = build_wz_lines(items, valued)
    for line, s in zip(lines, selections or []):
        line["stock_type"] = s.get("stock_type")
        line["stock_id"] = s.get("stock_id")
    return lines, total


def build_goods_wz_lines(goods_with_counts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pozycje WZ z wydania po twardym linku sztuka→wyrób: jedna linia per
    finished_goods. batch_no = pełna partia WYROBU (format "ddmmrr partia",
    jak na etykiecie i HDI). kg_per_unit/total_kg dołączone, żeby późniejsze
    uzupełnienie cen liczyło ZA KG (apply_wz_prices). Bez cen (WZ wstępny).

    goods_with_counts: [{"goods": wiersz finished_goods, "count": szt}]
    """
    lines: List[Dict[str, Any]] = []
    for g in goods_with_counts or []:
        fg = g.get("goods") or {}
        count = int(g.get("count") or 0)
        kgpu = float(fg.get("kg_per_unit") or 0)
        line: Dict[str, Any] = {
            "name": fg.get("recipe_name") or fg.get("product_type_name") or "Kebab",
            "qty": count,
            "unit": "szt",
            "batch_no": fg.get("batch_no"),
            "price": None,
            "value": None,
            "stock_type": "fg",
            "stock_id": fg.get("id"),
        }
        if kgpu > 0:
            line["kg_per_unit"] = round(kgpu, 3)
            line["total_kg"] = round(count * kgpu, 3)
        lines.append(line)
    lines.sort(key=lambda l: (l["name"], l["batch_no"] or ""))
    return lines


def is_foreign_nip(nip: Optional[str]) -> bool:
    """Klient zagraniczny, gdy NIP zaczyna się od dwóch liter różnych od 'PL'
    (np. DE, SK, AT). Czyste cyfry lub 'PL…' = krajowy. Puste = krajowy."""
    s = (nip or "").strip().upper()
    if len(s) < 2:
        return False
    prefix = s[:2]
    return prefix.isalpha() and prefix != "PL"


def should_reuse(existing: Optional[Dict], source_id: Optional[str]) -> bool:
    """WZ jest idempotentny per źródło: istniejący dokument dla danego
    (source_type, source_id) zwracamy ponownie. WZ ręczny (brak source_id)
    zawsze tworzy nowy dokument."""
    return bool(existing) and bool((source_id or "").strip())


def _seller_block() -> Dict[str, Any]:
    co = get_company()
    addr = f"{co.get('address','')}, {co.get('postal_code','')} {co.get('city','')}".strip(", ")
    return {
        "name": co.get("name", ""),
        "address": addr,
        "nip": co.get("nip", ""),
        "email": co.get("email", ""),
    }


def _insert_wz(conn, *, source_type, source_id, seller, buyer, valued, lines,
               total, place, issued, released, notes,
               currency: str = "PLN", eur_rate: Optional[float] = None) -> str:
    """Wstaw dokument WZ w trwającej transakcji, nadaj numer WZ/NN/MM/RR. Zwraca id."""
    today = date.today()
    ym = today.strftime("%y%m")  # RRMM
    seq_row = cx_query_one(
        conn, "SELECT COALESCE(MAX(seq),0)+1 AS n FROM wz_documents WHERE year_month=%s", (ym,))
    seq = int(seq_row["n"])
    number = format_wz_number(seq, ym)
    wid = cuid()
    cx_execute_returning(
        conn,
        """INSERT INTO wz_documents
           (id, number, seq, year_month, source_type, source_id, seller,
            buyer_name, buyer_address, buyer_nip, valued, lines, total_value,
            place, issued_date, release_date, status, notes, currency, eur_rate,
            created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s,%s,%s)
           RETURNING id""",
        (wid, number, seq, ym, source_type, source_id, json.dumps(seller),
         buyer.get("name"), buyer.get("address"), buyer.get("nip"), valued,
         json.dumps(lines), total, place, issued, released, notes,
         (currency or "PLN").upper(), eur_rate, now_iso()),
    )
    logger.info("wz.generated", extra={"wz_id": wid, "number": number})
    return wid


def generate_wz(
    source_type: Optional[str],
    source_id: Optional[str],
    buyer: Dict[str, Any],
    items: List[Dict[str, Any]],
    valued: bool = True,
    place: Optional[str] = None,
    issued_date: Optional[str] = None,
    release_date: Optional[str] = None,
    notes: str = "",
) -> Dict[str, Any]:
    if not items:
        raise HTTPException(400, "WZ wymaga co najmniej jednej pozycji")

    lines, total = build_wz_lines(items, valued)
    co = get_company()
    today = date.today()
    issued = issued_date or today.strftime("%d.%m.%Y")
    released = release_date or issued
    place_val = place or co.get("city") or ""
    seller = _seller_block()

    with transaction() as conn:
        existing = None
        if (source_id or "").strip():
            existing = cx_query_one(
                conn,
                "SELECT * FROM wz_documents WHERE source_type=%s AND source_id=%s "
                "ORDER BY created_at LIMIT 1",
                (source_type, source_id),
            )
        if should_reuse(existing, source_id):
            if existing["status"] == "wstepny":
                cx_execute_returning(
                    conn,
                    """UPDATE wz_documents SET buyer_name=%s, buyer_address=%s,
                       buyer_nip=%s, valued=%s, lines=%s, total_value=%s, place=%s,
                       issued_date=%s, release_date=%s, notes=%s WHERE id=%s RETURNING id""",
                    (buyer.get("name"), buyer.get("address"), buyer.get("nip"),
                     valued, json.dumps(lines), total, place_val, issued, released,
                     notes, existing["id"]),
                )
            logger.info("wz.reused", extra={"wz_id": existing["id"], "number": existing["number"]})
            return get_wz(existing["id"])

        wid = _insert_wz(
            conn, source_type=source_type, source_id=source_id, seller=seller,
            buyer=buyer, valued=valued, lines=lines, total=total, place=place_val,
            issued=issued, released=released, notes=notes)
    return get_wz(wid)


def create_manual_wz(
    buyer: Dict[str, Any],
    selections: List[Dict[str, Any]],
    valued: bool = True,
    place: Optional[str] = None,
    issued_date: Optional[str] = None,
    release_date: Optional[str] = None,
    notes: str = "",
    currency: str = "PLN",
    eur_rate: Optional[float] = None,
) -> Dict[str, Any]:
    """Ręczny WZ ze sprzedaży z magazynu. Atomowo: dokument WZ + rozchód
    (FG: szt, surowiec: kg). Brak stanu → 400 + rollback całości.

    currency: 'PLN' lub 'EUR'; przy EUR eur_rate = kurs średni NBP użyty
    do wyceny (zapisywany na dokumencie dla rozliczeń)."""
    if not selections:
        raise HTTPException(400, "WZ wymaga co najmniej jednej pozycji")

    lines, total = build_manual_wz_lines(selections, valued)
    co = get_company()
    today = date.today()
    issued = issued_date or today.strftime("%d.%m.%Y")
    released = release_date or issued
    place_val = place or co.get("city") or ""
    seller = _seller_block()

    with transaction() as conn:
        wid = _insert_wz(
            conn, source_type="manual", source_id=None, seller=seller,
            buyer=buyer, valued=valued, lines=lines, total=total, place=place_val,
            issued=issued, released=released, notes=notes,
            currency=currency, eur_rate=eur_rate)

        for sel in selections:
            stype = sel.get("stock_type")
            sid = sel.get("stock_id")
            qty = float(sel.get("qty") or 0)
            if qty <= 0:
                raise HTTPException(400, "Ilość pozycji musi być > 0")

            if stype == "fg":
                row = cx_query_one(
                    conn,
                    "SELECT id, batch_no, qty_available, kg_per_unit FROM finished_goods WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                need = int(qty)
                avail = int(row.get("qty_available") or 0)
                if avail < need:
                    raise HTTPException(
                        400, f"Za mało wyrobu (partia {row.get('batch_no')}): jest {avail} szt, potrzeba {need}")
                cx_execute(
                    conn,
                    "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                    (need, need, sid))
                create_stock_movement(
                    conn, product_type="finished_goods", batch_id=sid,
                    qty=need * float(row.get("kg_per_unit") or 0),
                    movement_type="OUT", source_type="wz", source_id=wid)

            elif stype == "raw":
                row = cx_query_one(
                    conn,
                    "SELECT id, internal_batch_no, kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                avail = float(row.get("kg_available") or 0)
                if avail + 1e-6 < qty:
                    raise HTTPException(
                        400, f"Za mało surowca (partia {row.get('internal_batch_no')}): jest {avail} kg, potrzeba {qty}")
                cx_execute(
                    conn,
                    "UPDATE raw_batches SET kg_available=GREATEST(0, kg_available-%s) WHERE id=%s",
                    (qty, sid))
                create_stock_movement(
                    conn, product_type="raw", batch_id=sid, qty=qty,
                    movement_type="OUT", source_type="wz", source_id=wid)
            else:
                raise HTTPException(400, f"Nieznany typ magazynu: {stype}")

    logger.info("wz.manual.created", extra={"wz_id": wid, "items": len(selections)})
    return get_wz(wid)


def apply_wz_prices(lines: List[Dict[str, Any]], prices: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float]:
    """Nałóż ceny [{index, price}] na kopię pozycji; przelicz wartość i sumę.
    Pozycje z total_kg wyceniane za kg (value=total_kg*price), pozostałe
    za jednostkę (value=qty*price). Indeksy spoza zakresu pomijane.
    Nie mutuje wejścia."""
    out = [dict(l) for l in (lines or [])]
    for p in prices or []:
        try:
            i = int(p.get("index"))
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(out):
            price = round(float(p.get("price") or 0), 2)
            total_kg = float(out[i].get("total_kg") or 0)
            base = total_kg if total_kg > 0 else float(out[i].get("qty") or 0)
            out[i]["price"] = price
            out[i]["value"] = round(base * price, 2)
    total = round(sum(float(l.get("value") or 0) for l in out), 2)
    return out, total


def update_wz_prices(wz_id: str, prices: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Uzupełnij ceny na WZ wstępnym: nadpisuje wskazane pozycje, valued=True,
    przelicza total_value. WZ potwierdzony → 409."""
    if not prices:
        raise HTTPException(400, "Brak cen do uzupełnienia")
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT id, status, lines FROM wz_documents WHERE id=%s FOR UPDATE", (wz_id,))
        if not row:
            raise HTTPException(404, "Dokument WZ nie istnieje")
        if row.get("status") != "wstepny":
            raise HTTPException(409, "Ceny można uzupełnić tylko na WZ wstępnym")
        lines = row.get("lines")
        if not isinstance(lines, list):
            lines = json.loads(lines or "[]")
        new_lines, total = apply_wz_prices(lines, prices)
        cx_execute(conn,
                   "UPDATE wz_documents SET lines=%s, total_value=%s, valued=TRUE WHERE id=%s",
                   (json.dumps(new_lines), total, wz_id))
    logger.info("wz.prices_updated", extra={"wz_id": wz_id, "total": total})
    return get_wz(wz_id)


def wz_order_incomplete(produced: int, ordered: int) -> bool:
    """Flaga „może brakować": zamówiono więcej, niż wyprodukowano."""
    return ordered > 0 and produced < ordered


def build_order_wz_lines(plan_lines: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Linie WZ z linii planu produkcji: pozycja per (receptura, partia) wg
    batch_allocation (fallback: seasoned_batch_no, jak w HDI). Ilościowe.
    Zwraca (linie, suma wyprodukowanych szt)."""
    agg: Dict[Tuple, int] = {}
    produced = 0
    for line in plan_lines or []:
        qty_done = int(line.get("qty_done") or 0)
        if qty_done <= 0:
            continue
        produced += qty_done
        name = (line.get("recipe_name") or line.get("product_type_name") or "Kebab").strip()
        rid = line.get("recipe_id")
        ba = line.get("batch_allocation") or {}
        alloc = ({bno: int((info or {}).get("pieces") or 0) for bno, info in ba.items()}
                 if isinstance(ba, dict) else {})
        if alloc and sum(alloc.values()) == qty_done:
            buckets = list(alloc.items())
        else:
            sbn = line.get("seasoned_batch_no")
            if not sbn:
                lst = line.get("seasoned_batch_nos") or []
                sbn = lst[0] if lst else ""
            buckets = [(sbn or "", qty_done)]
        for bno, pieces in buckets:
            if int(pieces) <= 0:
                continue
            key = (rid, name, bno)
            agg[key] = agg.get(key, 0) + int(pieces)
    lines = [
        {"name": name, "qty": qty, "unit": "szt", "batch_no": bno,
         "price": None, "value": None, "stock_type": "fg", "recipe_id": rid}
        for (rid, name, bno), qty in sorted(agg.items(), key=lambda kv: (kv[0][1], kv[0][2] or ""))
    ]
    return lines, produced


def create_wz_from_order(order_id: str) -> Dict[str, Any]:
    """WZ z zamówienia: pozycje z qty_done linii planu, rozchód FG, flaga
    incomplete. Idempotentny per (source_type='order', source_id=order_id)."""
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")

    # Plany anulowane nie liczą się do wydania (qty_done mógł zostać
    # wpisany na tablecie przed anulowaniem).
    plan_lines = query_all(
        """SELECT pl.qty_done, pl.recipe_id, pl.recipe_name, pl.product_type_name,
                  pl.batch_allocation, pl.seasoned_batch_no, pl.seasoned_batch_nos
           FROM production_plan_lines pl
           JOIN production_plans pp ON pp.id = pl.plan_id
           WHERE pl.client_order_id=%s AND COALESCE(pl.qty_done,0) > 0
             AND pp.status <> 'cancelled'""",
        (order_id,))
    lines, produced = build_order_wz_lines(plan_lines)
    if not lines:
        raise HTTPException(400, "Brak wyprodukowanych pozycji do WZ")

    ordered = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM client_order_lines WHERE order_id=%s", (order_id,))
    incomplete = wz_order_incomplete(produced, int((ordered or {}).get("q") or 0))

    # Klient jak w HDI: najpierw client_id, potem nazwa.
    client = None
    if order.get("client_id"):
        client = query_one("SELECT name, address, city, nip FROM clients WHERE id=%s",
                           (order.get("client_id"),))
    if not client:
        client = query_one("SELECT name, address, city, nip FROM clients WHERE name=%s",
                           (order.get("client_name"),))
    client = client or {}
    buyer = {"name": client.get("name") or order.get("client_name") or "",
             "address": f"{client.get('address') or ''} {client.get('city') or ''}".strip(),
             "nip": client.get("nip") or ""}

    issued = date.today().strftime("%d.%m.%Y")
    notes = "UWAGA: zamówienie zrealizowane częściowo — może brakować sztuk." if incomplete else ""

    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT id FROM wz_documents WHERE source_type='order' AND source_id=%s "
                  "ORDER BY created_at LIMIT 1", (order_id,))
        if existing:
            doc = get_wz(existing["id"])
            doc["incomplete"] = incomplete
            logger.info("wz.order.reused", extra={"wz_id": existing["id"]})
            return doc

        wid = _insert_wz(
            conn, source_type="order", source_id=order_id, seller=_seller_block(),
            buyer=buyer, valued=False, lines=lines, total=0.0,
            place=get_company().get("city") or "", issued=issued, released=issued,
            notes=notes)

        for ln in lines:
            need = int(ln["qty"])
            if need <= 0:
                continue
            sql = ("SELECT id, qty_available, kg_per_unit FROM finished_goods "
                   "WHERE batch_no=%s")
            params: List[Any] = [ln.get("batch_no")]
            if ln.get("recipe_id"):
                sql += " AND recipe_id=%s"
                params.append(ln["recipe_id"])
            sql += " ORDER BY (COALESCE(client_name,'')='') DESC, qty_available DESC FOR UPDATE"
            rows = cx_query_all(conn, sql, tuple(params))
            for row in rows:
                take = min(need, max(0, int(row.get("qty_available") or 0)))
                if take > 0:
                    cx_execute(
                        conn,
                        "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                        (take, take, row["id"]))
                    create_stock_movement(
                        conn, product_type="finished_goods", batch_id=row["id"],
                        qty=take * float(row.get("kg_per_unit") or 0),
                        movement_type="OUT", source_type="wz", source_id=wid)
                    need -= take
                if need == 0:
                    break
            if need > 0:
                raise HTTPException(
                    400, f"Za mało na stanie wyrobów dla partii {ln.get('batch_no')} (brakuje {need} szt)")

    logger.info("wz.order.created", extra={"wz_id": wid, "order_id": order_id, "wz_incomplete": incomplete})
    doc = get_wz(wid)
    doc["incomplete"] = incomplete
    return doc


def get_wz(wz_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM wz_documents WHERE id=%s", (wz_id,))
    if not row:
        raise HTTPException(404, "Dokument WZ nie istnieje")
    return row


def list_wz() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, buyer_name, total_value, valued, status, issued_date, "
        "created_at FROM wz_documents ORDER BY created_at DESC"
    )


def stock_finished_goods() -> List[Dict[str, Any]]:
    return query_all(
        """SELECT id, batch_no, recipe_name, product_type_name,
                  qty_available, kg_per_unit, client_name, client_order_no
           FROM finished_goods WHERE COALESCE(qty_available,0) > 0
           ORDER BY produced_date DESC NULLS LAST, batch_no""")


def stock_raw() -> List[Dict[str, Any]]:
    return query_all(
        """SELECT id, internal_batch_no, supplier_name, kg_available
           FROM raw_batches WHERE COALESCE(kg_available,0) > 0
           ORDER BY received_date DESC NULLS LAST, internal_batch_no""")
