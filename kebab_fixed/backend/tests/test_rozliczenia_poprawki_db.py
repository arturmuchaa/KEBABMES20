"""Rozliczenia — poprawki po przeglądzie całej gałęzi.

* C1 — tabelka salda na WZ i zestawienie w papierach kursu tylko dla klienta
  z „otwartymi rozliczeniami” (jest wiersz w `rozl_otwarcia`), a na WZ także
  tylko dla wycenionej, aktywnej WZ w walucie kontrahenta; lista pokazuje
  „sprawdź walutę” zamiast „rozliczony”, gdy są pozycje w innej walucie.
* I2 — WZ drukowana przed datą wydania jest w swojej tabelce.
* I3 — faktura korygująca widoczna na karcie jako wiersz ujemny.
* I4 — historia zmian klienta (także usunięte wpłaty i faktury).
* I6 — niemożliwa data WZ (30.02) nie wywraca synchronizacji.
* M1 — klucze obce rozl_* do clients: ON DELETE RESTRICT.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

import psycopg2
import pytest

from app.db import execute, query_all, query_one
from app.migrations import _rozl_klucze_bez_kaskady
from app.routes import rozliczenia as route
from app.services import rozliczenia_wz
from app.services.rozliczenia_service import (dodaj_fakture, dodaj_wplate, dokument,
                                              historia_okresu, historia_zmian, karta,
                                              lista, usun_dokument, usun_wplate,
                                              ustaw_klienta, ustaw_otwarcie,
                                              zestawienie_dla_wz)
from app.services.rozliczenia_wz import synchronizuj_wz
from tests.test_rozliczenia_odczyt_db import (_id_wz, _klient, _otwarcie, _poz,  # noqa: F401
                                              przywroc_start, rojpak)
from tests.test_rozliczenia_wz_db import _dok, _wz

DZIS = date.today()


def _otworz(cid, kwota=0, ksiega="wz"):
    ustaw_otwarcie(cid, ksiega, kwota=kwota, zalegle_od=None, uwagi="", kto="biuro")


# ── C1: bramka tabelki salda na WZ ──────────────────────────────────────

def test_na_wz_bez_salda_otwarcia_nie_drukuje_sie(rojpak):
    assert zestawienie_dla_wz("w3") is None


def test_na_wz_po_zerowym_saldzie_otwarcia_drukuje_sie(rojpak):
    _otworz(rojpak["cid"], 0)

    z = zestawienie_dla_wz("w3")

    assert z is not None
    assert [p["numer"] for p in z["wz"]["pozycje"] if p["ten_dokument"]] == ["WZ 02/11"]


def test_zerowe_saldo_otwarcia_za_pierwszym_razem_zapisuje_wiersz_i_historie(db):
    _klient("k", waluta="PLN")

    _otworz("k", 0)

    assert query_one("SELECT kwota FROM rozl_otwarcia WHERE client_id='k' AND ksiega='wz'")
    h = query_all("SELECT opis FROM rozl_historia WHERE client_id='k' AND obiekt='otwarcie'")
    assert len(h) == 1 and "wprowadzone" in h[0]["opis"]
    # Ponowny zapis tego samego nic nie dopisuje.
    _otworz("k", 0)
    assert len(query_all("SELECT 1 FROM rozl_historia WHERE client_id='k'")) == 1


def test_na_wz_w_innej_walucie_niz_kontrahent_nie_drukuje_sie(db):
    _klient("de", "MUSTER", nip="DE111", waluta="PLN")
    _wz("we", "de", numer="WZ 1/11", release_date="2026-11-10", lines=_poz(500),
        buyer_name="MUSTER", currency="EUR")
    synchronizuj_wz()
    _otworz("de", 0)

    assert zestawienie_dla_wz("we") is None


def test_na_wz_czeka_na_ceny_i_anulowana_nie_drukuja_sie(db):
    _klient("k", "KLIENT")
    _wz("bez", "k", numer="WZ 1/11", release_date="2026-11-10", valued=False,
        buyer_name="KLIENT")
    _wz("anu", "k", numer="WZ 2/11", release_date="2026-11-10", status="anulowany",
        buyer_name="KLIENT")
    _wz("ok", "k", numer="WZ 3/11", release_date="2026-11-10", buyer_name="KLIENT")
    synchronizuj_wz()
    _otworz("k", 0)

    assert zestawienie_dla_wz("bez") is None
    assert zestawienie_dla_wz("anu") is None
    assert zestawienie_dla_wz("ok") is not None


def test_karta_mowi_czy_rozliczenia_otwarte(rojpak):
    assert karta(rojpak["cid"])["rozliczenia_otwarte"] is False
    _otworz(rojpak["cid"], 0, "fv")
    assert karta(rojpak["cid"])["rozliczenia_otwarte"] is True


def test_route_na_wz_bez_otwarcia_to_404(rojpak):
    with pytest.raises(Exception) as e:
        route.na_wz("w3")
    assert getattr(e.value, "status_code", None) == 404


# ── C1 (T4): lista — „sprawdź walutę” ───────────────────────────────────

def test_lista_klient_z_samymi_pozycjami_w_innej_walucie_sprawdz_walute(db):
    _klient("obcy", "OBCY", nip="DE222", waluta="PLN")
    _klient("roz", "ROZLICZONY", waluta="PLN")
    _wz("we", "obcy", numer="WZ 1/11", release_date="2026-11-10", lines=_poz(500),
        buyer_name="OBCY", currency="EUR")
    _otwarcie("roz", "wz", -100)
    execute("UPDATE rozl_otwarcia SET kwota=0 WHERE client_id='roz'")
    execute("INSERT INTO rozl_wplaty (id, client_id, ksiega, forma, kwota, waluta, data) "
            "VALUES ('w1','roz','wz','gotowka',10,'PLN','2026-11-10')")
    execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, waluta, termin) VALUES ('d1','roz','wz','reczna','R1','2026-11-10',"
            " 10,'PLN','2026-11-10')")

    l = lista()

    po_id = {k["id"]: k for k in l["kontrahenci"]}
    assert po_id["obcy"]["stan"] == "sprawdz_walute"
    assert po_id["obcy"]["inna_waluta"] == 1
    assert po_id["roz"]["stan"] == "rozliczony"
    assert po_id["roz"]["inna_waluta"] == 0
    # Do sprawdzenia nie ląduje na końcu z rozliczonymi.
    assert [k["id"] for k in l["kontrahenci"]] == ["obcy", "roz"]


# ── C1: papiery kursu ───────────────────────────────────────────────────

def test_pozycja_kursu_mowi_czy_rozliczenia_otwarte(db):
    from app.services.loading_service import zaladunek, zaladunki_do_wydruku
    from tests.partial_loading_helpers import finalize_loading
    from tests.test_finalize_loading_db import _przygotuj

    _przygotuj()
    finalize_loading("v1", ["o1"], plate="KR 99999")
    kurs = zaladunki_do_wydruku()[0]["id"]

    assert zaladunek(kurs)["pozycje"][0]["rozliczenia_otwarte"] is False
    _otworz("c1", 0)
    assert zaladunek(kurs)["pozycje"][0]["rozliczenia_otwarte"] is True


# ── I2: WZ drukowana przed datą wydania ─────────────────────────────────

def test_wz_z_przyszla_data_wydania_jest_w_swojej_tabelce(db):
    _klient("k", "KLIENT")
    jutro = DZIS + timedelta(days=3)
    _wz("wz", "k", numer="WZ 9/11", release_date=jutro.isoformat(), lines=_poz(800),
        buyer_name="KLIENT")
    synchronizuj_wz()
    _otworz("k", 0)
    # Wpłata wpisana z datą między dziś a datą wydania liczy się tak samo.
    execute("INSERT INTO rozl_wplaty (id, client_id, ksiega, forma, kwota, waluta, data) "
            "VALUES ('w1','k','wz','gotowka',300,'PLN',%s)", (DZIS + timedelta(days=1),))

    z = zestawienie_dla_wz("wz")

    assert z["na_dzien"] == jutro.isoformat()
    poz = [p for p in z["wz"]["pozycje"] if p["ten_dokument"]]
    assert [(p["numer"], p["pozostalo"]) for p in poz] == [("WZ 9/11", 500.0)]
    assert z["razem"] == 500.0


# ── I3: faktura korygująca na karcie ────────────────────────────────────

def test_korekta_widoczna_na_karcie_jako_wiersz_ujemny(db, przywroc_start):
    _klient("k", waluta="PLN")
    fv = dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=1000,
                       termin=None, forma=None, uwagi="", kto="biuro")
    kor = dodaj_fakture("k", numer="FVK 1/11", data=date(2026, 11, 11), kwota=-200,
                        termin=None, forma=None, uwagi="zwrot 10 kg", kto="biuro")

    k = karta("k")

    wiersz = next(d for d in k["dokumenty"]["fv"] if d["id"] == kor["id"])
    assert wiersz["kwota"] == -200.0
    assert wiersz["stan"]["kod"] == "korekta"
    assert wiersz["korekta"] is True
    assert wiersz["rozliczyla"] == [{"numer": "FV 1/11", "kwota": 200.0}]
    assert wiersz["uwagi"] == "zwrot 10 kg"
    faktura = next(d for d in k["dokumenty"]["fv"] if d["id"] == fv["id"])
    assert faktura["zostalo"] == 800.0 and faktura["korekta"] is False
    # Najnowsze na górze — korekta z 11.11 przed fakturą z 10.11.
    assert [d["numer"] for d in k["dokumenty"]["fv"]] == ["FVK 1/11", "FV 1/11"]
    assert k["saldo"]["fv"] == -800.0


def test_szczegoly_korekty_mowia_co_rozliczyla_a_usuniecie_ja_zdejmuje(db, przywroc_start):
    _klient("k", waluta="PLN")
    dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=1000,
                  termin=None, forma=None, uwagi="", kto="biuro")
    kor = dodaj_fakture("k", numer="FVK 1/11", data=date(2026, 11, 11), kwota=-200,
                        termin=None, forma=None, uwagi="", kto="biuro")

    d = dokument(kor["id"])
    assert d["stan"]["kod"] == "korekta" and d["kwota"] == -200.0
    assert d["rozliczyla"] == [{"numer": "FV 1/11", "kwota": 200.0}]

    usun_dokument(kor["id"], "wpisana pomyłkowo", "biuro")

    k = karta("k")
    assert [x["numer"] for x in k["dokumenty"]["fv"]] == ["FV 1/11"]
    assert k["saldo"]["fv"] == -1000.0


def test_korekta_w_historii_okresu(db, przywroc_start):
    _klient("k", waluta="PLN")
    dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=1000,
                  termin=None, forma=None, uwagi="", kto="biuro")
    dodaj_fakture("k", numer="FVK 1/11", data=date(2026, 11, 11), kwota=-200,
                  termin=None, forma=None, uwagi="", kto="biuro")

    h = historia_okresu("k", date(2026, 11, 9), date(2026, 11, 30))

    assert [(w["opis"], w["rodzaj"], w["wplata"]) for w in h["fv"]["wiersze"]] == [
        ("FV 1/11", "dokument", 0.0), ("Korekta FVK 1/11", "korekta", 200.0)]


# ── I4: historia zmian klienta ──────────────────────────────────────────

def test_historia_zmian_klienta_najnowsze_pierwsze_z_usunieciami(db, przywroc_start):
    _klient("k", waluta="PLN")
    fv = dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=1000,
                       termin=None, forma=None, uwagi="", kto="Anna")
    wp = dodaj_wplate("k", ksiega="fv", forma="przelew", kwota=300, data=date(2026, 11, 10),
                      dokument_id=None, uwagi="", kto="Anna")
    usun_wplate(wp["id"], "wpisana dwa razy", "Szef")
    usun_dokument(fv["id"], "zła faktura", "Szef")
    _otworz("k", -50)
    ustaw_klienta("k", {"termin_fv": 14}, "Anna")

    h = historia_zmian("k")

    wpisy = h["wpisy"]
    assert h["wiecej"] is False
    assert [w["kiedy"] for w in wpisy] == sorted((w["kiedy"] for w in wpisy), reverse=True)
    usuniete = [w for w in wpisy if w["usuniete"]]
    assert {(w["czego"], w["powod"], w["kto"]) for w in usuniete} == {
        ("FV 1/11", "zła faktura", "Szef"),
        ("Wpłata 300,00 PLN z 10.11.2026", "wpisana dwa razy", "Szef")}
    czego = [w["czego"] for w in wpisy]
    assert "Saldo otwarcia WZ" in czego and "Ustawienia klienta" in czego
    assert wpisy[0]["czego"] == "Ustawienia klienta"
    assert {"kiedy", "kto", "opis", "powod", "akcja", "obiekt"} <= set(wpisy[0])


def test_historia_zmian_limit_i_obcy_klient(db, przywroc_start):
    _klient("k", waluta="PLN")
    _klient("inny", waluta="PLN")
    for i in range(5):
        ustaw_klienta("k", {"termin_wz": i + 1}, "Anna")
    ustaw_klienta("inny", {"termin_wz": 3}, "Anna")

    h = historia_zmian("k", limit=3)

    assert len(h["wpisy"]) == 3 and h["wiecej"] is True
    # Opis po ludzku, nie nazwa kolumny: „termin płatności WZ (dni): 4 → 5”.
    assert [w["opis"] for w in h["wpisy"]] == [
        "termin płatności WZ (dni): 4 → 5", "termin płatności WZ (dni): 3 → 4",
        "termin płatności WZ (dni): 2 → 3"]


def test_route_historia_zmian(db, przywroc_start):
    _klient("k", waluta="PLN")
    ustaw_klienta("k", {"notatka": "płaci w piątki"}, "Anna")

    assert len(route.historia_zmian("k")["wpisy"]) == 1
    with pytest.raises(Exception) as e:
        route.historia_zmian("nie-ma")
    assert getattr(e.value, "status_code", None) == 404


# ── I6: niemożliwa data WZ ──────────────────────────────────────────────

def test_niemozliwa_data_nie_wywraca_synchronizacji(db, caplog, monkeypatch):
    _klient("k", "KLIENT")
    _wz("zly", "k", numer="WZ 1/11", release_date="2026-02-30", buyer_name="KLIENT")
    _wz("zly2", "k", numer="WZ 2/11", release_date="2026-11-31", buyer_name="KLIENT")
    _wz("zast", "k", numer="WZ 3/11", release_date="2026-04-31", issued_date="2026-11-12",
        buyer_name="KLIENT")
    _wz("ok", "k", numer="WZ 4/11", release_date="2026-11-10", buyer_name="KLIENT")
    monkeypatch.setattr(rozliczenia_wz.logger, "propagate", True)

    with caplog.at_level(logging.WARNING):
        wynik = synchronizuj_wz()

    assert wynik["dodane"] == 2
    assert _dok("zly") is None and _dok("zly2") is None
    assert _dok("zast")["data_dok"] == date(2026, 11, 12)
    assert _dok("ok") is not None
    assert any("rozliczenia.wz.zla_data" in r.getMessage() for r in caplog.records)
    # Lista i karta działają dalej.
    assert lista()["kontrahenci"][0]["id"] == "k"


def test_luty_przestepny_jest_poprawna_data(db, przywroc_start):
    from app.services.rozliczenia_wz import ustaw_date_startu
    ustaw_date_startu(date(2028, 1, 1), "admin")
    _klient("k", "KLIENT")
    _wz("lut", "k", numer="WZ 1/02", release_date="2028-02-29", buyer_name="KLIENT")

    synchronizuj_wz()

    assert _dok("lut")["data_dok"] == date(2028, 2, 29)


# ── M1: klucze obce do clients bez kaskady ──────────────────────────────

_FK = ("SELECT c.conname, c.confdeltype FROM pg_constraint c "
       "WHERE c.conrelid = %s::regclass AND c.contype = 'f' "
       "  AND c.confrelid = 'clients'::regclass")


@pytest.mark.parametrize("tabela", ["rozl_wplaty", "rozl_otwarcia", "rozl_dziennik"])
def test_klucz_obcy_do_clients_restrict_tez_po_starej_kaskadzie(db, tabela):
    fk = query_one(_FK, (tabela,))
    assert fk["confdeltype"] == "r"
    # Baza sprzed poprawki: ten sam klucz z ON DELETE CASCADE.
    execute(f"ALTER TABLE {tabela} DROP CONSTRAINT {fk['conname']}")
    execute(f"ALTER TABLE {tabela} ADD CONSTRAINT {fk['conname']} FOREIGN KEY (client_id) "
            "REFERENCES clients(id) ON DELETE CASCADE")
    assert query_one(_FK, (tabela,))["confdeltype"] == "c"

    _rozl_klucze_bez_kaskady()
    _rozl_klucze_bez_kaskady()

    fks = query_all(_FK, (tabela,))
    assert [f["confdeltype"] for f in fks] == ["r"]


def test_usuniecie_klienta_z_wplata_odrzucone(db):
    _klient("k", waluta="PLN")
    execute("INSERT INTO rozl_wplaty (id, client_id, ksiega, forma, kwota, waluta, data) "
            "VALUES ('w1','k','wz','gotowka',10,'PLN','2026-11-10')")

    with pytest.raises(psycopg2.IntegrityError):
        execute("DELETE FROM clients WHERE id='k'")
    assert query_one("SELECT 1 FROM rozl_wplaty WHERE id='w1'")


def test_historia_zmian_opisy_po_polsku(db, przywroc_start):
    """Opisy czytelne dla biura: kwoty z przecinkiem, daty DD.MM.RRRR, bez None."""
    _klient("k", waluta="PLN")
    ustaw_otwarcie("k", "wz", kwota=-1250, zalegle_od=date(2026, 9, 20), uwagi="z arkusza",
                   kto="biuro")
    wp = dodaj_wplate("k", ksiega="wz", forma="gotowka", kwota=15000, data=date(2026, 11, 10),
                      dokument_id=None, uwagi="", kto="biuro")
    usun_wplate(wp["id"], "pomyłka", "biuro")
    fv = dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=1000,
                       termin=None, forma=None, uwagi="", kto="biuro")
    from app.services.rozliczenia_service import edytuj_dokument
    edytuj_dokument(fv["id"], {"kwota": 1200.5, "termin": date(2026, 11, 20)}, "biuro", "korekta ceny")

    opisy = {w["opis"] for w in historia_zmian("k")["wpisy"]}

    assert "saldo otwarcia WZ: kwota 0,00 → −1 250,00" in opisy
    assert "saldo otwarcia WZ: zaległe od — → 20.09.2026" in opisy
    assert "saldo otwarcia WZ: uwagi — → z arkusza" in opisy
    assert "wpłata 15 000,00 PLN do księgi WZ" in opisy
    assert "usunięto wpłatę 15 000,00 PLN" in opisy
    assert "FV 1/11: kwota 1 000,00 → 1 200,50" in opisy
    assert "FV 1/11: termin płatności 17.11.2026 → 20.11.2026" in opisy


# ── WZ wpisana ręcznie (właściciel 13.11.2026) ──────────────────────────

def test_wz_reczna_wchodzi_do_ksiegi_wz_i_salda(db, przywroc_start):
    from fastapi import HTTPException
    from app.services.rozliczenia_service import dodaj_wz_reczna, zestawienie
    _klient("k", waluta="PLN")
    _otworz("k")
    d = dodaj_wz_reczna("k", numer="WZ R/1/11", data=date(2026, 11, 10), kwota=1500,
                        termin=None, forma=None, uwagi="wydane poza MES", kto="biuro", kg=70)
    assert d["ksiega"] == "wz" and d["zrodlo"] == "reczna"
    z = zestawienie("k", na_dzien=date(2026, 11, 12))
    assert [p["numer"] for p in z["wz"]["pozycje"]] == ["WZ R/1/11"]
    assert z["wz"]["razem"] == 1500 and z["fv"]["pozycje"] == []
    # ten sam numer drugi raz, kwota zerowa/ujemna — odmowa
    for zle in (dict(numer="WZ R/1/11", kwota=10), dict(numer="WZ R/2/11", kwota=0), dict(numer="WZ R/3/11", kwota=-5)):
        with pytest.raises(HTTPException):
            dodaj_wz_reczna("k", data=date(2026, 11, 10), termin=None, forma=None, uwagi="", kto="biuro", **zle)
