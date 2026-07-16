"""CMR — międzynarodowy list przewozowy generowany z zamówienia."""
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.services.order_stock_service import (
    produced_by_key_from_plan_lines,
    stock_portions_for_order,
)
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


# Nazwa kraju na CMR (jak na wzorze: pełna nazwa) wg prefiksu NIP/VAT.
_CC_NAME = {"PL": "Poland", "SI": "Slovenia", "DE": "Germany", "AT": "Austria",
            "SK": "Slovakia", "CZ": "Czechia", "IT": "Italy", "FR": "France",
            "HU": "Hungary", "HR": "Croatia", "RO": "Romania", "NL": "Netherlands"}


def country_from_nip(nip: str, default: str = "Poland") -> str:
    s = (nip or "").strip().upper()
    cc = s[:2] if len(s) >= 2 and s[:2].isalpha() else ""
    return _CC_NAME.get(cc, default if not cc else cc)


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


def _client_snapshot(order: Dict[str, Any]) -> Dict[str, Any]:
    """Dane kontrahenta z ŻYWEJ kartoteki klientów: consignee + miejsce dostawy.

    Wołane przy generowaniu ORAZ przy każdym zapisie edycji CMR — zmiana
    danych klienta w kartotece ma wchodzić na dokument (prod 2026-07-16:
    poprawiony adres BULLI nie trafiał na CMR, bo payload był snapshotem
    z chwili utworzenia i nic go nie odświeżało).
    """
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
    return {
        "consignee": {"name": client_name, "address": client.get("address", ""),
                      "city": client.get("city", ""),
                      "country": country_from_nip(client.get("nip", ""), ""),
                      "nip": client.get("nip", "")},
        "delivery_place": dest or ", ".join(x for x in [client_name, client_addr] if x),
    }


def build_cmr(order_id: str, form: Dict[str, Any]) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")

    plan_lines = query_all(
        """SELECT qty_done, recipe_id, kg_per_unit FROM production_plan_lines
           WHERE client_order_id=%s AND COALESCE(qty_done,0) > 0""",
        (order_id,),
    )
    # Braki względem zamówienia pokryj zapasem magazynowym (produkcja "na
    # magazyn" sprzed zamówienia nie ma linku w liniach planu) — porcje
    # wchodzą do zbiorczej pozycji kebaba jak linie planu.
    order_lines = query_all(
        "SELECT recipe_id, kg_per_unit, qty FROM client_order_lines WHERE order_id=%s",
        (order_id,))
    portions = stock_portions_for_order(
        order_id, order.get("order_no") or "", order_lines,
        produced_by_key_from_plan_lines(plan_lines))
    plan_lines = plan_lines + [
        {"qty_done": p["take"], "kg_per_unit": (p.get("fg") or {}).get("kg_per_unit")}
        for p in portions]
    goods = build_goods(plan_lines, form.get("goods_manual") or [])
    if not goods:
        raise HTTPException(400, "Brak towaru do umieszczenia na CMR")
    totals = cmr_totals(goods)

    consignee_part = _client_snapshot(order)

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
                   "country": country_from_nip(co.get("nip", ""), "Poland"),
                   "nip": co.get("nip", "")},
        "consignee": consignee_part["consignee"],
        "delivery_place": consignee_part["delivery_place"],
        "load_place": co.get("load_place") or f"{company_addr}, {load_city}".strip(", "),
        "load_date": today,
        "attachments": {"hdi_number": (hdi or {}).get("number", ""),
                        "invoice_no": form.get("invoice_no", "")},
        "goods": goods,
        "gross_kg": totals["kg"],
        "instructions": form.get("instructions") or "TRANSPORT MROŻNICZY -22",
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


def update_cmr(cmr_id: str, form: Dict[str, Any]) -> Dict[str, Any]:
    row = query_one("SELECT * FROM cmr_documents WHERE id=%s", (cmr_id,))
    if not row:
        raise HTTPException(404, "CMR nie znaleziony")
    payload = row.get("payload") or {}
    # Odśwież kontrahenta z żywej kartoteki przy KAŻDYM zapisie — payload to
    # snapshot z chwili utworzenia i zmiana danych klienta nie wchodziła na
    # dokument (prod 2026-07-16, BULLI). Formularz edycji CMR nie pozwala
    # ręcznie zmieniać consignee/delivery, więc nadpisanie nic nie gubi.
    if row.get("order_id"):
        order = query_one("SELECT * FROM client_orders WHERE id=%s", (row.get("order_id"),))
        if order:
            snap = _client_snapshot(order)
            payload["consignee"] = snap["consignee"]
            payload["delivery_place"] = snap["delivery_place"]
    carrier_id = form.get("carrier_id") or row.get("carrier_id") or ""
    carrier = _carrier_snapshot(carrier_id, form.get("plate") or payload.get("carrier", {}).get("plate", ""))
    payload["carrier"] = carrier
    if "invoice_no" in form:
        att = payload.get("attachments") or {}
        att["invoice_no"] = form["invoice_no"]
        payload["attachments"] = att
    if "instructions" in form:
        payload["instructions"] = form["instructions"]
    if "goods_manual" in form:
        plan_goods = [g for g in (payload.get("goods") or []) if g.get("auto")]
        manual = [{"name": g.get("name", ""), "qty": int(g.get("qty") or 0),
                   "kg": round(float(g.get("kg") or 0), 3)}
                  for g in form["goods_manual"] if (g.get("name") or "").strip()]
        payload["goods"] = plan_goods + manual
        payload["gross_kg"] = round(sum(float(g.get("kg") or 0) for g in payload["goods"]), 3)
    with transaction() as conn:
        cx_execute(conn,
            "UPDATE cmr_documents SET carrier_id=%s, payload=%s::jsonb WHERE id=%s",
            (carrier_id or None, json.dumps(payload), cmr_id))
    return {"id": cmr_id, "status": "ok"}


def get_cmr(cmr_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM cmr_documents WHERE id=%s", (cmr_id,))
    if not row:
        raise HTTPException(404, "CMR nie znaleziony")
    return row


def list_cmr() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, client_name, carrier_id, status, issue_date, created_at "
        "FROM cmr_documents ORDER BY seq DESC")


# ── Układ druku CMR (pozycje pól ustawiane w konfiguratorze) ──
def get_cmr_layout() -> Dict[str, Any]:
    row = query_one("SELECT positions FROM cmr_layout WHERE id='default'")
    return (row or {}).get("positions") or {}


def save_cmr_layout(positions: Dict[str, Any]) -> Dict[str, Any]:
    with transaction() as conn:
        cx_execute(conn,
            """INSERT INTO cmr_layout (id, positions, updated_at)
               VALUES ('default', %s::jsonb, now())
               ON CONFLICT (id) DO UPDATE SET positions=EXCLUDED.positions, updated_at=now()""",
            (json.dumps(positions),))
    return positions
