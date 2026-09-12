"""Pokrycie zamówienia zapasem magazynowym wyrobów gotowych.

Dokumenty z zamówienia (WZ/HDI/CMR) liczą produkcję z linii planu
(`production_plan_lines.client_order_id`). Produkcja "na magazyn" robiona
PRZED zamówieniem nie ma tego linku, mimo że fizycznie pokrywa zamówienie
(widok zamówień liczy ją do qty_done). Ten moduł domyka tę asymetrię:
brakującą część zamówienia uzupełnia porcjami z `finished_goods`
(dopasowanie po recepturze + wadze sztuki), żeby dokumenty dało się
wystawić także dla towaru zrobionego na magazyn.

Kolejność czerpania:
    1. wiersze już ostemplowane TYM zamówieniem (`client_order_no`) —
       liczą się pełnym qty (rozchód mógł już wyzerować qty_available),
    2. wiersze bez zamówienia — tylko qty_available, FIFO po dacie produkcji.

Wiersze powstałe z planów podpiętych pod to zamówienie są wykluczone —
te sztuki są już policzone w qty_done linii planu (anty-dublowanie).
"""
from typing import Any, Dict, List

from app.db import query_all, query_one
from app.utils.product_key import Klucz as Key
from app.utils.product_key import kandydaci, klucz_wyrobu

_key = klucz_wyrobu


def produced_by_key_from_plan_lines(plan_lines: List[Dict[str, Any]]) -> Dict[Key, int]:
    """Suma qty_done linii planu per (receptura, waga sztuki)."""
    out: Dict[Key, int] = {}
    for pl in plan_lines or []:
        k = _key(pl.get("recipe_id"), pl.get("kg_per_unit"), pl.get("product_type_id"),
                 pl.get("packaging_id"))
        out[k] = out.get(k, 0) + int(pl.get("qty_done") or 0)
    return out


def compute_shortfalls(
    order_lines: List[Dict[str, Any]],
    produced_by_key: Dict[Key, int],
    cartoned_by_key: Dict[Key, int] = None,
) -> Dict[Key, int]:
    """Ile sztuk per (receptura, waga) brakuje do pokrycia zamówienia po odjęciu
    produkcji zaraportowanej na planach tego zamówienia ORAZ sztuk już spakowanych
    do kartonów powiązanych z tym zamówieniem (anty-dublowanie z FIFO finished_goods)."""
    short: Dict[Key, int] = {}
    for ln in order_lines or []:
        k = _key(ln.get("recipe_id"), ln.get("kg_per_unit"), ln.get("product_type_id"),
                 ln.get("packaging_id"))
        short[k] = short.get(k, 0) + int(ln.get("qty") or 0)
    # Odejmowanie idzie po RODZAJU: produkcja UDO 100 % nie zamyka pozycji
    # 95/5. Wpis bez rodzaju (starsze dane) pasuje do każdej — patrz
    # `kandydaci`.
    for mapa in (produced_by_key, cartoned_by_key):
        for k, zrobione in (mapa or {}).items():
            zostalo = int(zrobione or 0)
            for cel in kandydaci(short, k):
                if zostalo <= 0:
                    break
                odejmij = min(zostalo, short.get(cel, 0))
                if odejmij <= 0:
                    continue
                short[cel] -= odejmij
                zostalo -= odejmij
    return {k: v for k, v in short.items() if v > 0}


