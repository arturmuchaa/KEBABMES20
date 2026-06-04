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


def _pd_iso(val) -> str:
    """Zamień produced-date (datetime/str/None) → 'RRRR-MM-DD' lub dzisiejszą datę."""
    if val is None:
        return datetime.now().date().isoformat()
    if hasattr(val, "isoformat"):
        return val.isoformat()[:10]
    s = str(val)[:10]
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    return datetime.now().date().isoformat()


def units_from_plan_lines(lines: List[Dict[str, Any]], shelf_by_recipe: Dict[str, int]) -> List[Dict[str, Any]]:
    """Zsyntetyzuj sztuki HDI z linii planu produkcji.

    Źródłem prawdy o faktycznej produkcji jest ``production_plan_lines.qty_done``
    (zaraportowane przez pracownika), NIE ``finished_units`` (zasilane dopiero przy
    zamknięciu dnia). Dzięki temu HDI da się wystawić w każdym momencie, ze stanem
    faktycznym tego, co wyprodukowano.

    Numer partii bierzemy z ``batch_allocation`` (mapa partia_wsadu → {pieces}),
    rozbijając sztuki per partia mięsa. Gdy alokacja nie sumuje się do ``qty_done``
    lub jej brak — całość trafia do jednej partii (``seasoned_batch_no``).
    """
    units: List[Dict[str, Any]] = []
    for line in lines:
        qty_done = int(line.get("qty_done") or 0)
        if qty_done <= 0:
            continue
        name = (line.get("recipe_name") or line.get("product_type_name") or "").strip()
        weight = line.get("kg_per_unit") or 0
        shelf = int(shelf_by_recipe.get(line.get("recipe_id"), 0) or 0)
        pd = _pd_iso(line.get("progress_updated_at"))

        ba = line.get("batch_allocation") or {}
        alloc = {bno: int((info or {}).get("pieces") or 0) for bno, info in ba.items()} if isinstance(ba, dict) else {}
        if alloc and sum(alloc.values()) == qty_done:
            buckets = list(alloc.items())
        else:
            sbn = line.get("seasoned_batch_no")
            if not sbn:
                lst = line.get("seasoned_batch_nos") or []
                sbn = lst[0] if lst else ""
            buckets = [(sbn or "", qty_done)]

        for bno, pieces in buckets:
            for _ in range(int(pieces)):
                units.append({
                    "product_type_name": name,
                    "weight_kg": weight,
                    "batch_no": bno,
                    "produced_date": pd,
                    "shelf_life_days": shelf,
                })
    return units


