"""Rozliczenia — synchronizacja WZ z MES do księgi `rozl_dokumenty`.

Do księgi trafia tylko seria WZ z datą >= data startu; kwota to brutto
z pozycji. Każda zmiana kwoty / anulowanie / wycena zostawia ślad
w `rozl_historia`. Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from app.db import execute, query_all, query_one
from app.services.rozliczenia_wz import (data_startu, przypisz_wz,
                                         synchronizuj_wz, ustaw_date_startu)

POZ_1000 = [{"value": 1000, "vat_rate": 5}]


def _klient(cid="c1", nazwa="YALCIN", display_name=None, nip=None, termin_wz=0,
            forma_wz="gotowka"):
    execute("INSERT INTO clients (id, code, name, display_name, nip, rozl_termin_wz, "
            " rozl_forma_wz) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (cid, cid.upper(), nazwa, display_name, nip, termin_wz, forma_wz))
    return cid


def _wz(wid, cid=None, numer="WZ/1/11/26", release_date="2026-11-10", lines=POZ_1000,
        seria="WZ", status="wstepny", valued=True, buyer_name="YALCIN", buyer_nip=None,
        issued_date=None, currency="PLN"):
    """`wz_documents` NIE MA `client_id` — z `cid` powiązanie idzie przez
    zamówienie, bez `cid` dokument nie ma zamówienia (NIP / nazwa)."""
    source_type = source_id = None
    if cid:
        execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
                "VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                (f"ord-{wid}", f"ZAM/{wid}", cid, buyer_name))
        source_type, source_id = "order", f"ord-{wid}"
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, buyer_nip, "
        " lines, total_value, valued, status, doc_series, currency, source_type, "
        " source_id, issued_date, release_date) "
        "VALUES (%s,%s,(SELECT COALESCE(MAX(seq),0)+1 FROM wz_documents),'2611',%s,%s,"
        " %s::jsonb,0,%s,%s,%s,%s,%s,%s,%s,%s)",
        (wid, numer, buyer_name, buyer_nip, json.dumps(lines), valued, status, seria,
         currency, source_type, source_id, issued_date, release_date))


def _dok(wid):
    return query_one("SELECT * FROM rozl_dokumenty WHERE zrodlo='mes_wz' AND source_id=%s",
                     (wid,))


def _historia(wid):
    dok = _dok(wid)
    return query_all("SELECT * FROM rozl_historia WHERE obiekt='dokument' AND obiekt_id=%s "
                     "ORDER BY kiedy, id", (dok["id"],))


@pytest.fixture
def przywroc_start():
    try:
        yield
    finally:
        execute("UPDATE app_settings SET value='\"2026-11-09\"'::jsonb "
                "WHERE key='rozliczenia_start'")


def test_WZ_z_zamowienia_trafia_do_ksiegi(db):
    _klient()
    _wz("w1", "c1")

    wynik = synchronizuj_wz()

    d = _dok("w1")
    assert wynik == {"dodane": 1, "zmienione": 0, "anulowane": 0}
    assert d["kwota"] == Decimal("1050.00")
    assert d["ksiega"] == "wz"
    assert d["client_id"] == "c1"
    assert d["termin"] == date(2026, 11, 10)
    assert d["forma"] == "gotowka"
    assert d["stan_zrodla"] == "aktywny"
    assert d["numer"] == "WZ/1/11/26"
    assert d["data_dok"] == date(2026, 11, 10)
    assert d["waluta"] == "PLN"
    h = _historia("w1")
    assert [(r["akcja"], r["kto"], r["client_id"]) for r in h] == [("dodano", "MES", "c1")]


def test_termin_i_forma_z_ustawien_klienta(db):
    _klient(termin_wz=14, forma_wz="przelew")
    _wz("w1", "c1")

    synchronizuj_wz()

    d = _dok("w1")
    assert d["termin"] == date(2026, 11, 24)
    assert d["forma"] == "przelew"


def test_seria_WM_nie_trafia(db):
    _klient()
    _wz("w1", "c1", numer="WM/1/11/26", seria="WM")

    synchronizuj_wz()

    assert _dok("w1") is None


def test_WZ_sprzed_startu_pominiety(db):
    _klient()
    _wz("w1", "c1", release_date="2026-11-08")

    assert synchronizuj_wz()["dodane"] == 0
    assert _dok("w1") is None


def test_WZ_z_dnia_startu_trafia(db):
    _klient()
    _wz("w1", "c1", release_date="2026-11-09")

    synchronizuj_wz()

    assert _dok("w1") is not None


def test_data_dokumentu_to_data_wydania(db):
    _klient()
    _wz("w1", "c1", release_date="2026-11-12", issued_date="2026-11-11")

    synchronizuj_wz()

    assert _dok("w1")["data_dok"] == date(2026, 11, 12)


def test_bez_daty_wydania_liczy_data_wystawienia(db):
    _klient()
    _wz("w1", "c1", release_date="", issued_date="2026-11-11")

    synchronizuj_wz()

    assert _dok("w1")["data_dok"] == date(2026, 11, 11)


def test_niewyceniony_czeka_na_ceny_a_po_wycenie_aktywny(db):
    _klient()
    _wz("w1", "c1", valued=False)

    synchronizuj_wz()

    d = _dok("w1")
    assert d["stan_zrodla"] == "czeka_na_ceny"
    assert d["kwota"] == Decimal("0.00")

    execute("UPDATE wz_documents SET valued=true WHERE id='w1'")
    wynik = synchronizuj_wz()

    d = _dok("w1")
    assert wynik == {"dodane": 0, "zmienione": 1, "anulowane": 0}
    assert d["stan_zrodla"] == "aktywny"
    assert d["kwota"] == Decimal("1050.00")
    assert [r["akcja"] for r in _historia("w1")] == ["dodano", "wycena"]


def test_pozycje_z_zerowa_wartoscia_czekaja_na_ceny(db):
    _klient()
    _wz("w1", "c1", lines=[{"value": 0, "vat_rate": 5}])

    synchronizuj_wz()

    assert _dok("w1")["stan_zrodla"] == "czeka_na_ceny"


def test_zmiana_kwoty_w_historii_a_bez_zmian_nic(db):
    _klient()
    _wz("w1", "c1")
    synchronizuj_wz()

    execute("UPDATE wz_documents SET lines=%s::jsonb WHERE id='w1'",
            (json.dumps([{"value": 2000, "vat_rate": 5}]),))
    assert synchronizuj_wz() == {"dodane": 0, "zmienione": 1, "anulowane": 0}

    d = _dok("w1")
    assert d["kwota"] == Decimal("2100.00")
    h = _historia("w1")
    assert [r["akcja"] for r in h] == ["dodano", "kwota"]
    assert h[1]["przed"] == {"kwota": 1050.0}
    assert h[1]["po"] == {"kwota": 2100.0}
    assert h[1]["opis"] == "kwota zmieniona z 1 050,00 na 2 100,00"
    assert h[1]["kto"] == "MES"

    assert synchronizuj_wz() == {"dodane": 0, "zmienione": 0, "anulowane": 0}
    assert len(_historia("w1")) == 2


def test_anulowanie_po_synchronizacji(db):
    _klient()
    _wz("w1", "c1")
    synchronizuj_wz()

    execute("UPDATE wz_documents SET status='anulowany' WHERE id='w1'")
    assert synchronizuj_wz() == {"dodane": 0, "zmienione": 0, "anulowane": 1}

    d = _dok("w1")
    assert d["stan_zrodla"] == "anulowany"
    assert d["kwota"] == Decimal("0.00")
    assert [r["akcja"] for r in _historia("w1")] == ["dodano", "anulowano"]


def test_dwoch_klientow_o_tej_samej_nazwie_brak_kontrahenta(db):
    """Review Focus 3: YALCIN rozbity na dwie spółki — nazwa nie rozstrzyga."""
    _klient("c1", nazwa="YBM Gastro", display_name="YALCIN")
    _klient("c2", nazwa="Emin Handels", display_name="YALCIN")
    _wz("w1", buyer_name="YALCIN")

    synchronizuj_wz()

    assert _dok("w1")["client_id"] is None


def test_jeden_klient_po_nazwie(db):
    _klient("c1", nazwa="YBM Gastro", display_name="YALCIN")
    _wz("w1", buyer_name="YALCIN")

    synchronizuj_wz()

    assert _dok("w1")["client_id"] == "c1"


def test_dopasowanie_po_NIP_po_normalizacji(db):
    _klient("c1", nazwa="Firma A", nip="5252525252")
    _klient("c2", nazwa="Firma B", nip="1111111111")
    _wz("w1", buyer_name="Ktoś inny", buyer_nip="PL 525-25-25-252")

    synchronizuj_wz()

    assert _dok("w1")["client_id"] == "c1"


def test_NIP_ma_pierwszenstwo_przed_nazwa(db):
    _klient("c1", nazwa="Firma A", nip="PL5252525252")
    _klient("c2", nazwa="YALCIN")
    _wz("w1", buyer_name="YALCIN", buyer_nip="525 252 52 52")

    synchronizuj_wz()

    assert _dok("w1")["client_id"] == "c1"


def test_brak_vat_dla_klienta_krajowego(db):
    _klient("c1", nip="5252525252")
    _wz("w1", "c1", lines=[{"value": 1000, "vat_rate": 0}])

    synchronizuj_wz()

    d = _dok("w1")
    assert d["brak_vat"] is True
    assert d["kwota"] == Decimal("1000.00")


def test_brak_vat_nie_dotyczy_klienta_zagranicznego(db):
    _klient("c1", nip="HU12345678")
    _wz("w1", "c1", lines=[{"value": 1000, "vat_rate": 0}], currency="EUR")

    synchronizuj_wz()

    d = _dok("w1")
    assert d["brak_vat"] is False
    assert d["waluta"] == "EUR"


def test_przypisz_wz_reczne_przypisanie_przezywa_synchronizacje(db):
    _klient("c1", nazwa="YBM Gastro", display_name="YALCIN", termin_wz=7)
    _klient("c2", nazwa="Emin Handels", display_name="YALCIN")
    _wz("w1", buyer_name="YALCIN")
    synchronizuj_wz()
    d = _dok("w1")
    assert d["client_id"] is None
    assert d["termin"] == date(2026, 11, 10)

    przypisz_wz(d["id"], "c1", "biuro")

    d = _dok("w1")
    assert d["client_id"] == "c1"
    assert d["przypisano_recznie"] is True
    assert d["termin"] == date(2026, 11, 17)
    h = _historia("w1")
    assert [(r["akcja"], r["kto"]) for r in h] == [("dodano", "MES"), ("przypisano", "biuro")]

    synchronizuj_wz()

    assert _dok("w1")["client_id"] == "c1"


def test_reczny_termin_nie_ruszany_po_zmianie_daty(db):
    _klient()
    _wz("w1", "c1")
    synchronizuj_wz()
    execute("UPDATE rozl_dokumenty SET termin='2026-12-31', termin_reczny=true, "
            "uwagi='umowa', forma='przelew' WHERE source_id='w1'")

    execute("UPDATE wz_documents SET release_date='2026-11-15', number='WZ/2/11/26' "
            "WHERE id='w1'")
    synchronizuj_wz()

    d = _dok("w1")
    assert d["data_dok"] == date(2026, 11, 15)
    assert d["numer"] == "WZ/2/11/26"
    assert d["termin"] == date(2026, 12, 31)
    assert d["uwagi"] == "umowa"
    assert d["forma"] == "przelew"


def test_zmiana_daty_przelicza_termin_automatyczny(db):
    _klient(termin_wz=3)
    _wz("w1", "c1")
    synchronizuj_wz()

    execute("UPDATE wz_documents SET release_date='2026-11-15' WHERE id='w1'")
    synchronizuj_wz()

    assert _dok("w1")["termin"] == date(2026, 11, 18)


def test_istniejacy_dokument_nie_znika_po_przesunieciu_startu(db, przywroc_start):
    _klient()
    _wz("w1", "c1")
    synchronizuj_wz()

    ustaw_date_startu(date(2026, 11, 20), "admin")
    execute("UPDATE wz_documents SET lines=%s::jsonb WHERE id='w1'",
            (json.dumps([{"value": 2000, "vat_rate": 5}]),))
    synchronizuj_wz()

    assert _dok("w1")["kwota"] == Decimal("2100.00")


def test_data_startu_domyslna_i_zmiana_z_historia(db, przywroc_start):
    assert data_startu() == date(2026, 11, 9)

    ustaw_date_startu(date(2026, 11, 1), "admin")

    assert data_startu() == date(2026, 11, 1)
    h = query_all("SELECT * FROM rozl_historia WHERE obiekt='klient'")
    assert len(h) == 1
    assert h[0]["client_id"] is None
    assert h[0]["akcja"] == "zmiana"
    assert h[0]["kto"] == "admin"
    assert h[0]["przed"] == {"data_startu": "2026-11-09"}
    assert h[0]["po"] == {"data_startu": "2026-11-01"}


def test_data_startu_fallback_bez_ustawienia(db, przywroc_start):
    execute("DELETE FROM app_settings WHERE key='rozliczenia_start'")
    try:
        assert data_startu() == date(2026, 11, 9)
    finally:
        execute("INSERT INTO app_settings (key, value) VALUES "
                "('rozliczenia_start', '\"2026-11-09\"'::jsonb) ON CONFLICT (key) DO NOTHING")


def test_bledna_data_nie_wywraca_synchronizacji(db):
    _klient()
    _wz("w1", "c1", numer="WZ/1/11/26", release_date="brak daty")
    _wz("w2", "c1", numer="WZ/2/11/26", release_date="2026-11-10")

    assert synchronizuj_wz()["dodane"] == 1
    assert _dok("w1") is None
    assert _dok("w2") is not None


def test_bledna_data_wydania_liczy_data_wystawienia(db):
    _klient()
    _wz("w1", "c1", release_date="jutro", issued_date="2026-11-11")

    synchronizuj_wz()

    assert _dok("w1")["data_dok"] == date(2026, 11, 11)


def test_pierwszy_kontrahent_z_dopasowania_ustawia_forme(db):
    _wz("w1", buyer_name="NOWY")
    synchronizuj_wz()
    assert _dok("w1")["client_id"] is None
    assert _dok("w1")["forma"] == "gotowka"

    _klient("c1", nazwa="NOWY", forma_wz="przelew", termin_wz=5)
    synchronizuj_wz()

    d = _dok("w1")
    assert d["client_id"] == "c1"
    assert d["forma"] == "przelew"
    assert d["termin"] == date(2026, 11, 15)


def test_przypisz_wz_pierwszy_kontrahent_ustawia_forme(db):
    _klient("c1", forma_wz="przelew")
    _wz("w1", buyer_name="NIKT")
    synchronizuj_wz()

    przypisz_wz(_dok("w1")["id"], "c1", "biuro")

    assert _dok("w1")["forma"] == "przelew"


def test_przypisz_wz_tylko_dla_WZ_z_MES(db):
    from fastapi import HTTPException
    _klient()
    execute("INSERT INTO rozl_dokumenty (id, ksiega, zrodlo, numer, data_dok, termin) "
            "VALUES ('r1','wz','reczna','R/1','2026-11-10','2026-11-10')")

    with pytest.raises(HTTPException) as e:
        przypisz_wz("r1", "c1", "biuro")

    assert e.value.status_code == 400
    assert query_one("SELECT client_id FROM rozl_dokumenty WHERE id='r1'")["client_id"] is None


def test_synchronizacja_czeka_na_blokade_ksiegi(db):
    """Zapis biura trzyma blokadę księgi — synchronizacja nie może przeczytać
    wiersza przed jego zatwierdzeniem i potem go nadpisać."""
    import threading
    from app.db import transaction
    from app.services.rozliczenia_wz import zablokuj_ksiege_wz

    _klient()
    _wz("w1", "c1")
    wynik = {}
    watek = threading.Thread(target=lambda: wynik.update(synchronizuj_wz()))
    with transaction() as conn:
        zablokuj_ksiege_wz(conn)
        watek.start()
        watek.join(0.5)
        assert watek.is_alive()
    watek.join(5)
    assert wynik["dodane"] == 1