def portion_stock_rows(
    shortfalls: Dict[Key, int],
    fg_rows: List[Dict[str, Any]],
    order_no: str,
    wydane_wg_wiersza: Dict[str, int] = None,
) -> List[Dict[str, Any]]:
    """Rozbij braki na porcje z wierszy finished_goods (w podanej kolejności).

    Wiersz wnosi to, co LEŻY (``qty_available``), powiększone o sztuki już
    wydane NA TO ZAMÓWIENIE (`wydane_wg_wiersza`) — dokument wystawiany po WZ
    musi je nadal wykazać, bo pojechały z tym zamówieniem.

    Sztuk sprzedanych komuś innemu NIE liczymy, nawet gdy wiersz nosi stempel
    tego zamówienia: TRUVA miała 30 szt. wydane ręcznym WZ do innego nabywcy
    i weszłyby jej na HDI, choć ich nie dostała (biuro, 27.08.2026).

    Zwraca ``[{"fg": wiersz, "take": szt}]``.
    """
    wydane_wg_wiersza = wydane_wg_wiersza or {}
    remaining = dict(shortfalls or {})
    portions: List[Dict[str, Any]] = []
    for row in fg_rows or []:
        k = _key(row.get("recipe_id"), row.get("kg_per_unit"), row.get("product_type_id"),
                 row.get("packaging_id"))
        # Jeden wiersz → jedna porcja (rozchód idzie potem dokładnie z niego),
        # więc bierzemy pierwszy pasujący brak, nie rozbijamy po kilku.
        cel = next((c for c in kandydaci(remaining, k) if int(remaining.get(c) or 0) > 0), None)
        if cel is None:
            continue
        need = int(remaining.get(cel) or 0)
        # Ile ten wiersz wnosi: to, co LEŻY, plus sztuki wydane NA TO
        # zamówienie. Wiersz ostemplowany tym zamówieniem niesie swoje
        # `qty_shipped` — rozchód WZ dzieli wiersz i wydane sztuki lądują
        # w KLONIE, którego pozycja WZ (wskazująca id oryginału) nie zna.
        wlasny_stempel = order_no and (row.get("client_order_no") or "").strip() == order_no
        pool = int(row.get("qty_available") or 0) + (
            int(row.get("qty_shipped") or 0) if wlasny_stempel
            else int(wydane_wg_wiersza.get(row.get("id")) or 0)
        )
        take = min(need, pool)
        if take <= 0:
            continue
        portions.append({"fg": row, "take": take})
        remaining[cel] = need - take
    return portions


