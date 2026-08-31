"""HDI — generowanie dokumentu wstępnego z zamówienia."""
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.batch_numbers import kebab_batch_no, kebab_batch_wsad
from app.utils.unit_codes import best_before
from app.utils.hdi_lang import lang_from_nip
from app.services.order_stock_service import (
    produced_by_key_from_plan_lines,
    stock_portions_for_order,
)
from app.services.settings_service import get_company

logger = get_logger(__name__)


def _product_label(product_type_name: str, weight_kg) -> str:
    return f"{(product_type_name or '').strip()} {int(round(float(weight_kg or 0)))}KG".strip()


def hdi_product_base(type_label: str, recipe_name: str, mode: str = "type_recipe") -> str:
    """Nazwa pozycji HDI bez wagi: RODZAJ + RECEPTURA.

    Do 29.08.2026 pozycja brała samą recepturę, więc rodzaje „KEBAB UDO 100%"
    i „KEBAB MIX 95/5" zrobione na tej samej recepturze schodziły na dokument
    jako jedna pozycja „KIRMIZI" — odbiorca nie widział, że dostał dwa różne
    wyroby (zgłoszenie klienta TRUVA). Rodzaj wchodzi do nazwy, a nazwa jest
    kluczem grupowania w `group_hdi_items`, więc pozycje już się nie scalają.

    Rodzaj bierzemy nazwą Z DOKUMENTÓW (`product_types.document_name`) —
    proporcji składu („95/5") klientowi nie pokazujemy.

    Gdy jedna nazwa zawiera się w drugiej, zostaje ta dłuższa: rodzaj
    „KEBAB YAPRAK" z recepturą „YAPRAK" dałby inaczej „KEBAB YAPRAK YAPRAK".

    `mode` z kartoteki odbiorcy (31.08.2026, HDI 20/08 dla POLATA): odbiorcy
    różnią się tym, co chcą widzieć na papierze — POLAT sam rodzaj i wagę
    („nazwa receptury to nasza kuchnia"), TRUVA odwrotnie: rodzaj ORAZ
    recepturę, żeby odróżnić dwa wyroby zrobione z jednej receptury.

    - `type_recipe` (domyślnie) — rodzaj + receptura,
    - `type`        — sam rodzaj,
    - `recipe`      — sama receptura.

    Brakujący człon nie zostawia pozycji bez nazwy — wchodzi ten drugi.
    """
    t = (type_label or "").strip()
    r = (recipe_name or "").strip()
    if mode == "type":
        return t or r
    if mode == "recipe":
        return r or t
    if not t or not r:
        return t or r
    if r.upper() in t.upper():
        return t
    if t.upper() in r.upper():
        return r
    return f"{t} {r}"


def document_type_names() -> Dict[str, str]:
    """Mapa rodzaj_id → nazwa na dokumentach (puste pole = nazwa rodzaju)."""
    return {
        r["id"]: ((r.get("document_name") or r.get("name") or "").strip())
        for r in query_all("SELECT id, name, document_name FROM product_types")
    }


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


