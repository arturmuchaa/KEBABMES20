from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from app.db import (
    cx_execute,
    execute,
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
from app.utils.product_key import Klucz, kandydaci, klucz_wyrobu
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


_klucz = klucz_wyrobu
_kandydaci = kandydaci


def _bierz_ze_stempla(polka: Dict[Klucz, List[Dict]], klucze: List[Klucz], ile: int
                      ) -> Tuple[int, int]:
    """Zdejmij `ile` sztuk z wierszy wyrobu. Zwraca (wzięte, w tym wysłane)."""
    wziete = wyslane = 0
    for klucz in klucze:
        for wiersz in polka.get(klucz, []):
            if ile <= 0:
                return wziete, wyslane
            bierz = min(ile, wiersz["qty"])
            if bierz <= 0:
                continue
            wiersz["qty"] -= bierz
            juz_poszlo = min(bierz, wiersz["shipped"])
            wiersz["shipped"] -= juz_poszlo
            wziete += bierz
            wyslane += juz_poszlo
            ile -= bierz
    return wziete, wyslane


def rozdziel_pokrycie(
    zamowienia: List[Dict[str, Any]],
    przypisane: Dict[str, List[Dict[str, Any]]],
    pula: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Dict[str, int]]]:
    """Ile sztuk każdej POZYCJI zamówienia jest zrobione i ile z tego wyjechało.

    * `zamowienia` — od najstarszego:
      `{"id", "order_no", "client_id", "bierze_z_puli", "lines": [{"id", "key", "qty"}]}`
    * `przypisane` — `{order_no: [{"key", "qty", "shipped"}]}`, wiersze wyrobu
      ostemplowane numerem zamówienia, w kolejności produkcji.
    * `pula` — zapas BEZ zamówienia: `{"client_id", "key", "qty"}`, tylko sztuki
      leżące na magazynie.

    Zwraca `{order_id: {line_id: {"done": szt, "shipped": szt}}}`.

    Reguły, każda z rozjazdu w biurze:

    1. Sztuki dzielą się między POZYCJE, nie mnożą przez nie, i trafiają na
       pozycję o TYM SAMYM RODZAJU (patrz `_klucz`, `_kandydaci`).
       Nadwyżka ponad zamówioną ilość ląduje na ostatniej pozycji tego wyrobu —
       nadprodukcji nie chowamy.
    2. Zapas podpisany klientem liczy się TYLKO jemu; zapas bez klienta
       (produkcja „na magazyn") pokrywa dowolne zamówienie, po kolei od
       najstarszego — jeden raz.
    3. „Wysłane" jest osobno od „zrobione": to, co wyjechało na WZ, nie leży
       już na magazynie i magazynier nie ma tego kompletować.
    """
    wynik: Dict[str, Dict[str, Dict[str, int]]] = {}
    brakuje: Dict[str, Dict[str, int]] = {}

    for zam in zamowienia:
        polka: Dict[Klucz, List[Dict]] = {}
        for wiersz in przypisane.get(zam.get("order_no") or "", []):
            polka.setdefault(wiersz["key"], []).append(
                {"qty": int(wiersz.get("qty") or 0), "shipped": int(wiersz.get("shipped") or 0)}
            )

        dla_zam: Dict[str, Dict[str, int]] = {}
        brak_zam: Dict[str, int] = {}
        ostatnia: Dict[Klucz, str] = {}
        for linia in zam["lines"]:
            potrzeba = int(linia.get("qty") or 0)
            klucze = _kandydaci(polka, linia["key"])
            for k in klucze:
                ostatnia[k] = linia["id"]
            wziete, wyslane = _bierz_ze_stempla(polka, klucze, potrzeba)
            dla_zam[linia["id"]] = {"done": wziete, "shipped": wyslane}
            brak_zam[linia["id"]] = max(0, potrzeba - wziete)

        # Nadprodukcja — reszta stempla ląduje na ostatniej pozycji tego wyrobu.
        for klucz, wiersze in polka.items():
            reszta = sum(w["qty"] for w in wiersze)
            if reszta <= 0 or klucz not in ostatnia:
                continue
            wziete, wyslane = _bierz_ze_stempla(polka, [klucz], reszta)
            cel = dla_zam[ostatnia[klucz]]
            cel["done"] += wziete
            cel["shipped"] += wyslane

        wynik[zam["id"]] = dla_zam
        brakuje[zam["id"]] = brak_zam

    wlasne: Dict[str, Dict[Klucz, int]] = {}
    niczyje: Dict[Klucz, int] = {}
    for row in pula:
        ile = int(row.get("qty") or 0)
        if ile <= 0:
            continue
        cid = (row.get("client_id") or "").strip()
        magazyn = wlasne.setdefault(cid, {}) if cid else niczyje
        magazyn[row["key"]] = magazyn.get(row["key"], 0) + ile

    for zam in zamowienia:
        if not zam.get("bierze_z_puli", True):
            continue
        cid = (zam.get("client_id") or "").strip()
        for linia in zam["lines"]:
            brak = brakuje[zam["id"]].get(linia["id"], 0)
            if brak <= 0:
                continue
            polki = [wlasne[cid]] if cid and cid in wlasne else []
            polki.append(niczyje)                      # potem „na magazyn"
            for magazyn in polki:
                for klucz in _kandydaci(magazyn, linia["key"]):
                    bierz = min(brak, magazyn.get(klucz, 0))
                    if bierz <= 0:
                        continue
                    magazyn[klucz] -= bierz
                    wynik[zam["id"]][linia["id"]]["done"] += bierz
                    brak -= bierz
                    if brak <= 0:
                        break
                if brak <= 0:
                    break

    return wynik