def stock_portions_for_order(
    order_id: str,
    order_no: str,
    order_lines: List[Dict[str, Any]],
    produced_by_key: Dict[Key, int],
) -> List[Dict[str, Any]]:
    """Porcje magazynowe pokrywające braki zamówienia (patrz moduł)."""
    # Sztuki spakowane do kartonów powiązanych z tym zamówieniem już je pokrywają —
    # wyklucz je z FIFO finished_goods, żeby nie liczyć ich drugi raz.
    cartoned_rows = query_all(
        """
        SELECT fu.recipe_id, fu.weight_kg, fu.product_type_id, COUNT(*) AS qty
        FROM finished_units fu
        JOIN stock_cartons sc ON sc.id = fu.carton_id
        WHERE sc.linked_order_id = %s AND fu.status IN ('packed', 'shipped')
        GROUP BY fu.recipe_id, fu.weight_kg, fu.product_type_id
        """,
        (order_id,),
    )
    cartoned_by_key = {
        _key(r["recipe_id"], r["weight_kg"], r.get("product_type_id")): int(r["qty"])
        for r in cartoned_rows
    }
    shortfalls = compute_shortfalls(order_lines, produced_by_key, cartoned_by_key)
    if not shortfalls:
        return []
    # Kolejność: stempel tego zamówienia → zapas własny albo niczyj → dopiero
    # na końcu towar podpisany INNYM klientem. Samo FEFO wystawiało dokument
    # z najstarszego wiersza na magazynie, choć leżał tam pod czyjąś nazwą.
    fg_rows = query_all(
        """
        SELECT id, batch_no, recipe_id, recipe_name, product_type_id, product_type_name,
               packaging_id, packaging_name,
               kg_per_unit, qty, qty_available, qty_shipped,
               client_order_no, client_name, produced_date, created_at
        FROM finished_goods fg
        WHERE COALESCE(fg.qty, 0) > 0
          AND (
               -- Ostemplowane TYM zamówieniem — należy do niego bezwarunkowo.
               -- Nazwa klienta nie jest tu żadnym dowodem: w kartotece bywają
               -- dwie karty o tej samej nazwie handlowej (biuro rozbiło YBM na
               -- dwie 27.08.2026) i klony po rozchodzie wypadały z dokumentu.
               fg.client_order_no = %s
               OR (
                   -- Wolne sztuki: bez stempla albo po SKASOWANYM (zamkniętym)
                   -- zamówieniu — wtedy wracają do obrotu. Bez tego HDI dla
                   -- nowego zamówienia YBM wyszło na 104 szt. zamiast całości.
                   (COALESCE(fg.client_order_no, '') = ''
                    OR NOT EXISTS (SELECT 1 FROM client_orders o2
                                   WHERE o2.order_no = fg.client_order_no
                                     AND o2.status NOT IN ('done', 'cancelled')))
                   -- ...i tylko towar TEGO klienta albo niczyj. Cudzy wolno
                   -- sprzedać, ale ręcznym WZ, świadomie — dokument z
                   -- zamówienia nie wciąga po cichu kebabu innego klienta.
                   AND COALESCE(NULLIF(fg.client_id, ''), (
                           SELECT c.id FROM clients c
                           WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                           ORDER BY (c.name = fg.client_name) DESC
                           LIMIT 1
                       ), '') IN ('', COALESCE((SELECT o3.client_id FROM client_orders o3
                                                WHERE o3.id = %s), ''))
               ))
          AND COALESCE(fg.source_production_id, '') NOT IN (
              SELECT DISTINCT pl.plan_id FROM production_plan_lines pl
              WHERE pl.client_order_id = %s)
        -- COALESCE, nie gołe porównanie: `NULL = 'ZAM/7/08'` daje w SQL NULL,
        -- a przy DESC Postgres stawia NULL-e PIERWSZE. Bez tego 13 wierszy
        -- bez stempla wyprzedzało 34 ostemplowane (produkcja, 30.08.2026) —
        -- odwrotnie niż mówi reguła kolejności opisana na górze modułu.
        ORDER BY (COALESCE(fg.client_order_no, '') = %s) DESC,
                 (COALESCE(NULLIF(fg.client_id, ''), (
                      SELECT c.id FROM clients c
                      WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                      ORDER BY (c.name = fg.client_name) DESC
                      LIMIT 1
                  ), '') IN ('', COALESCE((
                      SELECT o.client_id FROM client_orders o WHERE o.id = %s), ''))) DESC,
                 produced_date ASC NULLS LAST, created_at ASC
        """,
        (order_no, order_id, order_id, order_no, order_id),
    )
    # Sztuki, które wyjechały NA TO zamówienie — dokument wystawiany po WZ
    # musi je nadal wykazać. Rozpoznajemy po dokumencie WZ: wystawionym
    # z zamówienia albo ręcznym na tego samego nabywcę.
    wydane_wg_wiersza = {
        r["stock_id"]: int(float(r["qty"] or 0))
        for r in query_all(
            """
            SELECT li->>'stock_id' AS stock_id,
                   SUM(COALESCE((li->>'qty')::numeric, 0)) AS qty
            FROM wz_documents w
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.lines, '[]'::jsonb)) li
            WHERE COALESCE(w.status, '') <> 'anulowany'
              AND COALESCE(li->>'stock_id', '') <> ''
              AND ((w.source_type = 'order' AND w.source_id = %s)
                   -- Ręczny WZ na tego nabywcę, ale tylko wystawiony PO
                   -- założeniu zamówienia. Bez tej daty lipcowa dostawa do YBM
                   -- wciągała na HDI kebaby z lipca, których fizycznie nie ma.
                   OR (COALESCE((
                          SELECT c.id FROM clients c
                          WHERE c.name = w.buyer_name OR c.display_name = w.buyer_name
                          ORDER BY (c.name = w.buyer_name) DESC
                          LIMIT 1
                      ), '-') = COALESCE((
                          SELECT o4.client_id FROM client_orders o4 WHERE o4.id = %s
                      ), '?')
                       AND w.created_at >= (
                          SELECT o5.created_at FROM client_orders o5 WHERE o5.id = %s)))
            GROUP BY 1
            """,
            (order_id, order_id, order_id),
        )
    }
    return portion_stock_rows(shortfalls, fg_rows, order_no, wydane_wg_wiersza)


