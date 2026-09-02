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
from app.services.finished_goods_service import przepnij_do_pilniejszego_cx
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


def _bierz(polka: Dict[Klucz, int], klucz: Klucz, ile: int) -> int:
    """Zdejmij do `ile` sztuk z półki (rodzaj musi pasować). Zwraca wzięte."""
    wziete = 0
    for k in _kandydaci(polka, klucz):
        if ile <= 0:
            break
        bierz = min(ile, polka.get(k, 0))
        if bierz <= 0:
            continue
        polka[k] -= bierz
        wziete += bierz
        ile -= bierz
    return wziete


def rozdziel_pokrycie(
    zamowienia: List[Dict[str, Any]],
    zapas: List[Dict[str, Any]],
    wydania: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Dict[str, int]]]:
    """Ile z każdej POZYCJI zamówienia leży na magazynie, a ile już wydano.

    * `zamowienia` — od najstarszego:
      `{"id", "order_no", "client_id", "bierze_z_puli", "zrealizowane",
        "lines": [{"id", "key", "qty"}]}`
    * `zapas` — wyrób FIZYCZNIE leżący na magazynie (tylko `qty_available`):
      `{"order_no": stempel albo "", "client_id", "key", "qty"}`
    * `wydania` — pozycje WZ (nieanulowanych): `{"order_id": "" albo id,
      "client_id": nabywca, "key", "qty"}`

    Zwraca `{order_id: {line_id: {"stan": szt, "wydane": szt}}}`.

    Reguła nadrzędna (właściciel, 27.08.2026): **magazyn wyrobu gotowego to
    świętość**. Zamówienie pokrywa tylko to, co leży na magazynie, plus to,
    co wyjechało DO TEGO KLIENTA. Towar sprzedany komuś innemu po prostu
    znika ze stanu — na zamówieniu nie zostawia żadnego śladu, bo klient
    nadal go potrzebuje. Każda sztuka liczy się dokładnie raz: najpierw
    zamówieniu, na które jest ostemplowana, potem swojemu klientowi, na
    końcu (towar niczyj) po kolei od najstarszego zamówienia.
    """
    wynik: Dict[str, Dict[str, Dict[str, int]]] = {
        z["id"]: {l["id"]: {"stan": 0, "wydane": 0} for l in z["lines"]}
        for z in zamowienia
    }

    # ── Wydania ──────────────────────────────────────────────────────────
    wyd_zam: Dict[str, Dict[Klucz, int]] = {}
    wyd_klient: Dict[str, List[Dict[str, Any]]] = {}
    for w in wydania:
        ile = int(w.get("qty") or 0)
        if ile <= 0:
            continue
        oid = (w.get("order_id") or "").strip()
        if oid:
            polka = wyd_zam.setdefault(oid, {})
            polka[w["key"]] = polka.get(w["key"], 0) + ile
            continue
        cid = (w.get("client_id") or "").strip()
        if not cid:                       # nabywca spoza kartoteki — nie wiemy czyje
            continue
        wyd_klient.setdefault(cid, []).append(
            {"key": w["key"], "qty": ile, "kiedy": str(w.get("kiedy") or "")})
    for lista in wyd_klient.values():
        lista.sort(key=lambda p: p["kiedy"])

    for zam in zamowienia:                # WZ wystawiony Z zamówienia
        polka = wyd_zam.get(zam["id"])
        if not polka:
            continue
        for linia in zam["lines"]:
            wynik[zam["id"]][linia["id"]]["wydane"] += _bierz(
                polka, linia["key"], int(linia.get("qty") or 0))

    # Zamówienie ZREALIZOWANE jest zamknięte — jego liczby już się nie ruszają.
    #
    # Zamykamy je dopiero wtedy, gdy KAŻDA pozycja jest w całości wydana
    # (`zamknij_wyslane_zamowienia`), więc pokrycie znamy bez żadnej migawki:
    # wydane = zamówione. Wcześniej liczyło się dalej ze wspólnej puli klienta
    # i każdy nowy ręczny WZ przepisywał liczby na dokumencie, który dawno
    # wyjechał — u klienta z kilkoma spółkami (YALCIN) wysyłka do jednej
    # zabierała kilogramy zamówieniu drugiej (zgłoszenie 28.08.2026).
    for zam in zamowienia:
        if not zam.get("zrealizowane"):
            continue
        for linia in zam["lines"]:
            wynik[zam["id"]][linia["id"]]["wydane"] = int(linia.get("qty") or 0)

    # WZ ręczny — po nabywcy, od najstarszego zamówienia. Liczy się tylko
    # dokument wystawiony PO założeniu zamówienia: lipcowa dostawa do YBM
    # doklejała się do zamówienia z 27.08 i pokazywała „wydane" na pozycjach,
    # których nikt nie wydał (biuro, 27.08.2026).
    for zam in zamowienia:
        # Zamknięte zamówienie do wspólnej puli już nie sięga — inaczej
        # trzymałoby sztuki, których potrzebuje zamówienie wciąż otwarte.
        if not zam.get("bierze_z_puli", True):
            continue
        lista = wyd_klient.get((zam.get("client_id") or "").strip())
        if not lista:
            continue
        od = str(zam.get("kiedy") or "")
        for linia in zam["lines"]:
            stan = wynik[zam["id"]][linia["id"]]
            brak = max(0, int(linia.get("qty") or 0) - stan["wydane"])
            if brak <= 0:
                continue
            for poz in lista:
                if brak <= 0:
                    break
                if poz["qty"] <= 0 or poz["kiedy"] < od:
                    continue
                if not _kandydaci({poz["key"]: poz["qty"]}, linia["key"]):
                    continue
                bierz = min(brak, poz["qty"])
                poz["qty"] -= bierz
                stan["wydane"] += bierz
                brak -= bierz

    # ── Zapas na magazynie ───────────────────────────────────────────────
    stemple: Dict[str, Dict[Klucz, int]] = {}
    wlasne: Dict[str, Dict[Klucz, int]] = {}
    niczyje: Dict[Klucz, int] = {}
    for row in zapas:
        ile = int(row.get("qty") or 0)
        if ile <= 0:
            continue
        stempel = (row.get("order_no") or "").strip()
        cid = (row.get("client_id") or "").strip()
        if stempel:
            polka = stemple.setdefault(stempel, {})
        elif cid:
            polka = wlasne.setdefault(cid, {})
        else:
            polka = niczyje
        polka[row["key"]] = polka.get(row["key"], 0) + ile

    def brakuje(zam: Dict[str, Any], linia: Dict[str, Any]) -> int:
        stan = wynik[zam["id"]][linia["id"]]
        return max(0, int(linia.get("qty") or 0) - stan["wydane"] - stan["stan"])

    # 1. Najpierw to, co ostemplowane TYM zamówieniem.
    zywe = [z for z in zamowienia if z.get("bierze_z_puli", True)]
    for zam in zywe:
        polka = stemple.get(zam.get("order_no") or "")
        if not polka:
            continue
        for linia in zam["lines"]:
            wynik[zam["id"]][linia["id"]]["stan"] += _bierz(
                polka, linia["key"], brakuje(zam, linia))

    # 2. Reszta stempla wraca do zapasu klienta — sztuki zrobione ponad jedno
    #    zamówienie leżą na magazynie i mogą pokryć następne. Na zamówieniu
    #    NIE pokazujemy ich jako nadwyżki: pokrycie kończy się na zamówionej
    #    ilości, inaczej pozycja pokazuje 120 ze 80.
    wg_numeru = {z.get("order_no"): z for z in zamowienia}
    for numer, polka in stemple.items():
        cel_zam = wg_numeru.get(numer) or {}
        cid = (cel_zam.get("client_id") or "").strip()
        cel = wlasne.setdefault(cid, {}) if cid else niczyje
        for klucz, ile in polka.items():
            if ile > 0:
                cel[klucz] = cel.get(klucz, 0) + ile
        polka.clear()

    # 3. Zapas klienta, a na końcu towar niczyj („na magazyn") — po kolei od
    #    najstarszego zamówienia, każda sztuka RAZ.
    for zam in zywe:
        cid = (zam.get("client_id") or "").strip()
        polki = [p for p in (wlasne.get(cid) if cid else None, niczyje) if p is not None]
        for linia in zam["lines"]:
            for polka in polki:
                brak = brakuje(zam, linia)
                if brak <= 0:
                    break
                wynik[zam["id"]][linia["id"]]["stan"] += _bierz(polka, linia["key"], brak)

    return wynik


