"""Edycja zamówienia a rozpisane palety.

Biuro (2026-09-02): „ciągle mi znikają te palety". Przyczyna:
`update_order` kasuje WSZYSTKIE pozycje zamówienia i wstawia je od nowa,
a `order_pallet_items` ma na pozycje `ON DELETE CASCADE`. Poprawienie
czegokolwiek w zamówieniu — choćby daty dostawy — zabierało ze sobą cały
rozpis palet, cicho i bez śladu.

Naprawa: edycja UZGADNIA pozycje zamiast je kasować. Pozycja, która
przetrwała edycję, zachowuje swój identyfikator, więc paleta nadal ma
do czego się odwoływać.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate, PalletDto
from app.services.orders_service import create_order, get_order, update_order
from app.services.pallets_service import save_pallets


def _slownik():
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('cl-y','YALCIN','YALCIN','YALCIN') ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name) VALUES ('pt-udo','Udo ze skórą') "
            "ON CONFLICT (id) DO NOTHING")
    for rid, n in (("rec-a", "GOLD KEBAB"), ("rec-b", "YALCIN")):
        execute("INSERT INTO recipes (id, name, product_type_id) VALUES (%s,%s,'pt-udo') "
                "ON CONFLICT (id) DO NOTHING", (rid, n))


POZYCJE = [
    {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 10, "kg_per_unit": 40},
    {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 12, "kg_per_unit": 25},
    {"recipe_id": "rec-b", "product_type_id": "pt-udo", "qty": 20, "kg_per_unit": 30},
]


def _dto(pozycje=None, **nadpisz):
    dane = {"client_id": "cl-y", "order_date": "2026-09-01",
            "delivery_date": "2026-09-03",
            "lines": pozycje if pozycje is not None else POZYCJE}
    dane.update(nadpisz)
    return ClientOrderCreate.model_validate(dane)


def _zamowienie_z_paletami():
    """Zamówienie z trzema pozycjami i dwiema rozpisanymi paletami."""
    _slownik()
    o = create_order(_dto())
    linie = o["lines"]
    save_pallets(o["id"], [
        PalletDto.model_validate({"items": [
            {"order_line_id": linie[0]["id"], "qty": 6},
            {"order_line_id": linie[1]["id"], "qty": 4},
        ]}),
        PalletDto.model_validate({"items": [
            {"order_line_id": linie[2]["id"], "qty": 20},
        ]}),
    ])
    return o


def _pozycje_palet(order_id):
    return query_all(
        """SELECT pi.order_line_id, pi.qty FROM order_pallet_items pi
             JOIN order_pallets p ON p.id = pi.pallet_id
            WHERE p.order_id = %s ORDER BY p.pallet_no, pi.qty DESC""",
        (order_id,),
    )


def test_palety_zapisuja_sie(db):
    """Punkt wyjścia — bez tego reszta testów nic nie znaczy."""
    o = _zamowienie_z_paletami()
    assert len(_pozycje_palet(o["id"])) == 3
    assert query_one("SELECT count(*) AS n FROM order_pallets WHERE order_id=%s",
                     (o["id"],))["n"] == 2


def test_edycja_samej_daty_nie_kasuje_palet(db):
    """SEDNO BŁĘDU: poprawka daty dostawy nie rusza ŻADNEJ pozycji,
    a mimo to zabierała cały rozpis palet."""
    o = _zamowienie_z_paletami()
    przed = _pozycje_palet(o["id"])
    update_order(o["id"], _dto(delivery_date="2026-09-05"))
    assert _pozycje_palet(o["id"]) == przed


def test_zmiana_ilosci_jednej_pozycji_nie_kasuje_palet(db):
    """Poprawka sztuk w jednej pozycji nie może zabrać palet pozostałych."""
    o = _zamowienie_z_paletami()
    zmienione = [dict(p) for p in POZYCJE]
    zmienione[0]["qty"] = 14
    update_order(o["id"], _dto(zmienione))
    assert len(_pozycje_palet(o["id"])) == 3


def test_pozycja_przetrwala_edycje_zachowuje_identyfikator(db):
    """Paleta wskazuje pozycję po id — nowy identyfikator to zerwany rozpis."""
    o = _zamowienie_z_paletami()
    przed = [l["id"] for l in o["lines"]]
    update_order(o["id"], _dto(delivery_date="2026-09-06"))
    po = [l["id"] for l in get_order(o["id"])["lines"]]
    assert po == przed


def test_usuniecie_pozycji_zabiera_TYLKO_jej_palety(db):
    """Skasowana pozycja ma prawo zabrać swój rozpis — reszta zostaje."""
    o = _zamowienie_z_paletami()
    bez_ostatniej = [dict(p) for p in POZYCJE[:2]]
    update_order(o["id"], _dto(bez_ostatniej))
    zostalo = _pozycje_palet(o["id"])
    assert len(zostalo) == 2
    assert all(r["order_line_id"] in [l["id"] for l in o["lines"][:2]] for r in zostalo)


def test_dopisanie_pozycji_nie_rusza_istniejacych_palet(db):
    o = _zamowienie_z_paletami()
    wiecej = [dict(p) for p in POZYCJE] + [
        {"recipe_id": "rec-b", "product_type_id": "pt-udo", "qty": 5, "kg_per_unit": 10}]
    update_order(o["id"], _dto(wiecej))
    assert len(_pozycje_palet(o["id"])) == 3
    assert len(get_order(o["id"])["lines"]) == 4


def test_kilka_edycji_pod_rzad_nie_gubi_palet(db):
    """Biuro poprawia zamówienie wielokrotnie — palety mają przeżyć każdą."""
    o = _zamowienie_z_paletami()
    for i in range(4):
        update_order(o["id"], _dto(delivery_date=f"2026-09-0{i + 3}"))
    assert len(_pozycje_palet(o["id"])) == 3


def test_dopasowanie_po_identyfikatorze_gdy_zmienia_sie_waga(db):
    """Gdy pozycja zmienia WAGĘ, dopasowanie po tożsamości już nie zadziała —
    ratuje ją identyfikator przysłany przez formularz. Bez niego paleta
    straciłaby rozpis przy zwykłej korekcie gramatury."""
    o = _zamowienie_z_paletami()
    linie = o["lines"]
    zmienione = [
        {"id": linie[0]["id"], "recipe_id": "rec-a", "product_type_id": "pt-udo",
         "qty": 10, "kg_per_unit": 35},          # 40 kg → 35 kg
        {"id": linie[1]["id"], "recipe_id": "rec-a", "product_type_id": "pt-udo",
         "qty": 12, "kg_per_unit": 25},
        {"id": linie[2]["id"], "recipe_id": "rec-b", "product_type_id": "pt-udo",
         "qty": 20, "kg_per_unit": 30},
    ]
    update_order(o["id"], _dto(zmienione))
    assert len(_pozycje_palet(o["id"])) == 3
    assert [l["id"] for l in get_order(o["id"])["lines"]] == [l["id"] for l in linie]


def test_bez_identyfikatorow_palety_tez_przezywaja(db):
    """Furtka dla starszego desktopu biura, który id jeszcze nie wysyła:
    dopasowanie po tożsamości produktu. Bez niej wdrożenie backendu przed
    aktualizacją aplikacji dalej gubiłoby palety."""
    o = _zamowienie_z_paletami()
    update_order(o["id"], _dto())          # POZYCJE nie mają pola id
    assert len(_pozycje_palet(o["id"])) == 3


def test_dwie_pozycje_o_tej_samej_tozsamosci_nie_kradna_sobie_palet(db):
    """Duplikat produktu w zamówieniu zdarza się (inna cena, inny termin).
    Każda pozycja ma dostać SWÓJ wiersz, nie cudzy."""
    _slownik()
    dwie = [
        {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 10, "kg_per_unit": 40},
        {"recipe_id": "rec-a", "product_type_id": "pt-udo", "qty": 7, "kg_per_unit": 40},
    ]
    o = create_order(_dto(dwie))
    ids_przed = [l["id"] for l in o["lines"]]
    update_order(o["id"], _dto(dwie))
    ids_po = [l["id"] for l in get_order(o["id"])["lines"]]
    assert sorted(ids_po) == sorted(ids_przed)
    assert len(set(ids_po)) == 2