def group_hdi_items(units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Grupuj sztuki po (produkt, waga) → pozycje HDI z partiami."""
    by_prod: Dict[tuple, Dict[str, Any]] = {}
    for u in units:
        w = round(float(u.get("weight_kg") or 0), 3)
        key = ((u.get("product_type_name") or "").strip(), w)
        grp = by_prod.setdefault(key, {"name": _product_label(key[0], w), "qty": 0, "kg": 0.0,
                                       "_base": key[0], "_w": w, "_b": {}})
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
        batches = list(grp.pop("_b").values())
        # Najliczniejsza partia pierwsza (jak na wzorze HDI).
        batches.sort(key=lambda b: b["qty"], reverse=True)
        grp["batches"] = batches
        grp["kg"] = round(grp["kg"], 3)
        out.append(grp)
    # Kolejność pozycji: wg przepisu (nazwa rosnąco), w obrębie przepisu
    # od najwyższej wagi do najniższej (jak na wzorze HDI klienta).
    out.sort(key=lambda g: (g["_base"], -g["_w"]))
    for grp in out:
        grp.pop("_base", None)
        grp.pop("_w", None)
    return out


def build_hdi(order_id: str) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    # Źródło prawdy = produkcja zaraportowana na planie (qty_done), aby HDI dało
    # się wystawić w każdym momencie ze stanem faktycznym (NIE finished_units,
    # które są zasilane dopiero przy zamknięciu dnia).
    lines = query_all(
        """SELECT pl.qty_done, pl.kg_per_unit, pl.recipe_id, pl.recipe_name,
                  pl.product_type_name, pl.batch_allocation, pl.seasoned_batch_no,
                  pl.seasoned_batch_nos, pl.progress_updated_at
           FROM production_plan_lines pl
           WHERE pl.client_order_id=%s AND COALESCE(pl.qty_done,0) > 0""",
        (order_id,),
    )
    recipe_ids = sorted({l.get("recipe_id") for l in lines if l.get("recipe_id")})
    shelf_by_recipe: Dict[str, int] = {}
    if recipe_ids:
        for r in query_all(
            "SELECT id, shelf_life_days FROM recipes WHERE id = ANY(%s)", (recipe_ids,)):
            shelf_by_recipe[r["id"]] = int(r.get("shelf_life_days") or 0)
    units = units_from_plan_lines(lines, shelf_by_recipe)
    if not units:
        raise HTTPException(400, "Brak wyprodukowanej produkcji dla tego zamówienia")
    items = group_hdi_items(units)
    total_qty = sum(i["qty"] for i in items)
    total_kg = round(sum(i["kg"] for i in items), 3)

    ordered = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM client_order_lines WHERE order_id=%s", (order_id,))
    ordered_qty = int((ordered or {}).get("q") or 0)
    incomplete = ordered_qty > 0 and total_qty < ordered_qty

    # Klient: najpierw po client_id (pewny klucz obcy zamówienia), dopiero potem
    # po nazwie. Bez tego zamówienia, gdzie client_name jest wolnym tekstem
    # niepasującym do słownika, gubiły pełne dane odbiorcy (NIP, adres, język).
    cols = "name, address, city, nip, language, dest_name, dest_address, dest_city"
    client = None
    if order.get("client_id"):
        client = query_one(f"SELECT {cols} FROM clients WHERE id=%s", (order.get("client_id"),))
    if not client:
        client = query_one(f"SELECT {cols} FROM clients WHERE name=%s", (order.get("client_name"),))
    client = client or {}
    co = get_company()
    lang = client.get("language") or lang_from_nip(client.get("nip") or "")

    company_addr = f"{co.get('address','')}, {co.get('postal_code','')} {co.get('city','')}".strip(", ")
    client_addr = f"{client.get('address','')}, {client.get('city','')}".strip(", ")
    dest = " ".join(x for x in [client.get('dest_name', ''), client.get('dest_address', ''), client.get('dest_city', '')] if x).strip()
    # Fallback na nazwę z zamówienia, gdy brak rekordu klienta w słowniku.
    client_name = client.get('name') or order.get('client_name', '')
    recipient = ", ".join(x for x in [client_name, client_addr, client.get('nip', '')] if x)
    header = {
        "producer_name": co.get("name", ""), "producer_addr": company_addr,
        "producer_nip": co.get("nip", ""), "producer_email": co.get("email", ""),
        "vet_number": co.get("vet_number", ""),
        "market_domestic": bool(co.get("market_domestic", True)),
        "market_eu": bool(co.get("market_eu", True)),
        "recipient": recipient,
        "unload": dest or ", ".join(x for x in [client_name, client_addr] if x),
        "load": co.get("load_place") or company_addr,
        "seller": f"{co.get('name', '')}, {company_addr}".strip(", "),
        # Nr rejestracyjny / typ samochodu — uzupełniany przy załadunku (wybór
        # pojazdu); pusty, dopóki sztuki nie zostaną zeskanowane na konkretny wóz.
        "reg_number": "",
    }
    return {"order_id": order_id, "client_name": order.get("client_name", ""), "language": lang,
            "incomplete": incomplete, "header": header, "items": items,
            "totals": {"qty": total_qty, "kg": total_kg}}


def generate_hdi(order_id: str) -> Dict[str, Any]:
    data = build_hdi(order_id)
    # Numer HDI jest STAŁY per zamówienie/wydanie. Jeśli dokument dla tego
    # zamówienia już istnieje, NIE nabijamy kolejnego numeru — zwracamy ten sam.
    # Dopóki status to 'wstepny', odświeżamy jego treść (stan produkcji mógł się
    # zmienić), zachowując numer; po potwierdzeniu zwracamy bez zmian.
    existing = query_one(
        "SELECT id, number, status FROM hdi_documents WHERE order_id=%s ORDER BY created_at LIMIT 1",
        (order_id,))
    if existing:
        if existing["status"] == "wstepny":
            with transaction() as conn:
                cx_execute(conn,
                    """UPDATE hdi_documents
                       SET client_name=%s, language=%s, incomplete=%s,
                           header=%s::jsonb, items=%s::jsonb, totals=%s::jsonb
                       WHERE id=%s""",
                    (data["client_name"], data["language"], data["incomplete"],
                     json.dumps(data["header"]), json.dumps(data["items"]),
                     json.dumps(data["totals"]), existing["id"]))
        logger.info("hdi.reused", extra={"hdi_id": existing["id"], "number": existing["number"]})
        return {"id": existing["id"], "number": existing["number"], "status": existing["status"],
                "incomplete": data["incomplete"], "totals": data["totals"]}

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
    return {"id": hid, "number": number, "status": "wstepny",
            "incomplete": data["incomplete"], "totals": data["totals"]}


def get_hdi(hdi_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM hdi_documents WHERE id=%s", (hdi_id,))
    if not row:
        raise HTTPException(404, "HDI nie znaleziony")
    return row


def list_hdi() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, client_name, status, incomplete, issue_date, created_at FROM hdi_documents ORDER BY created_at DESC")