def rozpis_palet(pallet_ids: List[str]) -> List[Dict[str, Any]]:
    """Zawartość wskazanych palet WEDŁUG ROZPISU biura.

    Pozycja palety wskazuje LINIĘ zamówienia, a z niej bierzemy tożsamość
    wyrobu (receptura, waga sztuki, rodzaj, tuleja). Partii rozpis nie zna —
    tę wskazuje dopiero magazyn albo dokument (patrz `picks_for_pallets`
    i `picks_z_dokumentu`).
    """
    if not pallet_ids:
        return []
    return query_all(
        """
        SELECT l.recipe_id, l.kg_per_unit, l.product_type_id, l.packaging_id,
               SUM(i.qty) AS qty
          FROM order_pallet_items i
          JOIN client_order_lines l ON l.id = i.order_line_id
         WHERE i.pallet_id = ANY(%s)
         GROUP BY 1, 2, 3, 4
        """,
        (pallet_ids,),
    )


def picks_z_dokumentu(pallet_ids: List[str],
                      linie_dokumentu: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Zawartość palet rozpisana na PARTIE Z JUŻ WYSTAWIONEGO DOKUMENTU.

    Kiedy zamówienie ma dokument, który zdjął towar ze stanu (WM przy podziale
    wysyłki), pytanie „z jakich partii jedzie ten towar" jest już
    rozstrzygnięte — i to jego rozstrzygnięcie wisi na wydruku u kierowcy.
    `picks_for_pallets` wyprowadzało je DRUGI RAZ z bieżącego stanu, czyli
    z tego, co po tym dokumencie ZOSTAŁO. Na magazynie tego zakładu (linia
    zamówienia ~76 szt., wiersz `finished_goods` ~17 szt., średnie
    `qty_available` 9,4) WM opróżnia wiersze co do sztuki, więc drugie
    wyprowadzenie trafiało w resztki z INNYCH partii, w nic albo w za mało
    (review końcowy, blokujące 1, 2026-09-11).

    Tu porównujemy więc rozpis palet (co magazynier zeskanował) z liniami
    dokumentu (co biuro wydało) — dwa NIEZALEŻNE źródła, więc weryfikacja
    dalej ma sens; stan magazynu, który obie strony już opisały, nie bierze
    w niej udziału i nie ma jak ich poróżnić.

    Nadwyżka rozpisu ponad dokument NIE znika po cichu: wraca jako porcja
    BEZ PARTII, więc `verify_wz_against_loaded` pokazuje ją jako rozjazd
    („na paletach więcej, niż mówi papier") zamiast blokować całe auto.

    Zwraca ten sam kształt co `picks_for_pallets` (`[{"fg": ..., "take": n}]`),
    ale wiersze są SZTUCZNE i celowo BEZ `id`: opisują dokument, nie magazyn,
    i nie wolno z nich rozchodować.
    """
    braki = compute_shortfalls(rozpis_palet(pallet_ids), {}, {})
    if not braki:
        return []
    wiersze = [
        {"recipe_id": l.get("recipe_id"), "kg_per_unit": l.get("kg_per_unit"),
         "batch_no": l.get("batch_no"), "qty_available": int(l.get("qty") or 0)}
        for l in linie_dokumentu or []
        if int(l.get("qty") or 0) > 0
    ]
    # Braki scalamy do (receptura, waga sztuki) — BEZ rodzaju i tulei.
    #
    # Linia dokumentu niesie PARTIĘ, nie rodzaj. Zestawiana z brakami po pełnym
    # kluczu kazała `kandydaci` rozstrzygać remis między wariantami tej samej
    # receptury alfabetycznie po rodzaju — w kolejności, która z zawartością
    # dokumentu nie ma nic wspólnego. Przy zamówieniu na UDO 100 % obok
    # MIX 95/5 (ta sama receptura, ta sama waga, inny rodzaj — układ
    # z incydentu TRUVA, patrz `app/utils/product_key.py`) wiersz partii
    # jednego wariantu dostawał brak DRUGIEGO, brał `min(potrzeba, qty)`,
    # a resztę gubił: auto zgodne z papierem co do sztuki meldowało ROZJAZD.
    #
    # Scalenie niczego nie traci: rodzaju i tak nie ma z czym porównać, a sumy
    # per partia zostają nienaruszone — `kandydaci` nigdy nie przenosi sztuk
    # między recepturami ani wagami, więc granice, na których stoi
    # weryfikacja, są dokładnie te same.
    scalone: Dict[Key, int] = {}
    for k, ile in braki.items():
        kk = klucz_wyrobu(k[0], k[1])
        scalone[kk] = scalone.get(kk, 0) + int(ile)
    picks = portion_stock_rows(scalone, wiersze, "")

    # Ile z rozpisu dokument NIE pokrył. Klucz (receptura, waga sztuki)
    # wystarcza: `kandydaci` nigdy nie przenosi sztuk między recepturami
    # ani wagami — tolerancyjne są tylko rodzaj i tuleja.
    zostalo: Dict[Any, int] = {}
    for k, ile in braki.items():
        zostalo[(k[0], k[1])] = zostalo.get((k[0], k[1]), 0) + int(ile)
    for poz in picks:
        fg = poz.get("fg") or {}
        k = (str(fg.get("recipe_id") or ""), round(float(fg.get("kg_per_unit") or 0), 3))
        zostalo[k] = zostalo.get(k, 0) - int(poz.get("take") or 0)
    for (recipe_id, kg), ile in sorted(zostalo.items()):
        if ile > 0:
            picks.append({"fg": {"recipe_id": recipe_id, "kg_per_unit": kg,
                                 "batch_no": None}, "take": ile})
    return picks


def picks_for_pallets(order_id: str, pallet_ids: List[str]) -> List[Dict[str, Any]]:
    """Wiersze magazynu pokrywające ZAWARTOŚĆ WSKAZANYCH PALET.

    Biuro (2026-09-09): „jeszcze nie skanujemy pojedynczych sztuk, nie mamy
    możliwości — system musi wierzyć, że zeskanowany karton jest spakowany
    zgodnie z zamówieniem, a partie brać od najstarszych z magazynu".

    Skan kartki na palecie jest więc POTWIERDZENIEM ZAWARTOŚCI: jedzie to, co
    biuro rozpisało na tę paletę. Różnica wobec `picks_for_order`: tam brakiem
    jest całe zamówienie, tu tylko to, co fizycznie stoi na aucie — reszta
    zostaje w magazynie i pojedzie następnym kursem.

    Kolejność czerpania i reguły własności są WSPÓLNE z `picks_for_order`:
    najpierw towar ostemplowany tym zamówieniem, potem najstarszy
    (`produced_date ASC`). Nie duplikujemy tu reguły FEFO — jedno źródło.

    TYLKO dla zamówienia, którego nikt jeszcze nie wydał żadnym dokumentem.
    Gdy dokument już jest (WM przy podziale wysyłki), partie wskazuje ON —
    patrz `picks_z_dokumentu`.
    """
    if not pallet_ids:
        return []
    order = query_one("SELECT id, order_no, client_id FROM client_orders WHERE id=%s",
                      (order_id,))
    if not order:
        return []
    order_no = order.get("order_no") or ""

    braki = compute_shortfalls(rozpis_palet(pallet_ids), {}, {})
    if not braki:
        return []

    fg_rows = query_all(
        """
        SELECT id, batch_no, recipe_id, recipe_name, product_type_id, product_type_name,
               packaging_id, packaging_name,
               kg_per_unit, qty, qty_available, qty_shipped,
               client_order_no, client_name, produced_date, created_at
        FROM finished_goods fg
        WHERE COALESCE(fg.qty_available, 0) > 0
          AND (
               fg.client_order_no = %s
               OR (
                   (COALESCE(fg.client_order_no, '') = ''
                    OR NOT EXISTS (SELECT 1 FROM client_orders o2
                                   WHERE o2.order_no = fg.client_order_no
                                     AND o2.status NOT IN ('done', 'cancelled')))
                   AND COALESCE(NULLIF(fg.client_id, ''), (
                           SELECT c.id FROM clients c
                           WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                           ORDER BY (c.name = fg.client_name) DESC
                           LIMIT 1
                       ), '') IN ('', COALESCE((SELECT o3.client_id FROM client_orders o3
                                                WHERE o3.id = %s), ''))
               ))
        ORDER BY (COALESCE(fg.client_order_no, '') = %s) DESC,
                 produced_date ASC NULLS LAST, created_at ASC
        """,
        (order_no, order_id, order_no),
    )
    return portion_stock_rows(braki, fg_rows, order_no)

def picks_for_order(order_id: str) -> List[Dict[str, Any]]:
    """Wiersze magazynu wyrobu gotowego pokrywające CAŁE zamówienie.

    Pod „Wystaw WZ" na zamówieniu, które od 30.08.2026 otwiera zwykły
    formularz WZ z wstawionymi pozycjami zamiast osobnego, ubogiego okna.
    Formularz rozchodowuje towar po `stock_id`, więc potrzebuje WIERSZY
    magazynu, a nie abstrakcyjnych pozycji z linii planu.

    Różnica wobec `stock_portions_for_order`: tam liczą się tylko BRAKI po
    produkcji zaraportowanej na planach, tu całe zamówienie — bo dokument
    ma wykazać wszystko, co jedzie, niezależnie od tego, czy powstało pod
    ten plan, czy leżało na magazynie.

    Kolejność czerpania i reguły własności zostają te same, co przy pokryciu
    ([[kebab-pokrycie-zamowien]]): najpierw stempel tego zamówienia, potem
    zapas własny albo niczyj, a cudzy towar dopiero świadomie i ręcznie —
    dlatego go tu w ogóle nie ma.
    """
    order = query_all("SELECT id, order_no, client_id FROM client_orders WHERE id=%s",
                      (order_id,))
    if not order:
        return []
    order_no = order[0].get("order_no") or ""

    order_lines = query_all(
        "SELECT recipe_id, kg_per_unit, product_type_id, packaging_id, qty "
        "FROM client_order_lines WHERE order_id=%s", (order_id,))
    braki = compute_shortfalls(order_lines, {}, {})
    if not braki:
        return []

    fg_rows = query_all(
        """
        SELECT id, batch_no, recipe_id, recipe_name, product_type_id, product_type_name,
               packaging_id, packaging_name,
               kg_per_unit, qty, qty_available, qty_shipped,
               client_order_no, client_name, produced_date, created_at
        FROM finished_goods fg
        WHERE COALESCE(fg.qty_available, 0) > 0
          AND (
               fg.client_order_no = %s
               OR (
                   (COALESCE(fg.client_order_no, '') = ''
                    OR NOT EXISTS (SELECT 1 FROM client_orders o2
                                   WHERE o2.order_no = fg.client_order_no
                                     AND o2.status NOT IN ('done', 'cancelled')))
                   AND COALESCE(NULLIF(fg.client_id, ''), (
                           SELECT c.id FROM clients c
                           WHERE c.name = fg.client_name OR c.display_name = fg.client_name
                           ORDER BY (c.name = fg.client_name) DESC
                           LIMIT 1
                       ), '') IN ('', COALESCE((SELECT o3.client_id FROM client_orders o3
                                                WHERE o3.id = %s), ''))
               ))
        -- COALESCE, nie gołe porównanie: `NULL = 'ZAM/7/08'` daje w SQL NULL,
        -- a przy DESC Postgres stawia NULL-e PIERWSZE — towar bez stempla
        -- wyprzedzałby ostemplowany, czyli dokładnie odwrotnie niż chcemy.
        ORDER BY (COALESCE(fg.client_order_no, '') = %s) DESC,
                 produced_date ASC NULLS LAST, created_at ASC
        """,
        (order_no, order_id, order_no),
    )
    # Bez `wydane_wg_wiersza`: formularz wystawia NOWY dokument, więc liczy
    # się tylko to, co fizycznie leży. Sztuki już wydane pokazałyby się jako
    # dostępne i biuro wydałoby je drugi raz.
    return portion_stock_rows(braki, fg_rows, order_no)
