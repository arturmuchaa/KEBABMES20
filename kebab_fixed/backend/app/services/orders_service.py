from typing import Any, Dict, List, Tuple

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
from app.models.orders import ClientOrderCreate, OrderLineCreate
from app.utils.ids import cuid, now_iso, slugify_for_number
from datetime import datetime

logger = get_logger(__name__)


def _order_period(order_date_raw: str | None) -> str:
    if order_date_raw:
        try:
            return datetime.fromisoformat(order_date_raw).strftime("%m/%y")
        except ValueError:
            pass
    return datetime.now().strftime("%m/%y")


def _next_client_order_no(
    conn, client_display_name: str, order_date_raw: str | None
) -> str:
    # Format numeru: {nazwa_wyświetlana_klienta}/Z/{kolejny_w_msc}/MM/RR
    # (np. ZAGROS/Z/1/05/26). Sekwencja jest liczona PER KLIENT i miesiąc.
    period = _order_period(order_date_raw)
    month_part, year_part = period.split("/")
    client_slug = slugify_for_number(client_display_name)
    seq_key = f"client_order_seq:{client_slug}:{period}"

    # Lock one row per client+month so parallel creates cannot allocate the same number.
    cx_execute(
        conn,
        """
        INSERT INTO sequences (key, value)
        VALUES (%s, 0)
        ON CONFLICT (key) DO NOTHING
        """,
        (seq_key,),
    )
    cx_query_one(
        conn,
        """
        SELECT value
        FROM sequences
        WHERE key = %s
        FOR UPDATE
        """,
        (seq_key,),
    )

    # Numer bierzemy spośród WOLNYCH — zamówienie założone pomyłkowo
    # i skasowane oddaje numer. Ale numer, pod którym stoi choćby jedna
    # sztuka wyrobu, jest SPALONY: po usunięciu zamówienia wracał do puli
    # i dawna, dawno wysłana produkcja przyklejała się do nowego
    # zamówienia — POLAT/Z/1/08/26 z 14.08 pokazał 26.08 pokrycie 100 %
    # przy pustym magazynie (biuro, 27.08.2026).
    rows = cx_query_all(
        conn,
        """
        SELECT DISTINCT seq FROM (
            SELECT split_part(order_no, '/', 1) AS klient,
                   split_part(order_no, '/', 2) AS typ,
                   split_part(order_no, '/', 3) AS seq,
                   split_part(order_no, '/', 4) AS msc,
                   split_part(order_no, '/', 5) AS rok
            FROM client_orders
            UNION ALL
            SELECT split_part(client_order_no, '/', 1),
                   split_part(client_order_no, '/', 2),
                   split_part(client_order_no, '/', 3),
                   split_part(client_order_no, '/', 4),
                   split_part(client_order_no, '/', 5)
            FROM finished_goods
            WHERE COALESCE(client_order_no, '') <> ''
        ) n
        WHERE klient = %s AND typ = 'Z' AND msc = %s AND rok = %s
          AND seq ~ '^[0-9]+$'
        """,
        (client_slug, month_part, year_part),
    )
    used = {int(row["seq"]) for row in rows}
    seq = 1
    while seq in used:
        seq += 1

    cx_execute(
        conn,
        "UPDATE sequences SET value = GREATEST(value, %s) WHERE key = %s",
        (seq, seq_key),
    )
    return f"{client_slug}/Z/{seq}/{period}"


def _resolve_line_names(conn, line: OrderLineCreate) -> Tuple[str, str, str]:
    recipe_name = line.recipe_name
    product_type_name = line.product_type_name
    if not recipe_name and line.recipe_id:
        r = cx_query_one(
            conn,
            "SELECT name, product_type_name FROM recipes WHERE id=%s",
            (line.recipe_id,),
        )
        if r:
            recipe_name = r["name"] or ""
            if not product_type_name:
                product_type_name = r.get("product_type_name") or ""
    if not product_type_name and line.product_type_id:
        pt = cx_query_one(
            conn, "SELECT name FROM product_types WHERE id=%s", (line.product_type_id,)
        )
        if pt:
            product_type_name = pt["name"] or ""
    packaging_name = line.packaging_name
    if not packaging_name and line.packaging_id:
        pkg = cx_query_one(
            conn, "SELECT name FROM packaging WHERE id=%s", (line.packaging_id,)
        )
        if pkg:
            packaging_name = pkg["name"] or ""
    return recipe_name or "", product_type_name or "", packaging_name or ""


