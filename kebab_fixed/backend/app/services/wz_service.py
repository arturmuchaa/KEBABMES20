"""Dokument WZ (Wydanie Zewnętrzne) — numeracja, budowa pozycji, generowanie.

Wzorzec jak HDI: numer WZ/NN/MM/RR z MAX(seq) per year_month, idempotencja
per (source_type, source_id), druk przez headless Chrome.
"""
import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import cx_execute_returning, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.settings_service import get_company
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def format_wz_number(seq: int, year_month: str) -> str:
    # year_month = "RRMM" (np. "2606"); numer = WZ/NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"WZ/{seq}/{mm}/{yy}"


def build_wz_lines(items: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Zbuduj pozycje WZ. valued=True → cena + wartość (qty*price)."""
    lines: List[Dict[str, Any]] = []
    total = 0.0
    for it in items or []:
        qty = float(it.get("qty") or 0)
        line: Dict[str, Any] = {
            "name": it.get("name") or "",
            "qty": round(qty, 3),
            "unit": it.get("unit") or "kg",
            "batch_no": it.get("batch_no"),
            "price": None,
            "value": None,
        }
        if valued:
            price = float(it.get("price") or 0)
            value = round(qty * price, 2)
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
         "price": s.get("price"), "batch_no": s.get("batch_no")}
        for s in (selections or [])
    ]
    lines, total = build_wz_lines(items, valued)
    for line, s in zip(lines, selections or []):
        line["stock_type"] = s.get("stock_type")
        line["stock_id"] = s.get("stock_id")
    return lines, total


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

        ym = today.strftime("%y%m")  # RRMM
        seq_row = cx_query_one(
            conn, "SELECT COALESCE(MAX(seq),0)+1 AS n FROM wz_documents WHERE year_month=%s", (ym,)
        )
        seq = int(seq_row["n"])
        number = format_wz_number(seq, ym)
        wid = cuid()
        cx_execute_returning(
            conn,
            """INSERT INTO wz_documents
               (id, number, seq, year_month, source_type, source_id, seller,
                buyer_name, buyer_address, buyer_nip, valued, lines, total_value,
                place, issued_date, release_date, status, notes, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s)
               RETURNING id""",
            (wid, number, seq, ym, source_type, source_id, json.dumps(seller),
             buyer.get("name"), buyer.get("address"), buyer.get("nip"), valued,
             json.dumps(lines), total, place_val, issued, released, notes, now_iso()),
        )
    logger.info("wz.generated", extra={"wz_id": wid, "number": number})
    return get_wz(wid)


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
