"""Kolejność pozycji zamówienia — czy przetrwa edycję.

Biuro (2026-09-02, zamówienie YALCIN): „edytowałem zamówienie i pomieszały
się receptury i wagi". Pozycje nie zmieniły treści — zmieniły KOLEJNOŚĆ,
bo `update_order` kasuje wszystkie wiersze i wstawia je od nowa z losowymi
identyfikatorami, a odczyt nie ma `ORDER BY`. Postgres oddaje wtedy wiersze
w kolejności fizycznej, która po DELETE+INSERT jest dowolna.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute, query_all
from app.models.orders import ClientOrderCreate
from app.services.orders_service import create_order, get_order, update_order


def _slownik():
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('cl-y','YALCIN','YALCIN SP. Z O.O.','YALCIN') "
            "ON CONFLICT (id) DO NOTHING")
    for pid, nazwa in (("pt-udo", "Udo ze skórą"),):
        execute("INSERT INTO product_types (id, name) VALUES (%s,%s) "
                "ON CONFLICT (id) DO NOTHING", (pid, nazwa))
    for rid, nazwa in (("rec-a", "GOLD KEBAB"), ("rec-b", "YALCIN")):
        execute("INSERT INTO recipes (id, name, product_type_id) VALUES (%s,%s,'pt-udo') "
                "ON CONFLICT (id) DO NOTHING", (rid, nazwa))


#: Pozycje w kolejności, w jakiej biuro je wpisało: receptury zgrupowane,
#: w grupie wagi malejąco. Dokładnie tak ma wyglądać wydruk i ekran.
POZYCJE = [
    {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 10, "kg_per_unit": 40},
    {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 12, "kg_per_unit": 25},
    {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 8,  "kg_per_unit": 10},
    {"recipe_id": "rec-b", "product_type_id": "pt-udo", "qty": 20, "kg_per_unit": 30},
    {"recipe_id": "rec-b", "product_type_id": "pt-udo", "qty": 15, "kg_per_unit": 15},
]


def _dto(pozycje=None):
    return ClientOrderCreate.model_validate({
        "client_id": "cl-y",
        "order_date": "2026-09-01",
        "delivery_date": "2026-09-03",
        "lines": pozycje if pozycje is not None else POZYCJE,
    })


def _ksztalt(lines):
    """(receptura, kg/szt) — tożsamość wiersza widoczna dla biura."""
    return [(l["recipe_id"], float(l["kg_per_unit"])) for l in lines]


OCZEKIWANY = [("rec-a", 40.0), ("rec-a", 25.0), ("rec-a", 10.0),
              ("rec-b", 30.0), ("rec-b", 15.0)]


def test_swiezo_utworzone_zamowienie_ma_kolejnosc_wpisania(db):
    _slownik()
    o = create_order(_dto())
    assert _ksztalt(o["lines"]) == OCZEKIWANY


def test_odczyt_zamowienia_zachowuje_kolejnosc(db):
    _slownik()
    o = create_order(_dto())
    assert _ksztalt(get_order(o["id"])["lines"]) == OCZEKIWANY


def test_edycja_nie_przestawia_pozycji(db):
    """SEDNO BŁĘDU: edycja kasuje wiersze i wstawia je od nowa. Bez
    zapisanej kolejności wracają w dowolnej — biuro widzi „pomieszane
    receptury i wagi", choć żaden wiersz nie zmienił treści."""
    _slownik()
    o = create_order(_dto())
    po = update_order(o["id"], _dto())
    assert _ksztalt(po["lines"]) == OCZEKIWANY


def test_kolejnosc_przezywa_kilka_edycji(db):
    """Biuro poprawia zamówienie wielokrotnie — za każdym razem ma zastać
    ten sam układ, inaczej nie da się go czytać."""
    _slownik()
    o = create_order(_dto())
    for _ in range(3):
        update_order(o["id"], _dto())
    assert _ksztalt(get_order(o["id"])["lines"]) == OCZEKIWANY


def test_edycja_zmieniajaca_pozycje_zachowuje_nowa_kolejnosc(db):
    """Gdy biuro DOPISZE pozycję, ma ona stanąć tam, gdzie ją wpisano."""
    _slownik()
    o = create_order(_dto())
    nowe = list(POZYCJE)
    nowe.insert(3, {"recipe_id": "rec-a", "product_type_id": "pt-udo",
                    "qty": 5, "kg_per_unit": 5})
    po = update_order(o["id"], _dto(nowe))
    assert _ksztalt(po["lines"]) == [
        ("rec-a", 40.0), ("rec-a", 25.0), ("rec-a", 10.0), ("rec-a", 5.0),
        ("rec-b", 30.0), ("rec-b", 15.0),
    ]


def test_kolejnosc_jest_wlasnoscia_dokumentu_nie_zapytania(db):
    """Każdy czytelnik pozycji ma widzieć TEN SAM układ — inaczej ekran,
    wydruk i HDI pokazują trzy różne kolejności tego samego zamówienia."""
    _slownik()
    o = create_order(_dto())
    update_order(o["id"], _dto())
    surowe = query_all(
        "SELECT recipe_id, kg_per_unit FROM client_order_lines "
        "WHERE order_id=%s ORDER BY position", (o["id"],))
    assert [(r["recipe_id"], float(r["kg_per_unit"])) for r in surowe] == OCZEKIWANY