def _klucz(recipe_id: Any, kg_per_unit: Any) -> str:
    return f"{recipe_id}|{float(kg_per_unit or 0)}"


def rozdziel_pokrycie(
    zamowienia: List[Dict[str, Any]],
    przypisane: Dict[str, Dict[str, int]],
    pula: List[Dict[str, Any]],
) -> Dict[str, Dict[str, int]]:
    """Ile sztuk każdej POZYCJI zamówienia jest już zrobione.

    * `zamowienia` — od najstarszego:
      `{"id", "order_no", "client_id", "bierze_z_puli", "lines": [{"id", "key", "qty"}]}`
    * `przypisane` — `{order_no: {key: sztuki}}`, sztuki ostemplowane numerem
      zamówienia (także już wydane — poszły na to zamówienie).
    * `pula` — zapas BEZ zamówienia: `{"client_id", "key", "qty"}`, tylko sztuki
      leżące na magazynie.

    Zwraca `{order_id: {line_id: sztuki}}`.

    Dwie reguły, obie z rozjazdów w biurze:

    1. Sztuki dzielą się między POZYCJE, nie mnożą przez nie. TRUVA miała dwie
       identyczne pozycje 80×20 kg i te same 80 sztuk pokazywało się przy obu
       (160 z 160 zrobione, magazyn pusty). Nadwyżka ponad zamówioną ilość
       ląduje na ostatniej pozycji tego wyrobu — nadprodukcji nie chowamy.
    2. Zapas podpisany klientem liczy się TYLKO jemu. Wyrób wpisany na LEZZĘ
       pokazywał postęp u YALCINA i TRUVY, bo pula szła po samej recepturze.
       Zapas bez klienta (produkcja „na magazyn") pokrywa dowolne zamówienie,
       po kolei od najstarszego — jeden raz.
    """
    wynik: Dict[str, Dict[str, int]] = {}
    brakuje: Dict[str, Dict[str, int]] = {}

    for zam in zamowienia:
        zostalo = dict(przypisane.get(zam.get("order_no") or "", {}))
        # Ostatnia pozycja danego wyrobu — na nią spada ewentualna nadwyżka.
        ostatnia: Dict[str, str] = {}
        for linia in zam["lines"]:
            ostatnia[linia["key"]] = linia["id"]

        dla_zam: Dict[str, int] = {}
        brak_zam: Dict[str, int] = {}
        for linia in zam["lines"]:
            klucz, potrzeba = linia["key"], int(linia.get("qty") or 0)
            mam = zostalo.get(klucz, 0)
            wziete = max(0, min(potrzeba, mam))
            zostalo[klucz] = mam - wziete
            if ostatnia.get(klucz) == linia["id"] and zostalo.get(klucz, 0) > 0:
                wziete += zostalo[klucz]      # nadprodukcja — widoczna, nie zgubiona
                zostalo[klucz] = 0
            dla_zam[linia["id"]] = wziete
            brak_zam[linia["id"]] = max(0, potrzeba - wziete)
        wynik[zam["id"]] = dla_zam
        brakuje[zam["id"]] = brak_zam

    wlasne: Dict[Tuple[str, str], int] = {}
    niczyje: Dict[str, int] = {}
    for row in pula:
        ile = int(row.get("qty") or 0)
        if ile <= 0:
            continue
        cid = (row.get("client_id") or "").strip()
        if cid:
            wlasne[(cid, row["key"])] = wlasne.get((cid, row["key"]), 0) + ile
        else:
            niczyje[row["key"]] = niczyje.get(row["key"], 0) + ile

    for zam in zamowienia:
        if not zam.get("bierze_z_puli", True):
            continue
        cid = (zam.get("client_id") or "").strip()
        for linia in zam["lines"]:
            brak = brakuje[zam["id"]].get(linia["id"], 0)
            if brak <= 0:
                continue
            klucz = linia["key"]
            polki: List[Tuple[Dict, Any]] = []
            if cid:
                polki.append((wlasne, (cid, klucz)))   # najpierw zapas własny
            polki.append((niczyje, klucz))             # potem „na magazyn"
            for magazyn, mkey in polki:
                bierz = min(brak, magazyn.get(mkey, 0))
                if bierz <= 0:
                    continue
                magazyn[mkey] -= bierz
                wynik[zam["id"]][linia["id"]] += bierz
                brak -= bierz
                if brak <= 0:
                    break

    return wynik


