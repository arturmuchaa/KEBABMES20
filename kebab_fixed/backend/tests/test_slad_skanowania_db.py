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
