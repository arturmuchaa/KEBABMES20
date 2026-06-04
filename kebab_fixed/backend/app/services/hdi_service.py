"""HDI — generowanie dokumentu wstępnego z zamówienia."""
import json
from datetime import datetime
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.batch_numbers import kebab_batch_no
from app.utils.unit_codes import best_before
from app.utils.hdi_lang import lang_from_nip
from app.services.settings_service import get_company

logger = get_logger(__name__)


def _product_label(product_type_name: str, weight_kg) -> str:
    return f"{(product_type_name or '').strip()} {int(round(float(weight_kg or 0)))}KG".strip()


def _fmt_date(iso) -> str:
    s = (iso or "")[:10]
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return ""
    return f"{s[8:10]}.{s[5:7]}.{s[0:4]}"


def format_hdi_number(seq: int, year_month: str) -> str:
    # year_month = "RRMM" (np. "2605"); numer = NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"{seq}/{mm}/{yy}"


def group_hdi_items(units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Grupuj sztuki po (produkt, waga) → pozycje HDI z partiami."""
    by_prod: Dict[tuple, Dict[str, Any]] = {}
    for u in units:
        w = round(float(u.get("weight_kg") or 0), 3)
        key = ((u.get("product_type_name") or "").strip(), w)
        grp = by_prod.setdefault(key, {"name": _product_label(key[0], w), "qty": 0, "kg": 0.0, "_b": {}})
        grp["qty"] += 1
        grp["kg"] += w
        pd = u.get("produced_date") or ""
        partia = kebab_batch_no(pd, u.get("batch_no") or "") if pd else (u.get("batch_no") or "")
        bb = best_before(pd, int(u.get("shelf_life_days") or 0)) if pd else ""
        bkey = (partia, bb)
        b = grp["_b"].setdefault(bkey, {"partia": partia, "termin": _fmt_date(bb), "qty": 0})
        b["qty"] += 1
    out: List[Dict[str, Any]] = []
    for grp in by_prod.values():
        grp["batches"] = list(grp.pop("_b").values())
        grp["kg"] = round(grp["kg"], 3)
        out.append(grp)
    return out


def build_hdi(order_id: str) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    units = query_all(
        """SELECT fu.weight_kg, fu.batch_no, fu.produced_date, fu.product_type_id, fu.recipe_id,
                  pt.name AS product_type_name, r.shelf_life_days
           FROM finished_units fu
           LEFT JOIN product_types pt ON pt.id = fu.product_type_id
           LEFT JOIN recipes r ON r.id = fu.recipe_id
           WHERE fu.order_id=%s""",
        (order_id,),
    )
    if not units:
        raise HTTPException(400, "Brak wyprodukowanych sztuk do HDI")
    items = group_hdi_items(units)
    total_qty = sum(i["qty"] for i in items)
    total_kg = round(sum(i["kg"] for i in items), 3)

    ordered = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM client_order_lines WHERE order_id=%s", (order_id,))
    ordered_qty = int((ordered or {}).get("q") or 0)
    incomplete = ordered_qty > 0 and total_qty < ordered_qty

    client = query_one(
        "SELECT name, address, city, nip, language, dest_name, dest_address, dest_city FROM clients WHERE name=%s",
        (order.get("client_name"),)) or {}
    co = get_company()
    lang = client.get("language") or lang_from_nip(client.get("nip") or "")

    company_addr = f"{co.get('address','')}, {co.get('postal_code','')} {co.get('city','')}".strip(", ")
    client_addr = f"{client.get('address','')}, {client.get('city','')}".strip(", ")
    dest = " ".join(x for x in [client.get('dest_name', ''), client.get('dest_address', ''), client.get('dest_city', '')] if x).strip()
    header = {
        "producer_name": co.get("name", ""), "producer_addr": company_addr,
        "vet_number": co.get("vet_number", ""),
        "market_domestic": bool(co.get("market_domestic", True)),
        "market_eu": bool(co.get("market_eu", True)),
        "recipient": f"{client.get('name', '')}, {client_addr}, {client.get('nip', '')}".strip(", "),
        "unload": dest or f"{client.get('name', '')}, {client_addr}".strip(", "),
        "load": co.get("load_place") or company_addr,
        "seller": f"{co.get('name', '')}, {company_addr}".strip(", "),
    }
    return {"order_id": order_id, "client_name": order.get("client_name", ""), "language": lang,
            "incomplete": incomplete, "header": header, "items": items,
            "totals": {"qty": total_qty, "kg": total_kg}}


def generate_hdi(order_id: str) -> Dict[str, Any]:
    data = build_hdi(order_id)
    today = datetime.now()
    ym = today.strftime("%y%m")  # RRMM
    hid = cuid()
    with transaction() as conn:
        row = cx_query_one(conn,
            "SELECT COALESCE(MAX(seq),0)+1 AS n FROM hdi_documents WHERE year_month=%s", (ym,))
        seq = int(row["n"])
        number = format_hdi_number(seq, ym)
        cx_execute(conn,
            """INSERT INTO hdi_documents
               (id, number, seq, year_month, order_id, client_name, language, status,
                incomplete, header, items, totals, issue_date, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)""",
            (hid, number, seq, ym, order_id, data["client_name"], data["language"],
             data["incomplete"], json.dumps(data["header"]), json.dumps(data["items"]),
             json.dumps(data["totals"]), today.strftime("%d.%m.%Y"), now_iso()))
    logger.info("hdi.generated", extra={"hdi_id": hid, "number": number})
    return {"id": hid, "number": number, "status": "wstepny"}


def get_hdi(hdi_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM hdi_documents WHERE id=%s", (hdi_id,))
    if not row:
        raise HTTPException(404, "HDI nie znaleziony")
    return row


def list_hdi() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, client_name, status, incomplete, issue_date, created_at FROM hdi_documents ORDER BY created_at DESC")