def _pokrycie_zamowien() -> Dict[str, Dict[str, int]]:
    """Liczy pokrycie WSZYSTKICH zamówień naraz — inaczej ten sam zapas
    pokazuje się przy każdym z osobna."""
    orders = query_all(
        """
        SELECT id, order_no, client_id, status
        FROM client_orders
        ORDER BY order_date, created_at, order_no
        """
    )
    if not orders:
        return {}
    linie = query_all(
        "SELECT id, order_id, recipe_id, kg_per_unit, qty FROM client_order_lines ORDER BY id"
    )
    wg_zam: Dict[str, List[Dict[str, Any]]] = {}
    for l in linie:
        wg_zam.setdefault(l["order_id"], []).append(
            {"id": l["id"], "key": _klucz(l["recipe_id"], l["kg_per_unit"]), "qty": int(l["qty"] or 0)}
        )

    przypisane: Dict[str, Dict[str, int]] = {}
    for r in query_all(
        """
        SELECT client_order_no, recipe_id, kg_per_unit, SUM(qty) AS qty
        FROM finished_goods
        WHERE COALESCE(client_order_no, '') <> ''
        GROUP BY client_order_no, recipe_id, kg_per_unit
        """
    ):
        przypisane.setdefault(r["client_order_no"], {})[
            _klucz(r["recipe_id"], r["kg_per_unit"])
        ] = int(r["qty"] or 0)

    # Zapas bez zamówienia liczy się tylko w wysokości qty_available — po
    # wydaniu rozchód stempluje sztuki numerem zamówienia, a reszta nie może
    # fantomowo pokrywać kolejnych zamówień tym samym, wydanym towarem.
    # Klienta bierzemy z client_id, a dla starszych wpisów rozpoznajemy go po
    # nazwie: w wyrobie stoi nazwa z KRS („POLAT D.O.O."), w zamówieniu
    # handlowa („POLAT”).
    pula = [
        {
            "client_id": r["client_id"] or "",
            "key": _klucz(r["recipe_id"], r["kg_per_unit"]),
            "qty": int(r["qty"] or 0),
        }
        for r in query_all(
            """
            SELECT COALESCE(NULLIF(fg.client_id, ''), (
                       SELECT c.id FROM clients c
                       WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                       ORDER BY (c.name = fg.client_name) DESC
                       LIMIT 1
                   ), '') AS client_id,
                   fg.recipe_id, fg.kg_per_unit, SUM(fg.qty_available) AS qty
            FROM finished_goods fg
            WHERE COALESCE(fg.client_order_no, '') = ''
              AND COALESCE(fg.qty_available, 0) > 0
            GROUP BY 1, fg.recipe_id, fg.kg_per_unit
            """
        )
    ]

    return rozdziel_pokrycie(
        [
            {
                "id": o["id"],
                "order_no": o["order_no"],
                "client_id": o["client_id"] or "",
                "bierze_z_puli": (o["status"] or "") not in ("done", "cancelled"),
                "lines": wg_zam.get(o["id"], []),
            }
            for o in orders
        ],
        przypisane,
        pula,
    )


def _hydrate_order(
    order: Dict[str, Any], pokrycie: Dict[str, Dict[str, int]] | None = None
) -> Dict[str, Any]:
    lines = query_all(
        "SELECT * FROM client_order_lines WHERE order_id = %s", (order["id"],)
    )
    for line in lines:
        if not line.get("recipe_name") and line.get("recipe_id"):
            r = query_one(
                "SELECT name, product_type_name FROM recipes WHERE id=%s",
                (line["recipe_id"],),
            )
            if r:
                line["recipe_name"] = r["name"] or ""
                if not line.get("product_type_name"):
                    line["product_type_name"] = r.get("product_type_name") or ""
        if not line.get("product_type_name") and line.get("product_type_id"):
            pt = query_one(
                "SELECT name FROM product_types WHERE id=%s",
                (line["product_type_id"],),
            )
            if pt:
                line["product_type_name"] = pt["name"] or ""
        if not line.get("packaging_name") and line.get("packaging_id"):
            pkg = query_one(
                "SELECT name FROM packaging WHERE id=%s", (line["packaging_id"],)
            )
            if pkg:
                line["packaging_name"] = pkg["name"] or ""

    if pokrycie is None:
        pokrycie = _pokrycie_zamowien()
    moje = pokrycie.get(order["id"], {})
    for line in lines:
        line["qty_done"] = int(moje.get(line["id"], 0))

    order["lines"] = lines
    return order


