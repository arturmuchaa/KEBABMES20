"""Ślad skanowania palet — „czy gdzieś sztuka nie zginęła".

`pallet_scans` zapisuje KAŻDY skan od zawsze (mroźnia, auto, cofnięcie),
a do 22.09.2026 nikt tej tabeli nie czytał: w całym backendzie nie było
ani jednego SELECT-a. Historia jest więc kompletna wstecz, bez migracji.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.db import execute, query_one
from app.services.pallets_service import slad_skanowania


def _zasiew() -> None:
    """Zamówienie z dwiema paletami: jedna zeskanowana, druga nietknięta."""
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','YAL','YALCIN') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO vehicles (id, name, plate, active) "
            "VALUES ('v1','SOLÓWKA','KR 8842L',true) ON CONFLICT (id) DO NOTHING")
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, "
        " order_date, status) VALUES ('o1','YALCIN/Z/1/09/26','c1','YALCIN',%s,'confirmed')",
        (date.today() - timedelta(days=2),))
    execute("INSERT INTO order_pallets (id, order_id, pallet_no, notes, status) "
            "VALUES ('p1','o1',1,'','loaded')")
    execute("INSERT INTO order_pallets (id, order_id, pallet_no, notes, status) "
            "VALUES ('p2','o1',2,'','created')")


def test_slad_pokazuje_etapy_w_kolejnosci_czasu(db):
    _zasiew()
    for i, akcja in enumerate(["cold_storage", "loaded", "undo", "loaded"]):
        execute(
            "INSERT INTO pallet_scans (id, pallet_id, action, operator, vehicle_id, scanned_at) "
            "VALUES (%s,'p1',%s,'VLAD M.','v1', now() + (%s || ' minutes')::interval)",
            (f"s{i}", akcja, i))

    slad = slad_skanowania("o1")

    p1 = next(p for p in slad if p["pallet_no"] == 1)
    assert [z["action"] for z in p1["zdarzenia"]] == \
        ["cold_storage", "loaded", "undo", "loaded"]
    assert p1["zdarzenia"][0]["operator"] == "VLAD M."


def test_nazwa_auta_dociagana_do_skanu_zaladunku(db):
    """Sam identyfikator pojazdu nic biuru nie mówi — ślad ma nazwać auto.

    Nazwę bierzemy Z BAZY, a nie z literału: `vehicles` nie jest czyszczone
    między plikami testowymi i `ON CONFLICT DO NOTHING` mógł zachować nazwę
    z wcześniejszego zasiewu (ta sama pułapka co w
    `test_vehicle_loading_sync_db.py`).
    """
    _zasiew()
    execute("INSERT INTO pallet_scans (id, pallet_id, action, operator, vehicle_id) "
            "VALUES ('s1','p1','loaded','VLAD M.','v1')")
    auto = query_one("SELECT name, plate FROM vehicles WHERE id='v1'")

    p1 = next(p for p in slad_skanowania("o1") if p["pallet_no"] == 1)

    opis = p1["zdarzenia"][0]["vehicle"]
    assert auto["name"] in opis
    assert auto["plate"] in opis


def test_paleta_bez_skanow_TEZ_jest_na_liscie(db):
    """Sedno tej funkcji: paleta, której nikt nie tknął, to dokładnie ta,
    której ktoś szuka. Gdyby wypadała z wyniku, narzędzie odpowiadałoby
    wyłącznie na pytania, na które i tak znamy odpowiedź."""
    _zasiew()
    execute("INSERT INTO pallet_scans (id, pallet_id, action, operator) "
            "VALUES ('s1','p1','loaded','VLAD M.')")

    slad = slad_skanowania("o1")

    p2 = next(p for p in slad if p["pallet_no"] == 2)
    assert p2["zdarzenia"] == []
    assert p2["status"] == "created"


def test_palety_idą_po_numerze(db):
    _zasiew()

    assert [p["pallet_no"] for p in slad_skanowania("o1")] == [1, 2]


def test_zamowienie_bez_palet_oddaje_pusta_liste(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','YAL','YALCIN') "
            "ON CONFLICT (id) DO NOTHING")
    execute(
        "INSERT INTO client_orders (id, order_no, client_id, client_name, "
        " order_date, status) VALUES ('o9','X/Z/9/09/26','c1','YALCIN',%s,'confirmed')",
        (date.today(),))

    assert slad_skanowania("o9") == []


# ─── Skład palety i poziom sztuki ───────────────────────────────────────
#
# Właściciel 24.09.2026: „P1 na auto nic mi nie mówi — chcę skład palety
# i łańcuch produkcja → magazyn → wydanie, gdzie ewentualnie jaka sztuka
# zaginęła przy reklamacji".
#
# Stan faktyczny bazy produkcyjnej sprawdzony tego dnia: `finished_units`
# ma 89 wierszy, z tego JEDEN 'produced' i ZERO przypisanych do palety.
# Poziom sztuki nie ma więc dziś z czego powstać i okno musi to mówić
# wprost, zamiast udawać wiedzę.

def _rozpis() -> None:
    """Rozpis biura: P1 jednorodna, P2 mieszana (dwie gramatury)."""
    execute("INSERT INTO recipes (id, name, active) VALUES ('r1','BULLI',true) "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name, active) "
            "VALUES ('pt1',%s,true) ON CONFLICT (id) DO NOTHING",
            ("KEBAB UDO 100%",))
    for lid, qty, kg in [("l1", 20, 40.0), ("l2", 15, 25.0)]:
        execute(
            "INSERT INTO client_order_lines (id, order_id, qty, kg_per_unit, "
            " recipe_id, product_type_id) VALUES (%s,'o1',%s,%s,'r1','pt1')",
            (lid, qty, kg))
    execute("INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
            "VALUES ('i1','p1','l1',20)")
    execute("INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
            "VALUES ('i2','p2','l1',10)")
    execute("INSERT INTO order_pallet_items (id, pallet_id, order_line_id, qty) "
            "VALUES ('i3','p2','l2',15)")


def _paleta(slad, nr):
    return next(p for p in slad if p["pallet_no"] == nr)


def test_slad_niesie_sklad_palety_z_rozpisu(db):
    """„P1 na auto" nic nie mówi. „P1: 20 szt × 40 kg KEBAB UDO 100% BULLI"
    już tak — i to jest pierwsza rzecz, której szuka się przy reklamacji."""
    _zasiew()
    _rozpis()

    p1 = _paleta(slad_skanowania("o1"), 1)

    assert [(s["qty"], float(s["kg_per_unit"]), s["rodzaj"], s["receptura"])
            for s in p1["sklad"]] == [(20, 40.0, "KEBAB UDO 100%", "BULLI")]


def test_paleta_mieszana_ma_kilka_pozycji_skladu(db):
    """Paleta bywa mieszana (realne WM/10 miało 10 szt × 40 kg + 15 szt × 25 kg)
    — scalenie tego do jednej liczby ukryłoby, czego dokładnie brakuje."""
    _zasiew()
    _rozpis()

    p2 = _paleta(slad_skanowania("o1"), 2)

    assert [(s["qty"], float(s["kg_per_unit"])) for s in p2["sklad"]] == \
        [(10, 40.0), (15, 25.0)]


def test_paleta_bez_rozpisu_ma_pusty_sklad(db):
    """Brak rozpisu to nie błąd — paleta bez pozycji ma po prostu pustą listę
    i dalej musi być widoczna na śladzie."""
    _zasiew()

    assert _paleta(slad_skanowania("o1"), 1)["sklad"] == []


def test_sztuk_ZADEKLAROWANYCH_tyle_co_w_rozpisie(db):
    _zasiew()
    _rozpis()

    assert _paleta(slad_skanowania("o1"), 2)["sztuki"]["zadeklarowane"] == 25


def test_sztuk_SLEDZONYCH_jest_ZERO_dopoki_hala_nie_skanuje(db):
    """SEDNO uczciwości tego okna. Rozpis mówi 20 sztuk, ale ani jedna nie ma
    własnego numeru w systemie — więc na pytanie „która sztuka zaginęła" nie
    ma dziś odpowiedzi. Okno ma to pokazać, a nie zamilczeć."""
    _zasiew()
    _rozpis()

    p1 = _paleta(slad_skanowania("o1"), 1)
    assert p1["sztuki"]["zadeklarowane"] == 20
    assert p1["sztuki"]["sledzone"] == 0


def test_sledzone_rosna_gdy_sztuki_trafiaja_na_palete(db):
    """Gniazdo na przyszłość: gdy hala zacznie skanować, te same pola zaczną
    pokazywać prawdę bez przerabiania okna."""
    _zasiew()
    _rozpis()
    for i in range(3):
        execute(
            "INSERT INTO finished_units (id, qr_code, status, recipe_id, "
            " product_type_id, tuleja, weight_kg, batch_no, pallet_id, created_at) "
            "VALUES (%s,%s,'produced','r1','pt1','T',40,'220926 573','p1',now())",
            (f"fu{i}", f"U|fu{i}"))

    assert _paleta(slad_skanowania("o1"), 1)["sztuki"]["sledzone"] == 3