def _pokrycie_zamowien() -> Dict[str, Dict[str, Dict[str, int]]]:
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
    zywe_numery = {o["order_no"] for o in orders}
    linie = query_all(
        "SELECT id, order_id, recipe_id, kg_per_unit, product_type_id, qty "
        "FROM client_order_lines ORDER BY id"
    )
    wg_zam: Dict[str, List[Dict[str, Any]]] = {}
    for l in linie:
        wg_zam.setdefault(l["order_id"], []).append({
            "id": l["id"],
            "key": _klucz(l["recipe_id"], l["kg_per_unit"], l["product_type_id"]),
            "qty": int(l["qty"] or 0),
        })

    # Stempel po SKASOWANYM zamówieniu jest martwy: sztuki wracają do zapasu
    # klienta (jeśli jeszcze leżą), zamiast zniknąć z każdego widoku.
    przypisane: Dict[str, List[Dict[str, Any]]] = {}
    martwe: List[Dict[str, Any]] = []
    for r in query_all(
        """
        SELECT fg.client_order_no, fg.recipe_id, fg.kg_per_unit, fg.product_type_id,
               fg.qty, fg.qty_available, fg.qty_shipped,
               COALESCE(NULLIF(fg.client_id, ''), (
                   SELECT c.id FROM clients c
                   WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                   ORDER BY (c.name = fg.client_name) DESC
                   LIMIT 1
               ), '') AS client_id
        FROM finished_goods fg
        WHERE COALESCE(fg.client_order_no, '') <> ''
        ORDER BY fg.created_at, fg.id
        """
    ):
        klucz = _klucz(r["recipe_id"], r["kg_per_unit"], r["product_type_id"])
        if r["client_order_no"] in zywe_numery:
            przypisane.setdefault(r["client_order_no"], []).append(
                {"key": klucz, "qty": int(r["qty"] or 0), "shipped": int(r["qty_shipped"] or 0)}
            )
        elif int(r["qty_available"] or 0) > 0:
            martwe.append({"client_id": r["client_id"] or "", "key": klucz,
                           "qty": int(r["qty_available"] or 0)})

    # Zapas bez zamówienia liczy się tylko w wysokości qty_available — po
    # wydaniu rozchód stempluje sztuki numerem zamówienia, a reszta nie może
    # fantomowo pokrywać kolejnych zamówień tym samym, wydanym towarem.
    # Klienta bierzemy z client_id, a dla starszych wpisów rozpoznajemy go po
    # nazwie: w wyrobie stoi nazwa z KRS („POLAT D.O.O."), w zamówieniu
    # handlowa („POLAT").
    pula = martwe + [
        {
            "client_id": r["client_id"] or "",
            "key": _klucz(r["recipe_id"], r["kg_per_unit"], r["product_type_id"]),
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
                   fg.recipe_id, fg.kg_per_unit, fg.product_type_id,
                   SUM(fg.qty_available) AS qty
            FROM finished_goods fg
            WHERE COALESCE(fg.client_order_no, '') = ''
              AND COALESCE(fg.qty_available, 0) > 0
            GROUP BY 1, fg.recipe_id, fg.kg_per_unit, fg.product_type_id
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


def zamknij_wyslane_zamowienia(numery: List[str]) -> List[str]:
    """Zamówienie, z którego WSZYSTKO wyjechało, samo przechodzi na „zrealizowane".

    Wołane po wystawieniu WZ. Towar leżący jeszcze u nas zamówienia nie zamyka
    — magazynier ma je nadal na liście do kompletowania.
    """
    numery = [n for n in {(n or "").strip() for n in numery} if n]
    if not numery:
        return []
    orders = query_all(
        "SELECT id, order_no FROM client_orders "
        "WHERE order_no = ANY(%s) AND status NOT IN ('done', 'cancelled')",
        (numery,),
    )
    if not orders:
        return []
    pokrycie = _pokrycie_zamowien()
    zamkniete: List[str] = []
    for o in orders:
        lines = query_all(
            "SELECT id, qty FROM client_order_lines WHERE order_id = %s", (o["id"],)
        )
        moje = pokrycie.get(o["id"], {})
        if not lines or sum(int(l["qty"] or 0) for l in lines) <= 0:
            continue
        if all(int((moje.get(l["id"]) or {}).get("shipped") or 0) >= int(l["qty"] or 0)
               for l in lines):
            execute("UPDATE client_orders SET status='done' WHERE id=%s", (o["id"],))
            zamkniete.append(o["order_no"])
            logger.info("order.shipped.closed", extra={"order_id": o["id"]})
    return zamkniete


def _hydrate_order(
    order: Dict[str, Any],
    pokrycie: Dict[str, Dict[str, Dict[str, int]]] | None = None,
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
        stan = moje.get(line["id"]) or {}
        line["qty_done"] = int(stan.get("done") or 0)
        line["qty_shipped"] = int(stan.get("shipped") or 0)

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