def list_orders(status: str | None) -> List[Dict]:
    sql = "SELECT * FROM client_orders"
    params: list = []
    if status:
        sql += " WHERE status = %s"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    orders = query_all(sql, params or None)
    pokrycie = _pokrycie_zamowien()
    return [_hydrate_order(order, pokrycie) for order in orders]


def get_order(order_id: str) -> Dict[str, Any]:
    order = query_one("SELECT * FROM client_orders WHERE id = %s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    return _hydrate_order(order)


def create_order(dto: ClientOrderCreate) -> Dict:
    total_kg = sum(l.qty * l.kg_per_unit for l in dto.lines)
    total_units = sum(l.qty for l in dto.lines)

    with transaction() as conn:
        client = cx_query_one(
            conn, "SELECT * FROM clients WHERE id = %s", (dto.client_id,)
        )
        if not client:
            raise HTTPException(404, "Klient nie znaleziony")
        client_display = client.get("display_name") or client["name"]
        order_no = _next_client_order_no(conn, client_display, dto.order_date)

        order = cx_execute_returning(
            conn,
            """
            INSERT INTO client_orders
                (id, order_no, client_id, client_name, order_date, delivery_date,
                 total_kg, total_units, status, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'draft',%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                order_no,
                dto.client_id,
                client.get("display_name") or client["name"],
                dto.order_date,
                dto.delivery_date or None,
                round(total_kg, 3),
                total_units,
                dto.notes or None,
                now_iso(),
            ),
        )
        assert order is not None

        for line in dto.lines:
            rn, ptn, pkgn = _resolve_line_names(conn, line)
            cx_execute(
                conn,
                """
                INSERT INTO client_order_lines
                    (id, order_id, qty, kg_per_unit, total_kg,
                     product_type_id, product_type_name, recipe_id, recipe_name,
                     packaging_id, packaging_name)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    order["id"],
                    line.qty,
                    line.kg_per_unit,
                    round(line.qty * line.kg_per_unit, 3),
                    line.product_type_id or None,
                    ptn or None,
                    line.recipe_id,
                    rn or None,
                    line.packaging_id or None,
                    pkgn or None,
                ),
            )

        order["lines"] = cx_query_all(
            conn,
            "SELECT * FROM client_order_lines WHERE order_id = %s",
            (order["id"],),
        )
    logger.info("order.created", extra={"order_id": order["id"]})
    return order


def update_order_status(order_id: str, status: str) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE client_orders SET status=%s WHERE id=%s RETURNING *",
            (status, order_id),
        )
    if not row:
        raise HTTPException(404, "Zamówienie nie znalezione")
    logger.info("order.status_updated", extra={"order_id": order_id, "status": status})
    return row


def delete_order(order_id: str) -> Dict[str, bool]:
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT status FROM client_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        if order["status"] not in ("draft", "confirmed"):
            raise HTTPException(
                400,
                "Można usunąć tylko zamówienie w statusie Szkic lub Potwierdzone",
            )
        cx_execute(conn, "DELETE FROM client_orders WHERE id=%s", (order_id,))
    logger.info("order.deleted", extra={"order_id": order_id})
    return {"ok": True}