# ── Wypełnienie kolejności w starych zamówieniach ───────────────────
def _stara_pozycja(oid, lid, recipe, kg, poz=0, tuleja="METAL 60CM"):
    """Wiersz sprzed kolumny `position` — wszystkie mają 0."""
    execute(
        "INSERT INTO client_order_lines (id, order_id, position, qty, kg_per_unit, "
        " total_kg, product_type_id, recipe_id, packaging_name) "
        "VALUES (%s,%s,%s,1,%s,%s,'pt-udo',%s,%s)",
        (lid, oid, poz, kg, kg, recipe, tuleja),
    )


def _stare_zamowienie(oid="ord-stare"):
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
        " created_at, status) VALUES (%s,'1/09','cl-y','YALCIN','2026-09-01',"
        " '2026-09-01 08:00:00+00','confirmed')", (oid,))
    return oid


def test_wypelnienie_grupuje_receptury_i_sortuje_wagi(db):
    """Stare zamówienie ma wszystkie position=0, więc czyta się przypadkowo.
    Migracja układa je wg tej samej reguły co zapis."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie()
    # Kolejność wstawienia = kolejność, w jakiej biuro to widzi dziś.
    _stara_pozycja(oid, "l1", "rec-a", 25)
    _stara_pozycja(oid, "l2", "rec-b", 30)
    _stara_pozycja(oid, "l3", "rec-a", 40)
    _stara_pozycja(oid, "l4", "rec-b", 15)

    _backfill_order_line_positions()

    ulozone = query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position", (oid,))
    # rec-a pierwsza (pojawiła się jako pierwsza), w grupie 40 przed 25.
    assert [r["id"] for r in ulozone] == ["l3", "l1", "l2", "l4"]


def test_wypelnienie_numeruje_od_zera(db):
    """Zapis nową ścieżką numeruje od 0 (enumerate) — migracja tak samo,
    inaczej dwa dokumenty miałyby dwie różne konwencje."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie("ord-zero")
    _stara_pozycja(oid, "z1", "rec-a", 10)
    _stara_pozycja(oid, "z2", "rec-a", 20)
    _backfill_order_line_positions()
    poz = [r["position"] for r in query_all(
        "SELECT position FROM client_order_lines WHERE order_id=%s ORDER BY position", (oid,))]
    assert poz == [0, 1]


def test_wypelnienie_nie_rusza_dokumentu_juz_ulozonego(db):
    """Zamówienie zapisane nową ścieżką ma swoją kolejność — migracja nie
    ma prawa jej nadpisać, nawet gdy wygląda „nieposortowanie"."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie("ord-nowe")
    _stara_pozycja(oid, "n1", "rec-a", 10, poz=0)
    _stara_pozycja(oid, "n2", "rec-a", 40, poz=1)   # świadomie 10 przed 40
    _backfill_order_line_positions()
    assert [r["id"] for r in query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position",
        (oid,))] == ["n1", "n2"]


def test_wypelnienie_mozna_uruchomic_dwa_razy(db):
    """Migracje chodzą przy każdym starcie — drugi przebieg nie może
    przestawić tego, co ustawił pierwszy."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie("ord-2x")
    _stara_pozycja(oid, "d1", "rec-a", 25)
    _stara_pozycja(oid, "d2", "rec-a", 40)
    _backfill_order_line_positions()
    pierwszy = [r["id"] for r in query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position", (oid,))]
    _backfill_order_line_positions()
    drugi = [r["id"] for r in query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position", (oid,))]
    assert pierwszy == drugi == ["d2", "d1"]


def test_wypelnienie_odsuwa_tuleje_niestandardowe_na_koniec(db):
    """METAL 80CM ma stać PO standardowych 45-65 cm, choć waży najwięcej."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie("ord-tuleje")
    _stara_pozycja(oid, "t1", "rec-a", 80, tuleja="METAL 80CM")
    _stara_pozycja(oid, "t2", "rec-a", 50, tuleja="METAL 65CM")
    _stara_pozycja(oid, "t3", "rec-a", 25, tuleja="METAL 50CM")
    _stara_pozycja(oid, "t4", "rec-a", 20, tuleja="METAL 75CM")
    _backfill_order_line_positions()
    assert [r["id"] for r in query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position",
        (oid,))] == ["t2", "t3", "t1", "t4"]


def test_wypelnienie_traktuje_karton_i_metal_jednakowo(db):
    """Standard zależy od ROZMIARU, nie od materiału tulei."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie("ord-karton")
    _stara_pozycja(oid, "k1", "rec-a", 30, tuleja="KARTON 60CM")
    _stara_pozycja(oid, "k2", "rec-a", 40, tuleja="METAL 60CM")
    _backfill_order_line_positions()
    assert [r["id"] for r in query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position",
        (oid,))] == ["k2", "k1"]


def test_wypelnienie_pozycja_bez_tulei_ladzie_na_koncu(db):
    """Brak rozmiaru traktujemy jak niestandard — nie wmieszamy jej między
    zwykłe pozycje."""
    from app.migrations import _backfill_order_line_positions
    _slownik()
    oid = _stare_zamowienie("ord-bez-tulei")
    _stara_pozycja(oid, "b1", "rec-a", 90, tuleja=None)
    _stara_pozycja(oid, "b2", "rec-a", 10, tuleja="METAL 60CM")
    _backfill_order_line_positions()
    assert [r["id"] for r in query_all(
        "SELECT id FROM client_order_lines WHERE order_id=%s ORDER BY position",
        (oid,))] == ["b2", "b1"]
