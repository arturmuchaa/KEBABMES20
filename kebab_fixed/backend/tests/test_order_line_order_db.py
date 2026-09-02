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