def update_order(order_id: str, dto: ClientOrderCreate) -> Dict:
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT * FROM client_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zamówienie nie znalezione")
        if order["status"] not in ("draft", "confirmed"):
            raise HTTPException(
                400,
                "Można edytować tylko zamówienia w statusie Szkic lub Potwierdzone",
            )
        client = cx_query_one(
            conn, "SELECT * FROM clients WHERE id=%s", (dto.client_id,)
        )
        if not client:
            raise HTTPException(404, "Klient nie znaleziony")

        total_kg = sum(l.qty * l.kg_per_unit for l in dto.lines)
        total_units = sum(l.qty for l in dto.lines)

        cx_execute(
            conn,
            """
            UPDATE client_orders
            SET client_id=%s, client_name=%s, order_date=%s, delivery_date=%s,
                total_kg=%s, total_units=%s, notes=%s
            WHERE id=%s
            """,
            (
                dto.client_id,
                client.get("display_name") or client["name"],
                dto.order_date,
                dto.delivery_date or None,
                round(total_kg, 3),
                total_units,
                dto.notes or None,
                order_id,
            ),
        )

        cx_execute(
            conn, "DELETE FROM client_order_lines WHERE order_id=%s", (order_id,)
        )
        for line in dto.lines:
            rn, ptn, pkgn = _resolve_line_names(conn, line)
            cx_execute(
                conn,
                """
                INSERT INTO client_order_lines
                    (id, order_id, qty, kg_per_unit, total_kg,
                     product_type_id, product_type_name, recipe_id, recipe_name,
                     packaging_id, packaging_name)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    order_id,
                    line.qty,
                    line.kg_per_unit,
                    round(line.qty * line.kg_per_unit, 3),
                    line.product_type_id or None,
                    ptn or None,
                    line.recipe_id,
                    rn or None,
                    line.packaging_id or None,
                    pkgn or None,
                ),
            )

        updated = cx_query_one(
            conn, "SELECT * FROM client_orders WHERE id=%s", (order_id,)
        )
        assert updated is not None
        updated["lines"] = cx_query_all(
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s", (order_id,)
        )
    logger.info("order.updated", extra={"order_id": order_id})
    return updated


def aggregate_order_progress(
    order_lines: List[Dict[str, Any]], plan_lines: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Dla każdej linii zamówienia liczy:
      qty_done    — faktycznie wyprodukowane szt (qty_done linii) z planów 'done'
      qty_pending — sumarycznie szt z planów 'draft' i 'active' (zarezerwowane)
      qty_reported — szt wpisane na tablecie we WSZYSTKICH planach poza
                     'cancelled' (także aktywnych) — tyle wejdzie na WZ/HDI
                     z zamówienia, które nie patrzą na status planu
      qty_total   — ilość zamówiona
      qty_remaining — qty_total - qty_done - qty_pending (jeśli > 0)

    Plany 'cancelled' nie liczą się wcale; plany 'done' liczą się tylko
    w wysokości realnej produkcji (qty_done), nie ilości zaplanowanej —
    plan zamknięty częściowo lub bez produkcji nie blokuje ponownego
    zaplanowania pozostałych sztuk.
    """
    agg: Dict[str, Dict[str, int]] = {}
    for pl in plan_lines:
        lid = pl.get("client_order_line_id")
        if not lid:
            continue
        a = agg.setdefault(lid, {"qty_done": 0, "qty_pending": 0, "qty_reported": 0})
        status = pl.get("plan_status")
        if status == "done":
            a["qty_done"] += int(pl.get("qty_done") or 0)
        elif status in ("draft", "active"):
            a["qty_pending"] += int(pl.get("qty") or 0)
        if status != "cancelled":
            a["qty_reported"] += int(pl.get("qty_done") or 0)

    result_lines = []
    for line in order_lines:
        a = agg.get(line["id"], {})
        qty_total = int(line["qty"] or 0)
        qty_done = int(a.get("qty_done") or 0)
        qty_pending = int(a.get("qty_pending") or 0)
        qty_remaining = max(0, qty_total - qty_done - qty_pending)
        result_lines.append(
            {
                "line_id": line["id"],
                "qty_total": qty_total,
                "qty_done": qty_done,
                "qty_pending": qty_pending,
                "qty_reported": int(a.get("qty_reported") or 0),
                "qty_remaining": qty_remaining,
            }
        )
    return result_lines


def quantity_chain(order_id: str) -> Dict[str, Any]:
    """Raport rozjazdu: łańcuch ilości per pozycja zamówienia (receptura+waga):
    zamówiono → zaplanowano → wpisano na tablecie → zeskanowano na produkcji →
    spakowano do kartonów → wyjechało (shipped) → na dokumencie WZ.
    Pokazuje, na którym etapie zginęły/przybyły sztuki.
    """
    import json as _json

    order = query_one(
        "SELECT id, order_no, client_name FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")

    def key_of(rid: Any, kg: Any) -> tuple:
        return (str(rid or ""), round(float(kg or 0), 3))

    rows: Dict[tuple, Dict[str, Any]] = {}

    def bucket(rid: Any, kg: Any, name: str = "") -> Dict[str, Any]:
        k = key_of(rid, kg)
        b = rows.setdefault(k, {
            "recipe_id": k[0], "kg_per_unit": k[1], "name": name,
            "ordered": 0, "planned": 0, "reported": 0,
            "scanned": 0, "packed": 0, "shipped": 0, "documented": 0,
        })
        if name and not b["name"]:
            b["name"] = name
        return b

    for ln in query_all(
        "SELECT recipe_id, recipe_name, kg_per_unit, qty FROM client_order_lines WHERE order_id=%s",
        (order_id,),
    ):
        b = bucket(ln["recipe_id"], ln["kg_per_unit"], ln.get("recipe_name") or "")
        b["ordered"] += int(ln.get("qty") or 0)

    plan_lines = query_all(
        """SELECT pl.id, pl.recipe_id, pl.recipe_name, pl.kg_per_unit, pl.qty, pl.qty_done
           FROM production_plan_lines pl
           JOIN production_plans pp ON pp.id = pl.plan_id
           WHERE pl.client_order_id=%s AND pp.status <> 'cancelled'""",
        (order_id,))
    for pl in plan_lines:
        b = bucket(pl["recipe_id"], pl["kg_per_unit"], pl.get("recipe_name") or "")
        b["planned"] += int(pl.get("qty") or 0)
        b["reported"] += int(pl.get("qty_done") or 0)

    plan_line_ids = [pl["id"] for pl in plan_lines]
    if plan_line_ids:
        for u in query_all(
            """SELECT recipe_id, weight_kg, status, COUNT(*) AS c
               FROM finished_units WHERE plan_line_id = ANY(%s)
               GROUP BY recipe_id, weight_kg, status""",
            (plan_line_ids,),
        ):
            b = bucket(u["recipe_id"], u["weight_kg"])
            c = int(u["c"] or 0)
            status = u.get("status") or ""
            if status != "planned":
                b["scanned"] += c
            if status in ("packed", "shipped"):
                b["packed"] += c
            if status == "shipped":
                b["shipped"] += c

    wz = query_one(
        "SELECT number, lines, loading_status, loading_diff, vehicle_plate "
        "FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "ORDER BY created_at LIMIT 1",
        (order_id,))
    if wz:
        wz_lines = wz.get("lines")
        if isinstance(wz_lines, str):
            wz_lines = _json.loads(wz_lines or "[]")
        for ln in wz_lines or []:
            b = bucket(ln.get("recipe_id"), ln.get("kg_per_unit"), ln.get("name") or "")
            b["documented"] += int(ln.get("qty") or 0)

    out = sorted(rows.values(), key=lambda r: (r["name"], -r["kg_per_unit"]))
    return {
        "order_id": order_id,
        "order_no": order["order_no"],
        "client_name": order.get("client_name"),
        "wz_number": (wz or {}).get("number"),
        "loading_status": (wz or {}).get("loading_status"),
        "vehicle_plate": (wz or {}).get("vehicle_plate"),
        "lines": out,
    }


def production_progress(order_id: str) -> Dict[str, Any]:
    """Postęp produkcji per linia zamówienia — patrz aggregate_order_progress."""
    order = query_one("SELECT id, order_no FROM client_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zamówienie nie znalezione")
    lines = query_all(
        "SELECT id, qty FROM client_order_lines WHERE order_id=%s", (order_id,)
    )
    plan_lines = query_all(
        """
        SELECT pl.client_order_line_id, pl.qty, pl.qty_done, pp.status AS plan_status
        FROM production_plan_lines pl
        JOIN production_plans pp ON pp.id = pl.plan_id
        WHERE pl.client_order_line_id IN (SELECT id FROM client_order_lines WHERE order_id=%s)
        """,
        (order_id,),
    )
    result_lines = aggregate_order_progress(lines, plan_lines)
    return {"order_id": order_id, "order_no": order["order_no"], "lines": result_lines}