def units_from_plan_lines(lines: List[Dict[str, Any]], shelf_by_recipe: Dict[str, int],
                          doc_names: Optional[Dict[str, str]] = None,
                          mode: str = "type_recipe",
                          recipe_names: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
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
        name = hdi_product_base(
            (doc_names or {}).get(line.get("product_type_id") or "")
            or line.get("product_type_name") or "",
            (recipe_names or {}).get(line.get("recipe_id") or "")
            or line.get("recipe_name") or "", mode)
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


def units_from_stock_portions(
    portions: List[Dict[str, Any]], shelf_by_recipe: Dict[str, int],
    doc_names: Optional[Dict[str, str]] = None,
    mode: str = "type_recipe",
    recipe_names: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Zsyntetyzuj sztuki HDI z porcji magazynowych finished_goods (pokrycie
    zamówienia towarem zrobionym "na magazyn", bez linku w liniach planu).

    ``batch_no`` sztuki to GOŁY wsad (kebab_batch_wsad) — pełną partię
    'ddmmrr wsad' odtwarza group_hdi_items z produced_date, identycznie jak
    dla sztuk z linii planu."""
    units: List[Dict[str, Any]] = []
    for p in portions or []:
        fg = p.get("fg") or {}
        take = int(p.get("take") or 0)
        if take <= 0:
            continue
        name = hdi_product_base(
            (doc_names or {}).get(fg.get("product_type_id") or "")
            or fg.get("product_type_name") or "",
            (recipe_names or {}).get(fg.get("recipe_id") or "")
            or fg.get("recipe_name") or "", mode)
        pd = _pd_iso(fg.get("produced_date"))
        bno = kebab_batch_wsad(fg.get("batch_no") or "")
        shelf = int(shelf_by_recipe.get(fg.get("recipe_id"), 0) or 0)
        for _ in range(take):
            units.append({
                "product_type_name": name,
                "weight_kg": fg.get("kg_per_unit") or 0,
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


CLIENT_COLS = ("id, name, address, city, nip, language, dest_name, dest_address, "
               "dest_city, dest_for_hdi, hdi_name_mode")


def client_recipe_names(client_id: str) -> Dict[str, str]:
    """Własne nazwy receptur odbiorcy: receptura → nazwa na JEGO dokumentach
    („BEYAZ AFIYET" u POLATA schodzi jako samo „BEYAZ")."""
    if not client_id:
        return {}
    return {
        r["recipe_id"]: (r.get("name") or "").strip()
        for r in query_all(
            "SELECT recipe_id, name FROM client_recipe_names WHERE client_id=%s",
            (client_id,))
        if (r.get("name") or "").strip()
    }


def client_naming(client: Optional[Dict[str, Any]]) -> tuple:
    """(tryb nazwy, mapa własnych nazw receptur) dla odbiorcy z kartoteki."""
    c = client or {}
    return (c.get("hdi_name_mode") or "type_recipe"), client_recipe_names(c.get("id") or "")


def _hdi_header(client: Dict[str, Any], fallback_name: str) -> tuple:
    """Nagłówek HDI z kartoteki odbiorcy. Wspólny dla HDI z zamówienia i z WZ."""
    co = get_company()
    lang = client.get("language") or lang_from_nip(client.get("nip") or "")
    company_addr = f"{co.get('address','')}, {co.get('postal_code','')} {co.get('city','')}".strip(", ")
    client_addr = f"{client.get('address','')}, {client.get('city','')}".strip(", ")
    # Ptaszek „stosuj na HDI" w kartotece: wyłączony → rozładunek = adres
    # odbiorcy, nawet gdy miejsce przeznaczenia jest wypełnione (np. ISSA:
    # CMR jedzie na Farmex, HDI na adres klienta). Brak kolumny (None) = true.
    use_dest = client.get("dest_for_hdi")
    dest = "" if use_dest is False else " ".join(
        x for x in [client.get('dest_name', ''), client.get('dest_address', ''),
                    client.get('dest_city', '')] if x).strip()
    client_name = client.get("name") or fallback_name
    recipient = ", ".join(x for x in [client_name, client_addr, client.get("nip", "")] if x)
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
    return header, lang


def build_hdi(order_id: str) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    # Źródło prawdy = produkcja zaraportowana na planie (qty_done), aby HDI dało
    # się wystawić w każdym momencie ze stanem faktycznym (NIE finished_units,
    # które są zasilane dopiero przy zamknięciu dnia).
    # Plany anulowane wykluczone — qty_done mógł zostać wpisany przed anulowaniem.
    lines = query_all(
        """SELECT pl.qty_done, pl.kg_per_unit, pl.recipe_id, pl.recipe_name,
                  pl.product_type_id, pl.packaging_id,
                  pl.product_type_name, pl.batch_allocation, pl.seasoned_batch_no,
                  pl.seasoned_batch_nos, pl.progress_updated_at
           FROM production_plan_lines pl
           JOIN production_plans pp ON pp.id = pl.plan_id
           WHERE pl.client_order_id=%s AND COALESCE(pl.qty_done,0) > 0
             AND pp.status <> 'cancelled'""",
        (order_id,),
    )
    # Braki względem zamówienia pokryj zapasem magazynowym (produkcja "na
    # magazyn" sprzed zamówienia nie ma linku w liniach planu).
    order_lines = query_all(
        "SELECT recipe_id, kg_per_unit, product_type_id, packaging_id, qty "
        "FROM client_order_lines WHERE order_id=%s",
        (order_id,))
    portions = stock_portions_for_order(
        order_id, order.get("order_no") or "", order_lines,
        produced_by_key_from_plan_lines(lines))

    recipe_ids = sorted(
        {l.get("recipe_id") for l in lines if l.get("recipe_id")}
        | {(p.get("fg") or {}).get("recipe_id") for p in portions
           if (p.get("fg") or {}).get("recipe_id")})
    shelf_by_recipe: Dict[str, int] = {}
    if recipe_ids:
        for r in query_all(
            "SELECT id, shelf_life_days FROM recipes WHERE id = ANY(%s)", (recipe_ids,)):
            shelf_by_recipe[r["id"]] = int(r.get("shelf_life_days") or 0)
    # Kartotekę odbiorcy czytamy PRZED pozycjami — ptaszek „Na HDI tylko
    # rodzaj" (POLAT) decyduje o nazwie pozycji, nie tylko o nagłówku.
    # Klient: najpierw po client_id (pewny klucz obcy zamówienia), dopiero potem
    # po nazwie. Bez tego zamówienia, gdzie client_name jest wolnym tekstem
    # niepasującym do słownika, gubiły pełne dane odbiorcy (NIP, adres, język).
    client = None
    if order.get("client_id"):
        client = query_one(f"SELECT {CLIENT_COLS} FROM clients WHERE id=%s", (order.get("client_id"),))
    if not client:
        client = query_one(f"SELECT {CLIENT_COLS} FROM clients WHERE name=%s", (order.get("client_name"),))
    client = client or {}
    mode, recipe_names = client_naming(client)

    doc_names = document_type_names()
    units = units_from_plan_lines(lines, shelf_by_recipe, doc_names, mode, recipe_names)
    units += units_from_stock_portions(portions, shelf_by_recipe, doc_names, mode, recipe_names)
    if not units:
        raise HTTPException(400, "Brak wyprodukowanej produkcji dla tego zamówienia")
    items = group_hdi_items(units)
    total_qty = sum(i["qty"] for i in items)
    total_kg = round(sum(i["kg"] for i in items), 3)

    ordered_qty = sum(int(ln.get("qty") or 0) for ln in order_lines)
    incomplete = ordered_qty > 0 and total_qty < ordered_qty

    header, lang = _hdi_header(client, order.get("client_name", ""))
    return {"order_id": order_id, "client_name": order.get("client_name", ""), "language": lang,
            "incomplete": incomplete, "header": header, "items": items,
            "totals": {"qty": total_qty, "kg": total_kg}}


def build_hdi_from_wz(wz_id: str) -> Dict[str, Any]:
    """HDI dla RĘCZNEGO WZ — sprzedaży wyrobu prosto z magazynu.

    Do 28.08.2026 handlowy dokument identyfikacyjny dało się wystawić WYŁĄCZNIE
    z zamówienia, bo pozycje brał z linii planu produkcji. Sprzedaż z magazynu
    zamówienia nie ma i zostawała bez HDI — a wyrób jedzie do klienta tak samo
    i tak samo musi mieć identyfikację partii.

    Pozycje idą wprost z linii WZ: każda wskazuje wiersz `finished_goods`
    i liczbę sztuk, czyli dokładnie to, czego oczekuje `units_from_stock_portions`.
    Odbiorcę bierzemy z kartoteki po NIP-ie z dokumentu (najpewniejszy klucz),
    potem po nazwie; brak kartoteki nie blokuje wystawienia — nagłówek schodzi
    wtedy do danych wpisanych na WZ.
    """
    wz = query_one("SELECT * FROM wz_documents WHERE id=%s", (wz_id,))
    if not wz:
        raise HTTPException(404, "Dokument WZ nie istnieje")
    if (wz.get("status") or "") == "anulowany":
        raise HTTPException(409, "WZ jest anulowany — nie wystawiamy do niego HDI")
    if (wz.get("source_type") or "") == "order":
        raise HTTPException(
            409, "WZ z zamówienia ma własne HDI — wystaw je z poziomu zamówienia")

    lines = wz.get("lines")
    if isinstance(lines, str):
        lines = json.loads(lines or "[]")

    portions: List[Dict[str, Any]] = []
    for line in lines or []:
        if (line.get("stock_type") or "") != "fg":
            continue          # surowiec i uboczne nie są wyrobem gotowym
        sid, ile = line.get("stock_id"), int(round(float(line.get("qty") or 0)))
        if not sid or ile <= 0:
            continue
        fg = query_one("SELECT * FROM finished_goods WHERE id=%s", (sid,))
        if fg:
            portions.append({"fg": fg, "take": ile})
    if not portions:
        raise HTTPException(400, "Ten WZ nie wydaje wyrobu gotowego — nie ma z czego zrobić HDI")

    recipe_ids = sorted({(p["fg"].get("recipe_id") or "") for p in portions} - {""})
    shelf_by_recipe: Dict[str, int] = {}
    if recipe_ids:
        for r in query_all(
                "SELECT id, shelf_life_days FROM recipes WHERE id = ANY(%s)", (recipe_ids,)):
            shelf_by_recipe[r["id"]] = int(r.get("shelf_life_days") or 0)

    # Kartoteka PRZED pozycjami — ptaszek „Na HDI tylko rodzaj" (POLAT)
    # decyduje o nazwie pozycji, nie tylko o nagłówku.
    nazwa = wz.get("buyer_name") or ""
    client = None
    if (wz.get("buyer_nip") or "").strip():
        client = query_one(f"SELECT {CLIENT_COLS} FROM clients WHERE nip=%s",
                           (wz.get("buyer_nip"),))
    if not client:
        client = query_one(
            f"SELECT {CLIENT_COLS} FROM clients WHERE name=%s OR display_name=%s "
            "ORDER BY (name=%s) DESC LIMIT 1", (nazwa, nazwa, nazwa))
    if not client:
        # Nabywca spoza kartoteki (np. sprzedaż jednorazowa) — nagłówek z WZ.
        client = {"name": nazwa, "address": wz.get("buyer_address") or "",
                  "city": "", "nip": wz.get("buyer_nip") or ""}

    mode, recipe_names = client_naming(client)
    items = group_hdi_items(units_from_stock_portions(
        portions, shelf_by_recipe, document_type_names(), mode, recipe_names))
    total_qty = sum(i["qty"] for i in items)
    total_kg = round(sum(i["kg"] for i in items), 3)

    header, lang = _hdi_header(client, nazwa)
    return {"wz_id": wz_id, "client_name": nazwa, "language": lang,
            "incomplete": False, "header": header, "items": items,
            "totals": {"qty": total_qty, "kg": total_kg}}


def _next_hdi_seq(conn, ym: str) -> int:
    """Kolejny numer HDI w miesiącu (RRMM).

    Numer raz nadany jest SPALONY — papier z nim pojechał już z towarem,
    więc skasowanie dokumentu nie może oddać numeru następnemu transportowi.
    Stan licznika trzyma `sequences` (klucz `hdi_seq:RRMM`); wpisanie tam
    wartości pozwala też ustawić numer startowy, gdy część miesiąca była
    wystawiana poza systemem (biuro, sierpień 2026: kolejny ma być 11).
    """
    key = f"hdi_seq:{ym}"
    cx_execute(
        conn,
        "INSERT INTO sequences (key, value) VALUES (%s, 0) ON CONFLICT (key) DO NOTHING",
        (key,),
    )
    # Blokada na wiersz licznika — dwa wydania naraz nie dostaną tego samego numeru.
    stan = cx_query_one(conn, "SELECT value FROM sequences WHERE key=%s FOR UPDATE", (key,))
    row = cx_query_one(
        conn, "SELECT COALESCE(MAX(seq),0) AS n FROM hdi_documents WHERE year_month=%s", (ym,)
    )
    seq = max(int(row["n"] or 0), int((stan or {}).get("value") or 0)) + 1
    cx_execute(conn, "UPDATE sequences SET value=%s WHERE key=%s", (seq, key))
    return seq


def generate_hdi(order_id: str) -> Dict[str, Any]:
    # Numer HDI jest STAŁY per zamówienie/wydanie. Jeśli dokument dla tego
    # zamówienia już istnieje, NIE nabijamy kolejnego numeru — zwracamy ten sam.
    # Dopóki status to 'wstepny', odświeżamy jego treść (stan produkcji mógł się
    # zmienić), zachowując numer; po potwierdzeniu zwracamy bez zmian.
    existing = query_one(
        "SELECT id, number, status, incomplete, totals FROM hdi_documents "
        "WHERE order_id=%s ORDER BY created_at LIMIT 1",
        (order_id,))

    # Zamówienie ZREALIZOWANE (albo anulowane) — dokument jest zamknięty.
    # Towar wyjechał, papier z nim pojechał; ponowne „Generuj" tylko go
    # otwiera do podglądu. Przeliczenie po zamknięciu przepisało HDI YALCINA
    # z 12 920 kg na 5 220 kg (biuro, 27.08.2026).
    zamowienie = query_one("SELECT status FROM client_orders WHERE id=%s", (order_id,))
    if not zamowienie:
        raise HTTPException(404, "Zamówienie nie znalezione")
    if (zamowienie.get("status") or "") in ("done", "cancelled"):
        if not existing:
            raise HTTPException(
                400, "Zamówienie jest już zamknięte — nowego HDI nie wystawiamy")
        return {"id": existing["id"], "number": existing["number"],
                "status": existing["status"], "frozen": True,
                "incomplete": bool(existing.get("incomplete")),
                "totals": existing.get("totals") or {}}

    data = build_hdi(order_id)
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
        seq = _next_hdi_seq(conn, ym)
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


def generate_hdi_from_wz(wz_id: str) -> Dict[str, Any]:
    """HDI do ręcznego WZ. Numer STAŁY per dokument WZ — ponowne „Generuj"
    odświeża treść dokumentu wstępnego, tak samo jak przy zamówieniu."""
    data = build_hdi_from_wz(wz_id)
    existing = query_one(
        "SELECT id, number, status FROM hdi_documents WHERE wz_id=%s "
        "ORDER BY created_at LIMIT 1", (wz_id,))
    if existing:
        if existing["status"] == "wstepny":
            with transaction() as conn:
                cx_execute(conn,
                    """UPDATE hdi_documents
                       SET client_name=%s, language=%s,
                           header=%s::jsonb, items=%s::jsonb, totals=%s::jsonb
                       WHERE id=%s""",
                    (data["client_name"], data["language"], json.dumps(data["header"]),
                     json.dumps(data["items"]), json.dumps(data["totals"]), existing["id"]))
        logger.info("hdi.wz.reused", extra={"hdi_id": existing["id"], "wz_id": wz_id})
        return {"id": existing["id"], "number": existing["number"],
                "status": existing["status"], "incomplete": False,
                "totals": data["totals"]}

    today = datetime.now()
    ym = today.strftime("%y%m")
    hid = cuid()
    with transaction() as conn:
        seq = _next_hdi_seq(conn, ym)
        number = format_hdi_number(seq, ym)
        cx_execute(conn,
            """INSERT INTO hdi_documents
               (id, number, seq, year_month, wz_id, client_name, language, status,
                incomplete, header, items, totals, issue_date, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'wstepny',false,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)""",
            (hid, number, seq, ym, wz_id, data["client_name"], data["language"],
             json.dumps(data["header"]), json.dumps(data["items"]),
             json.dumps(data["totals"]), today.strftime("%d.%m.%Y"), now_iso()))
    logger.info("hdi.wz.generated", extra={"hdi_id": hid, "number": number, "wz_id": wz_id})
    return {"id": hid, "number": number, "status": "wstepny",
            "incomplete": False, "totals": data["totals"]}


def get_hdi(hdi_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM hdi_documents WHERE id=%s", (hdi_id,))
    if not row:
        raise HTTPException(404, "HDI nie znaleziony")
    return row


def list_hdi() -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, number, client_name, status, incomplete, issue_date, created_at FROM hdi_documents ORDER BY created_at DESC")