def _pokrycie_zamowien() -> Dict[str, Dict[str, Dict[str, int]]]:
    """Liczy pokrycie WSZYSTKICH zamówień naraz — inaczej ten sam zapas
    pokazuje się przy każdym z osobna.

    Klienta sprowadzamy do PULI: spółki w jednej grupie odbiorców dzielą zapas,
    bo dla hali to jeden kontrahent (YALCIN to dwie spółki, odbiorca wrocławski
    ma pięć oddziałów). Spółka bez grupy jest własną pulą, więc dla reszty
    kartoteki nic się nie zmienia."""
    from app.services.client_groups_service import pule_klientow
    pule = pule_klientow()
    pula = lambda cid: pule.get((cid or "").strip(), (cid or "").strip())  # noqa: E731
    orders = query_all(
        """
        SELECT id, order_no, client_id, status, created_at
        FROM client_orders
        ORDER BY order_date, created_at, order_no
        """
    )
    if not orders:
        return {}
    # Stempel liczy się tylko dla ŻYWEGO zamówienia. Po skasowaniu (albo
    # zamknięciu) zamówienia sztuki wracają do zapasu klienta, zamiast
    # zniknąć z każdego widoku.
    zywe_numery = {
        o["order_no"] for o in orders
        if (o["status"] or "") not in ("done", "cancelled")
    }
    linie = query_all(
        "SELECT id, order_id, recipe_id, kg_per_unit, product_type_id, packaging_id, qty "
        "FROM client_order_lines ORDER BY order_id, position"
    )
    wg_zam: Dict[str, List[Dict[str, Any]]] = {}
    for l in linie:
        wg_zam.setdefault(l["order_id"], []).append({
            "id": l["id"],
            "key": _klucz(l["recipe_id"], l["kg_per_unit"], l["product_type_id"], l["packaging_id"]),
            "qty": int(l["qty"] or 0),
        })

    # Zapas: tylko sztuki, które FIZYCZNIE leżą (qty_available). Klienta
    # bierzemy z client_id, a dla starszych wpisów rozpoznajemy go po nazwie:
    # w wyrobie stoi nazwa z KRS („POLAT D.O.O."), w zamówieniu handlowa
    # („POLAT").
    zapas = [
        {
            "order_no": r["client_order_no"] if r["client_order_no"] in zywe_numery else "",
            "client_id": pula(r["client_id"] or ""),
            "key": _klucz(r["recipe_id"], r["kg_per_unit"], r["product_type_id"], r["packaging_id"]),
            "qty": int(r["qty"] or 0),
        }
        for r in query_all(
            """
            SELECT COALESCE(fg.client_order_no, '') AS client_order_no,
                   COALESCE(NULLIF(fg.client_id, ''), (
                       SELECT c.id FROM clients c
                       WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                       ORDER BY (c.name = fg.client_name) DESC
                       LIMIT 1
                   ), '') AS client_id,
                   fg.recipe_id, fg.kg_per_unit, fg.product_type_id, fg.packaging_id,
                   SUM(fg.qty_available) AS qty
            FROM finished_goods fg
            WHERE COALESCE(fg.qty_available, 0) > 0
            GROUP BY 1, 2, fg.recipe_id, fg.kg_per_unit, fg.product_type_id, fg.packaging_id
            """
        )
    ]

    # Wydania: pozycje wyrobu z WZ (nieanulowanych). Nabywcę rozpoznajemy
    # w kartotece — WZ na kogoś spoza niej (np. zakup pracownika) nie jest
    # wydaniem na żadne zamówienie.
    wydania = [
        {
            "order_id": r["order_id"] or "",
            "client_id": pula(r["client_id"] or ""),
            "key": _klucz(r["recipe_id"], r["kg_per_unit"], r["product_type_id"], r["packaging_id"]),
            "qty": int(float(r["qty"] or 0)),
            "kiedy": str(r["kiedy"] or ""),
        }
        for r in query_all(
            """
            SELECT CASE WHEN w.source_type = 'order' THEN COALESCE(w.source_id, '')
                        ELSE '' END AS order_id,
                   COALESCE((
                       SELECT c.id FROM clients c
                       WHERE c.name = w.buyer_name OR c.display_name = w.buyer_name
                       ORDER BY (c.name = w.buyer_name) DESC
                       LIMIT 1
                   ), '') AS client_id,
                   COALESCE(fg.recipe_id, li->>'recipe_id', '') AS recipe_id,
                   COALESCE(fg.kg_per_unit, (li->>'kg_per_unit')::numeric, 0) AS kg_per_unit,
                   COALESCE(fg.product_type_id, li->>'product_type_id', '') AS product_type_id,
                   COALESCE(fg.packaging_id, li->>'packaging_id', '') AS packaging_id,
                   w.created_at AS kiedy,
                   SUM(COALESCE((li->>'qty')::numeric, 0)) AS qty
            FROM wz_documents w
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.lines, '[]'::jsonb)) li
            LEFT JOIN finished_goods fg ON fg.id = li->>'stock_id'
            WHERE COALESCE(w.status, '') <> 'anulowany'
              AND (COALESCE(li->>'stock_type', '') = 'fg'
                   OR (w.source_type = 'order' AND COALESCE(li->>'recipe_id', '') <> ''))
            GROUP BY 1, 2, 3, 4, 5, 6, 7
            """
        )
    ]

    return rozdziel_pokrycie(
        [
            {
                "id": o["id"],
                "order_no": o["order_no"],
                "client_id": pula(o["client_id"] or ""),
                "bierze_z_puli": (o["status"] or "") not in ("done", "cancelled"),
                "zrealizowane": (o["status"] or "") == "done",
                "kiedy": str(o["created_at"] or ""),
                "lines": wg_zam.get(o["id"], []),
            }
            for o in orders
        ],
        zapas,
        wydania,
    )


