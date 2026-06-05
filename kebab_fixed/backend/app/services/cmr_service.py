"""CMR — międzynarodowy list przewozowy generowany z zamówienia."""
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.services.settings_service import get_company

logger = get_logger(__name__)


def aggregate_kebab_line(plan_lines: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Zbiorcza pozycja 'KEBAB MROŻONY' z linii planu (qty_done>0)."""
    qty = 0
    kg = 0.0
    for ln in plan_lines:
        q = int(ln.get("qty_done") or 0)
        if q <= 0:
            continue
        qty += q
        kg += q * float(ln.get("kg_per_unit") or 0)
    if qty <= 0:
        return None
    return {"name": "KEBAB MROŻONY", "qty": qty, "kg": round(kg, 3), "auto": True}


def build_goods(plan_lines: List[Dict[str, Any]],
                manual: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Towar = zbiorczy kebab (jeśli jest produkcja) + ręczne pozycje."""
    goods: List[Dict[str, Any]] = []
    kebab = aggregate_kebab_line(plan_lines)
    if kebab:
        goods.append(kebab)
    for m in manual or []:
        goods.append({"name": (m.get("name") or "").strip(),
                      "qty": int(m.get("qty") or 0),
                      "kg": round(float(m.get("kg") or 0), 3)})
    return goods


def cmr_totals(goods: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"qty": sum(int(g.get("qty") or 0) for g in goods),
            "kg": round(sum(float(g.get("kg") or 0) for g in goods), 3)}


def _carrier_snapshot(carrier_id: str, plate: str) -> Dict[str, Any]:
    c = query_one("SELECT * FROM carriers WHERE id=%s", (carrier_id,)) if carrier_id else None
    c = c or {}
    return {
        "name": c.get("name", ""), "address": c.get("address", ""),
        "postal_code": c.get("postal_code", ""), "city": c.get("city", ""),
        "country": c.get("country", ""), "nip": c.get("nip", ""),
        "vat_eu": c.get("vat_eu", ""),
        "plate": (plate or c.get("default_plate") or ""),
    }


def build_cmr(order_id: str, form: Dict[str, Any]) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")

    plan_lines = query_all(
        """SELECT qty_done, kg_per_unit FROM production_plan_lines
           WHERE client_order_id=%s AND COALESCE(qty_done,0) > 0""",
        (order_id,),
    )
    goods = build_goods(plan_lines, form.get("goods_manual") or [])
    if not goods:
        raise HTTPException(400, "Brak towaru do umieszczenia na CMR")
    totals = cmr_totals(goods)

    cols = "name, address, city, nip, dest_name, dest_address, dest_city"
    client = None
    if order.get("client_id"):
        client = query_one(f"SELECT {cols} FROM clients WHERE id=%s", (order.get("client_id"),))
    if not client:
        client = query_one(f"SELECT {cols} FROM clients WHERE name=%s", (order.get("client_name"),))
    client = client or {}
    client_name = client.get("name") or order.get("client_name", "")
    client_addr = ", ".join(x for x in [client.get("address", ""), client.get("city", "")] if x)
    dest = " ".join(x for x in [client.get("dest_name", ""), client.get("dest_address", ""),
                                client.get("dest_city", "")] if x).strip()

    co = get_company()
    company_addr = f"{co.get('address','')}".strip()
    load_city = co.get("city", "")
    hdi = query_one(
        "SELECT number FROM hdi_documents WHERE order_id=%s ORDER BY created_at DESC LIMIT 1",
        (order_id,))
    today = datetime.now().strftime("%Y-%m-%d")

    payload = {
        "sender": {"name": co.get("name", ""), "address": company_addr,
                   "postal_code": co.get("postal_code", ""), "city": load_city,
                   "country": "PL", "nip": co.get("nip", "")},
        "consignee": {"name": client_name, "address": client.get("address", ""),
                      "city": client.get("city", ""), "nip": client.get("nip", "")},
        "delivery_place": dest or ", ".join(x for x in [client_name, client_addr] if x),
        "load_place": co.get("load_place") or f"{company_addr}, {load_city}".strip(", "),
        "load_date": today,
        "attachments": {"hdi_number": (hdi or {}).get("number", ""),
                        "invoice_no": form.get("invoice_no", "")},
        "goods": goods,
        "gross_kg": totals["kg"],
        "instructions": form.get("instructions") or "TRANSPORT MROŻNICZY -22",
        "franco": form.get("franco") or (f"Franco {load_city}".strip()),
        "carrier": _carrier_snapshot(form.get("carrier_id", ""), form.get("plate", "")),
        "established_place": load_city,
        "established_date": today,
    }
    return {"order_id": order_id, "client_name": order.get("client_name", ""),
            "carrier_id": form.get("carrier_id") or None, "payload": payload, "totals": totals}


def generate_cmr(order_id: str, form: Dict[str, Any]) -> Dict[str, Any]:
    data = build_cmr(order_id, form)
    existing = query_one(
        "SELECT id, number FROM cmr_documents WHERE order_id=%s ORDER BY created_at LIMIT 1",
        (order_id,))
    today = datetime.now()
    if existing:
        with transaction() as conn:
            cx_execute(conn,
                """UPDATE cmr_documents SET client_name=%s, carrier_id=%s, payload=%s::jsonb
                   WHERE id=%s""",
                (data["client_name"], data["carrier_id"], json.dumps(data["payload"]),
                 existing["id"]))
        logger.info("cmr.reused", extra={"cmr_id": existing["id"], "number": existing["number"]})
        return {"id": existing["id"], "number": existing["number"], "status": "wystawiony"}

    cid = cuid()
    with transaction() as conn:
        row = cx_query_one(conn,
            "SELECT COALESCE(MAX(seq),0)+1 AS n FROM cmr_documents")
        seq = int(row["n"])
        number = str(seq)
        cx_execute(conn,
            """INSERT INTO cmr_documents
               (id, number, seq, order_id, client_name, carrier_id, status, payload,
                issue_date, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,'wystawiony',%s::jsonb,%s,%s)""",
            (cid, number, seq, order_id, data["client_name"], data["carrier_id"],
             json.dumps(data["payload"]), today.strftime("%d.%m.%Y"), now_iso()))
    logger.info("cmr.generated", extra={"cmr_id": cid, "number": number})
    return {"id": cid, "number": number, "status": "wystawiony"}


def get_cmr(cmr_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM cmr_documents WHERE id=%s", (cmr_id,))
    if not row:
        raise HTTPException(404, "CMR nie znaleziony")
    return row


def list_cmr() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, client_name, carrier_id, status, issue_date, created_at "
        "FROM cmr_documents ORDER BY seq DESC")
