"""Listy dokumentów dla modułu PROTRIMA „Dokumenty” — pola potrzebne do filtrów i kolumn."""
from app.db import execute
from app.services.cmr_service import generate_cmr, list_cmr
from app.services.hdi_service import list_hdi
from app.services.wz_service import create_manual_wz, create_wz_from_order, list_wz
from tests.conftest_split import _firma, _klient, _przygotuj_bez_podzialu


def test_lista_wz_ma_numer_zamowienia_date_wydania_i_kurs(db):
    _przygotuj_bez_podzialu()
    wm = create_wz_from_order("o1")
    reczna = create_manual_wz(buyer={"name": "YBM Gastro GmbH"}, currency="EUR", eur_rate=4.25, selections=[
        {"stock_type": "reczna", "name": "Jogurt", "qty": "2", "unit": "szt", "price": "3"}])
    po = {r["id"]: r for r in list_wz()}
    assert po[wm["id"]]["order_no"] and po[wm["id"]]["order_id"] == "o1"
    assert po[wm["id"]]["release_date"]
    assert po[reczna["id"]]["order_no"] is None
    assert float(po[reczna["id"]]["eur_rate"]) == 4.25
    assert "loading_id" in po[wm["id"]]


def test_lista_cmr_ma_zamowienie_rodzaj_i_przewoznika(db):
    _przygotuj_bez_podzialu()
    execute("INSERT INTO carriers (id, name) VALUES ('car-dok','TRANS-POL') ON CONFLICT (id) DO NOTHING")
    cmr = generate_cmr("o1", {"carrier_id": "car-dok", "plate": "KR 12345", "load_date": "2026-11-14"}, scope="calosc")
    r = [x for x in list_cmr() if x["id"] == cmr["id"]][0]
    assert r["order_id"] == "o1" and r["order_no"]
    assert r["scope"] == "calosc" and r["carrier_name"] == "TRANS-POL"


def test_lista_hdi_ma_zamowienie_i_rodzaj(db):
    _przygotuj_bez_podzialu()
    from app.services.hdi_service import generate_hdi
    h = generate_hdi("o1")
    r = [x for x in list_hdi() if x["id"] == h["id"]][0]
    assert r["order_id"] == "o1" and r["order_no"] and "scope" in r