def numery_zamowien_klienta(nazwa_nabywcy: str) -> List[str]:
    """Otwarte zamówienia nabywcy — po nazwie z kartoteki (pełnej albo
    handlowej). Ręczny WZ zdejmuje czasem sztuki NICZYJE, więc stempel na
    wierszu wyrobu nie wystarcza, żeby wiedzieć, czyje zamówienie sprawdzić.
    """
    nazwa = (nazwa_nabywcy or "").strip()
    if not nazwa:
        return []
    return [
        r["order_no"]
        for r in query_all(
            """
            SELECT o.order_no
            FROM client_orders o
            LEFT JOIN clients c ON c.id = o.client_id
            WHERE o.status NOT IN ('done', 'cancelled')
              AND (c.name = %s OR c.display_name = %s OR o.client_name = %s)
            ORDER BY o.order_date, o.created_at, o.order_no
            """,
            (nazwa, nazwa, nazwa),
        )
    ]


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
        if all(int((moje.get(l["id"]) or {}).get("wydane") or 0) >= int(l["qty"] or 0)
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
        "SELECT * FROM client_order_lines WHERE order_id = %s ORDER BY position",
        (order["id"],)
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
        # qty_stock — leży na magazynie, qty_delivered — pojechało do klienta.
        # qty_done (suma) zostaje dla widoków, które pytają „ile z tego już
        # jest": pasek postępu, pulpit, import z zamówień.
        line["qty_stock"] = int(stan.get("stan") or 0)
        line["qty_delivered"] = int(stan.get("wydane") or 0)
        line["qty_done"] = line["qty_stock"] + line["qty_delivered"]

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

        # `position` utrwala KOLEJNOŚĆ dokumentu — wiersze dostają nowe id
        # przy każdej edycji, więc bez niej nie ma czego sortować.
        for poz, line in enumerate(dto.lines):
            rn, ptn, pkgn = _resolve_line_names(conn, line)
            cx_execute(
                conn,
                """
                INSERT INTO client_order_lines
                    (id, order_id, position, qty, kg_per_unit, total_kg,
                     product_type_id, product_type_name, recipe_id, recipe_name,
                     packaging_id, packaging_name)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    order["id"],
                    poz,
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

        # Sztuki nieruszone, ostemplowane zamówieniem tego klienta jadącym
        # PÓŹNIEJ, przechodzą na to zamówienie — jeśli wyjeżdża wcześniej.
        # Stempel to przydział, nie fakt fizyczny (patrz
        # `przepnij_do_pilniejszego_cx`).
        przepiete = przepnij_do_pilniejszego_cx(conn, order["id"])

        order["lines"] = cx_query_all(
            conn,
            "SELECT * FROM client_order_lines WHERE order_id = %s ORDER BY position",
            (order["id"],),
        )
    logger.info("order.created",
                extra={"order_id": order["id"], "reallocated": przepiete})
    return order


def przepnij_sztuki(order_id: str) -> Dict[str, Any]:
    """Ręczne uruchomienie przepięcia dla istniejącego zamówienia.

    Przy zakładaniu zamówienia dzieje się to samo. Ta droga jest dla zamówień
    ZAŁOŻONYCH WCZEŚNIEJ oraz dla sytuacji, gdy data wyjazdu zmieniła się już
    po założeniu — wtedy pierwszeństwo się przestawia, a nikt nie zakłada
    zamówienia od nowa.
    """
    with transaction() as conn:
        przepiete = przepnij_do_pilniejszego_cx(conn, order_id)
    logger.info("order.reallocated_manually",
                extra={"order_id": order_id, "qty": przepiete})
    return {"orderId": order_id, "przepiete": przepiete}


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
        # `position` utrwala KOLEJNOŚĆ dokumentu — wiersze dostają nowe id
        # przy każdej edycji, więc bez niej nie ma czego sortować.
        for poz, line in enumerate(dto.lines):
            rn, ptn, pkgn = _resolve_line_names(conn, line)
            cx_execute(
                conn,
                """
                INSERT INTO client_order_lines
                    (id, order_id, position, qty, kg_per_unit, total_kg,
                     product_type_id, product_type_name, recipe_id, recipe_name,
                     packaging_id, packaging_name)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    cuid(),
                    order_id,
                    poz,
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
            conn, "SELECT * FROM client_order_lines WHERE order_id=%s ORDER BY position",
            (order_id,)
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
