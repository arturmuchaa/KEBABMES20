"""Rozliczenia — poprawki właściciela z 12.11.2026 (Task 1, backend).

* D1 — wyłączenie klienta z rozrachunków (`clients.rozl_wylaczony`).
* D2 — WZ „nie licz do rozrachunków” (`rozl_dokumenty.nie_licz`).
* D3 / D3a — kilogramy (`rozl_dokumenty.kg`) i obrót za okres; saldo
  otwarcia nie wchodzi ani do obrotu, ani do kg.
* D7 — data startu zablokowana (PUT → 403).
* D8 — miękkie usunięcie notatki.
* D11 — pusta karta dla klienta bez danych; lista z samym saldem otwarcia.
* D12 — szczegóły dokumentu: kg, kwota, zapłacono, zostało, pokrycie z całą
  kwotą wpłaty.

Testy DB — bez TEST_DATABASE_URL skip (poza testami czystych funkcji).
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.routes import rozliczenia as route
from app.services.rozliczenia_ksiega import kg_wz, obrot_okresu
from app.services.rozliczenia_service import (dodaj_fakture, dodaj_wpis_dziennika,
                                              dodaj_wplate, dokument, edytuj_dokument,
                                              historia_zmian, karta, lista,
                                              rozliczenia_otwarte, ustaw_klienta,
                                              ustaw_nie_licz, ustaw_otwarcie,
                                              usun_wpis_dziennika, zestawienie,
                                              zestawienie_dla_wz)
from app.services.rozliczenia_wz import data_startu, synchronizuj_wz
from tests.test_rozliczenia_odczyt_db import _klient, _poz, przywroc_start  # noqa: F401
from tests.test_rozliczenia_wz_db import _dok, _wz

KTO = SimpleNamespace(state=SimpleNamespace(subject={"username": "ala"}))


def _otworz(cid, kwota=0, ksiega="wz"):
    ustaw_otwarcie(cid, ksiega, kwota=kwota, zalegle_od=None, uwagi="", kto="biuro")


def _linie(wartosc, kg_szt=None, szt=None, kg_luz=None):
    """Pozycje WZ: sztuki z gramaturą (total_kg) albo towar na kg."""
    linie = []
    if szt is not None:
        linie.append({"name": "Kebab", "qty": szt, "unit": "szt", "kg_per_unit": kg_szt,
                      "total_kg": round(szt * kg_szt, 3), "value": wartosc, "vat_rate": 0})
    if kg_luz is not None:
        linie.append({"name": "Mięso", "qty": kg_luz, "unit": "kg", "value": 0,
                      "vat_rate": 0})
    return linie or _poz(wartosc)


def _po_id(l):
    return {k["id"]: k for k in l["kontrahenci"]}


# ── D1: wyłączenie klienta ──────────────────────────────────────────────

def test_wylaczony_klient_znika_z_listy_i_sum_i_wraca_po_przywroceniu(db):
    _klient("a", "ALFA")
    _klient("b", "BETA")
    _wz("wa", "a", numer="WZ 1/11", release_date="2026-11-10", lines=_poz(500),
        buyer_name="ALFA")
    _wz("wb", "b", numer="WZ 2/11", release_date="2026-11-10", lines=_poz(300),
        buyer_name="BETA")
    synchronizuj_wz()
    assert lista()["podsumowanie"]["PLN"]["naleznosci"] == 800.0

    ustaw_klienta("b", {"wylaczony": True}, "biuro")

    l = lista()
    assert set(_po_id(l)) == {"a"}
    assert l["podsumowanie"]["PLN"]["naleznosci"] == 500.0
    assert l["podsumowanie"]["PLN"]["obrot"] == 500.0
    assert l["wylaczeni"] == [{"id": "b", "nazwa": "BETA", "nip": "", "waluta": "PLN"}]
    assert karta("b")["klient"]["wylaczony"] is True
    h = query_all("SELECT opis, przed, po FROM rozl_historia "
                  "WHERE client_id='b' AND obiekt='klient'")
    assert len(h) == 1
    assert h[0]["po"] == {"wylaczony": True} and h[0]["przed"] == {"wylaczony": False}
    assert "wyłączone" in h[0]["opis"]

    ustaw_klienta("b", {"wylaczony": False}, "biuro")

    l = lista()
    assert set(_po_id(l)) == {"a", "b"}
    assert l["podsumowanie"]["PLN"]["naleznosci"] == 800.0
    assert l["wylaczeni"] == []
    assert karta("b")["klient"]["wylaczony"] is False


def test_wylaczony_klient_nie_ma_salda_na_wz(db):
    _klient("k", "KLIENT")
    _wz("w1", "k", numer="WZ 1/11", release_date="2026-11-10", buyer_name="KLIENT")
    synchronizuj_wz()
    _otworz("k", 0)
    assert zestawienie_dla_wz("w1") is not None
    assert rozliczenia_otwarte("k") is True

    ustaw_klienta("k", {"wylaczony": True}, "biuro")

    assert zestawienie_dla_wz("w1") is None
    assert rozliczenia_otwarte("k") is False


def test_wylaczony_klient_nie_ma_salda_w_papierach_kursu(db):
    from app.services.loading_service import zaladunek, zaladunki_do_wydruku
    from tests.partial_loading_helpers import finalize_loading
    from tests.test_finalize_loading_db import _przygotuj

    _przygotuj()
    finalize_loading("v1", ["o1"], plate="KR 99999")
    kurs = zaladunki_do_wydruku()[0]["id"]
    _otworz("c1", 0)
    assert zaladunek(kurs)["pozycje"][0]["rozliczenia_otwarte"] is True

    ustaw_klienta("c1", {"wylaczony": True}, "biuro")

    assert zaladunek(kurs)["pozycje"][0]["rozliczenia_otwarte"] is False


def test_wz_wylaczonego_klienta_nadal_trafia_do_ksiegi(db):
    _klient("k", "KLIENT")
    ustaw_klienta("k", {"wylaczony": True}, "biuro")
    _wz("w1", "k", numer="WZ 1/11", release_date="2026-11-10", buyer_name="KLIENT")

    synchronizuj_wz()

    assert _dok("w1")["client_id"] == "k"
    assert lista()["kontrahenci"] == []


def test_wylaczony_musi_byc_tak_albo_nie(db):
    _klient("k")
    with pytest.raises(HTTPException) as e:
        ustaw_klienta("k", {"wylaczony": "tak"}, "biuro")
    assert e.value.status_code == 400


# ── D2: WZ nie liczona ──────────────────────────────────────────────────

@pytest.fixture
def dwie_wz(db):
    _klient("k", "KLIENT")
    _wz("w1", "k", numer="WZ 1/11", release_date="2026-11-10",
        lines=_linie(500, kg_szt=15, szt=10), buyer_name="KLIENT")
    _wz("w2", "k", numer="WZ 2/11", release_date="2026-11-11",
        lines=_linie(300, kg_szt=10, szt=3), buyer_name="KLIENT")
    synchronizuj_wz()
    _otworz("k", 0)
    return {"w1": _dok("w1")["id"], "w2": _dok("w2")["id"]}


def test_wz_nieliczona_poza_saldem_zestawieniem_i_obrotem(dwie_wz):
    assert karta("k")["saldo"]["wz"] == -800.0

    wynik = ustaw_nie_licz(dwie_wz["w2"], True, "towar dla wspólnika", "biuro")

    assert wynik["nie_licz"] is True and wynik["stan"]["kod"] == "nie_licz"
    k = karta("k")
    assert k["saldo"]["wz"] == -500.0
    assert k["obrot"] == 500.0 and k["kg"] == 150.0
    wiersz = next(d for d in k["dokumenty"]["wz"] if d["id"] == dwie_wz["w2"])
    assert wiersz["nie_licz"] is True
    assert wiersz["nie_licz_powod"] == "towar dla wspólnika"
    assert wiersz["zostalo"] == 0.0
    assert [d["nie_licz"] for d in k["dokumenty"]["wz"] if d["id"] == dwie_wz["w1"]] == [False]
    z = zestawienie("k")
    assert [p["numer"] for p in z["wz"]["pozycje"]] == ["WZ 1/11"]
    assert z["razem"] == 500.0
    assert zestawienie_dla_wz("w2") is None
    assert [p["numer"] for p in zestawienie_dla_wz("w1")["wz"]["pozycje"]] == ["WZ 1/11"]
    l = lista()
    assert _po_id(l)["k"]["saldo"] == -500.0
    assert _po_id(l)["k"]["obrot"] == 500.0
    h = query_all("SELECT akcja, powod, przed, po FROM rozl_historia "
                  "WHERE obiekt='dokument' AND obiekt_id=%s AND akcja='nie_licz'",
                  (dwie_wz["w2"],))
    assert h == [{"akcja": "nie_licz", "powod": "towar dla wspólnika",
                  "przed": {"nie_licz": False}, "po": {"nie_licz": True}}]


def test_wz_nieliczona_cofniecie_wraca_do_salda(dwie_wz):
    ustaw_nie_licz(dwie_wz["w2"], True, "pomyłka magazynu", "biuro")

    wynik = ustaw_nie_licz(dwie_wz["w2"], False, "jednak liczymy", "biuro")

    assert wynik["nie_licz"] is False
    assert karta("k")["saldo"]["wz"] == -800.0
    assert query_one("SELECT nie_licz_powod FROM rozl_dokumenty WHERE id=%s",
                     (dwie_wz["w2"],))["nie_licz_powod"] is None
    assert query_one("SELECT powod FROM rozl_historia WHERE obiekt_id=%s AND akcja='licz'",
                     (dwie_wz["w2"],))["powod"] == "jednak liczymy"


def test_synchronizacja_nie_nadpisuje_nie_licz(dwie_wz):
    ustaw_nie_licz(dwie_wz["w2"], True, "nie nasze pieniądze", "biuro")
    execute("UPDATE wz_documents SET lines=%s::jsonb WHERE id='w2'",
            (json.dumps(_linie(450, kg_szt=10, szt=3)),))

    synchronizuj_wz()

    d = _dok("w2")
    assert d["nie_licz"] is True and d["nie_licz_powod"] == "nie nasze pieniądze"
    assert float(d["kwota"]) == 450.0
    assert karta("k")["saldo"]["wz"] == -500.0


def test_nie_licz_wymaga_powodu_i_odmawia_dla_faktury(dwie_wz):
    with pytest.raises(HTTPException) as e:
        ustaw_nie_licz(dwie_wz["w1"], True, "  ", "biuro")
    assert e.value.status_code == 400
    fv = dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=100,
                       termin=None, forma=None, uwagi="", kto="biuro")
    with pytest.raises(HTTPException) as e:
        ustaw_nie_licz(fv["id"], True, "powód", "biuro")
    assert e.value.status_code == 400
    assert "Faktur" in e.value.detail


def test_route_nie_licz(dwie_wz):
    wynik = route.nie_licz(dwie_wz["w2"], {"nie_licz": True, "powod": "próbka"}, KTO)

    assert wynik["nie_licz"] is True
    assert dokument(dwie_wz["w2"])["nie_licz"] is True
    with pytest.raises(HTTPException) as e:
        route.nie_licz(dwie_wz["w2"], {"nie_licz": "tak", "powod": "x"}, KTO)
    assert e.value.status_code == 400


# ── D3 / D3a: kilogramy i obrót ─────────────────────────────────────────

def test_kg_wz_z_pozycji():
    assert kg_wz(_linie(500, kg_szt=15, szt=10, kg_luz=20.5)) == Decimal("170.500")
    assert kg_wz([{"qty": 4, "unit": "szt"}]) == Decimal("0.000")
    assert kg_wz([]) == Decimal("0.000")


def test_kg_z_pozycji_wz_wypelniane_takze_wstecznie(db):
    _klient("k", "KLIENT")
    _wz("w1", "k", numer="WZ 1/11", release_date="2026-11-10",
        lines=_linie(500, kg_szt=15, szt=10, kg_luz=20), buyer_name="KLIENT")
    synchronizuj_wz()
    assert _dok("w1")["kg"] == Decimal("170.000")
    historia_przed = len(query_all("SELECT 1 FROM rozl_historia"))

    execute("UPDATE rozl_dokumenty SET kg=NULL")  # wiersze sprzed kolumny kg
    wynik = synchronizuj_wz()

    assert _dok("w1")["kg"] == Decimal("170.000")
    assert wynik["zmienione"] == 0
    assert len(query_all("SELECT 1 FROM rozl_historia")) == historia_przed


@pytest.fixture
def obroty(db):
    """Listopad: WZ 1000 zł / 100 kg, FV 2000 zł / 50 kg, korekta −200 zł,
    WZ nieliczona 300 zł / 30 kg; grudzień: WZ 400 zł / 40 kg; saldo otwarcia
    −5000 zł i faktura sprzed startu — poza obrotem i kg."""
    _klient("k", "KLIENT")
    _wz("w1", "k", numer="WZ 1/11", release_date="2026-11-10",
        lines=_linie(1000, kg_szt=10, szt=10), buyer_name="KLIENT")
    _wz("w2", "k", numer="WZ 2/11", release_date="2026-11-11",
        lines=_linie(300, kg_szt=10, szt=3), buyer_name="KLIENT")
    _wz("w3", "k", numer="WZ 1/12", release_date="2026-12-05",
        lines=_linie(400, kg_szt=10, szt=4), buyer_name="KLIENT")
    synchronizuj_wz()
    ustaw_nie_licz(_dok("w2")["id"], True, "nie nasze", "biuro")
    dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 20), kwota=2000, termin=None,
                  forma=None, uwagi="", kto="biuro", kg=50)
    dodaj_fakture("k", numer="KOR 1/11", data=date(2026, 11, 21), kwota=-200, termin=None,
                  forma=None, uwagi="", kto="biuro")
    execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, waluta, termin, kg) VALUES ('stara','k','fv','reczna','FV 9/10',"
            " '2026-10-20', 999, 'PLN', '2026-10-27', 99)")
    _otworz("k", -5000)


def test_obrot_i_kg_za_miesiac_rok_i_od_poczatku(obroty):
    listopad = lista(od=date(2026, 11, 1), do=date(2026, 11, 30))
    rok = lista(od=date(2026, 1, 1), do=date(2026, 12, 31))
    od_poczatku = lista()

    assert (_po_id(listopad)["k"]["obrot"], _po_id(listopad)["k"]["kg"]) == (2800.0, 150.0)
    assert (_po_id(rok)["k"]["obrot"], _po_id(rok)["k"]["kg"]) == (3200.0, 190.0)
    assert (_po_id(od_poczatku)["k"]["obrot"], _po_id(od_poczatku)["k"]["kg"]) == (3200.0,
                                                                                   190.0)
    assert listopad["podsumowanie"]["PLN"]["obrot"] == 2800.0
    assert listopad["podsumowanie"]["PLN"]["kg"] == 150.0
    assert listopad["podsumowanie"]["EUR"]["obrot"] == 0.0
    # Okres w odpowiedzi to okres faktycznie policzony: nie wcześniej niż start.
    assert listopad["okres"] == {"od": data_startu().isoformat(), "do": "2026-11-30"}
    # „Od początku” = od daty startu (wcześniejsze dokumenty są w saldzie otwarcia).
    assert od_poczatku["okres"] == {"od": data_startu().isoformat(), "do": None}
    assert _po_id(od_poczatku)["k"]["fv_bez_kwoty"] == 0


def test_karta_obrot_i_kg_za_okres_niezalezne_od_filtra_dokumentow(obroty):
    k = karta("k", okres_od=date(2026, 12, 1), okres_do=date(2026, 12, 31),
              od=date(2026, 11, 20), do=date(2026, 11, 20))

    assert (k["obrot"], k["kg"]) == (400.0, 40.0)
    assert k["okres"] == {"od": "2026-12-01", "do": "2026-12-31"}
    assert [d["numer"] for d in k["dokumenty"]["fv"]] == ["FV 1/11"]
    assert k["fv_bez_kwoty"] == 0


def test_saldo_otwarcia_nie_wchodzi_do_obrotu_ani_kg(db):
    _klient("k", "KLIENT")
    _otworz("k", -5000)
    _otworz("k", -700, "fv")

    k = karta("k")
    l = lista()

    assert k["saldo"]["lacznie"] == -5700.0
    assert (k["obrot"], k["kg"]) == (0.0, 0.0)
    assert (_po_id(l)["k"]["obrot"], _po_id(l)["k"]["kg"]) == (0.0, 0.0)


def test_route_lista_i_karta_z_okresem(obroty):
    l = route.lista(od="2026-11-01", do="2026-11-30")
    k = route.karta("k", od="", do="", okres_od="2026-11-01", okres_do="2026-11-30")

    assert _po_id(l)["k"]["obrot"] == 2800.0
    assert (k["obrot"], k["kg"]) == (2800.0, 150.0)
    with pytest.raises(HTTPException) as e:
        route.lista(od="2026-12-01", do="2026-11-01")
    assert e.value.status_code == 400


def test_obrot_okresu_faktura_bez_kwoty_daje_kg_bez_obrotu():
    """FV z papierów kursu bez kwoty (Task 2): kg wchodzi do sprzedanych kg,
    do obrotu dopiero po wpisaniu kwoty; licznik `fv_bez_kwoty` bez okresu."""
    def dok(**kw):
        return {"ksiega": "fv", "data_dok": date(2026, 11, 20), "kwota": Decimal("0"),
                "waluta": "PLN", "stan_zrodla": "aktywny", "nie_licz": False,
                "kg": None, **kw}

    docs = [dok(stan_zrodla="czeka_na_kwote", kg=Decimal("25")),
            dok(kwota=None, kg=Decimal("5")),
            dok(data_dok=date(2026, 10, 1), stan_zrodla="czeka_na_kwote", kg=Decimal("7")),
            dok(kwota=Decimal("100"), kg=Decimal("10")),
            dok(kwota=Decimal("50"), waluta="EUR", kg=Decimal("3")),
            dok(ksiega="wz", kwota=Decimal("10"), stan_zrodla="czeka_na_ceny",
                kg=Decimal("9"))]

    w = obrot_okresu(docs, "PLN", date(2026, 11, 1), date(2026, 11, 30))

    assert w == {"obrot": Decimal("100.00"), "kg": Decimal("40.000"), "fv_bez_kwoty": 3}


def test_faktura_reczna_z_kg_i_edycja_kg(db):
    _klient("k", "KLIENT")
    fv = dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=100,
                       termin=None, forma=None, uwagi="", kto="biuro", kg=12.5)
    assert fv["kg"] == 12.5

    po = edytuj_dokument(fv["id"], {"kg": 20}, "biuro")

    assert po["kg"] == 20.0
    h = query_one("SELECT opis, przed, po FROM rozl_historia "
                  "WHERE obiekt_id=%s AND akcja='zmiana'", (fv["id"],))
    assert h["przed"] == {"kg": 12.5} and h["po"] == {"kg": 20.0}
    assert "12,5" in h["opis"] and "20" in h["opis"]
    with pytest.raises(HTTPException) as e:
        edytuj_dokument(fv["id"], {"kg": -1}, "biuro")
    assert e.value.status_code == 400


def test_route_faktura_z_kg_tekstowym(db):
    _klient("k", "KLIENT")

    route.dodaj_fakture("k", {"numer": "FV 2/11", "data": "2026-11-10", "kwota": 10,
                              "kg": "1 250,5"}, KTO)

    assert query_one("SELECT kg FROM rozl_dokumenty WHERE numer='FV 2/11'")["kg"] == \
        Decimal("1250.500")


# ── D7: data startu zablokowana ─────────────────────────────────────────

def test_put_daty_startu_to_403(db, przywroc_start):
    przed = route.ustawienia()

    with pytest.raises(HTTPException) as e:
        route.ustaw_ustawienia({"start": "2026-12-01"}, KTO)

    assert e.value.status_code == 403
    assert e.value.detail == "Data startu rozliczeń jest zablokowana"
    assert route.ustawienia() == przed


# ── D8: usuwanie notatek ────────────────────────────────────────────────

def test_usuniecie_notatki_ukrywa_ja_i_pisze_historie(db):
    _klient("k", "KLIENT")
    _otworz("k", 0)
    zostaje = dodaj_wpis_dziennika("k", "Zadzwonić w piątek", None, "biuro")
    wpis = dodaj_wpis_dziennika("k", "Obiecał zapłacić", date(2026, 11, 1), "biuro")
    assert _po_id(lista(dzis=date(2026, 11, 12)))["k"]["przypomnienie"] is True

    usun_wpis_dziennika(wpis["id"], "biuro", powod="nieaktualne")

    assert [d["id"] for d in karta("k")["dziennik"]] == [zostaje["id"]]
    assert _po_id(lista(dzis=date(2026, 11, 12)))["k"]["przypomnienie"] is False
    r = query_one("SELECT usunieto_at, usunieto_przez FROM rozl_dziennik WHERE id=%s",
                  (wpis["id"],))
    assert r["usunieto_at"] is not None and r["usunieto_przez"] == "biuro"
    h = historia_zmian("k")["wpisy"][0]
    assert (h["obiekt"], h["akcja"], h["czego"], h["powod"], h["usuniete"]) == \
        ("notatka", "usunieto", "Notatka", "nieaktualne", True)
    assert "Obiecał zapłacić" in h["opis"]
    with pytest.raises(HTTPException) as e:
        usun_wpis_dziennika(wpis["id"], "biuro")
    assert e.value.status_code == 400


def test_route_usun_notatke(db):
    _klient("k", "KLIENT")
    wpis = dodaj_wpis_dziennika("k", "Notatka", None, "biuro")

    assert route.usun_wpis(wpis["id"], {}, KTO) == {"ok": True}

    assert karta("k")["dziennik"] == []
    with pytest.raises(HTTPException) as e:
        route.usun_wpis("nie-ma", {}, KTO)
    assert e.value.status_code == 404


# ── D11: klient bez danych ──────────────────────────────────────────────

def test_karta_klienta_bez_danych_jest_pusta(db):
    _klient("k", "TRUVA")

    k = karta("k")

    assert k["klient"]["nazwa"] == "TRUVA"
    assert k["dokumenty"] == {"wz": [], "fv": []}
    assert k["saldo"]["lacznie"] == 0.0
    assert k["otwarcia"] == {"wz": None, "fv": None}
    assert (k["obrot"], k["kg"], k["fv_bez_kwoty"]) == (0.0, 0.0, 0)


def test_lista_pokazuje_klienta_z_samym_saldem_otwarcia_nawet_zerowym(db):
    _klient("k", "TRUVA")
    _klient("pusty", "PUSTY")
    _otworz("k", 0)

    assert set(_po_id(lista())) == {"k"}
    assert _po_id(lista())["k"]["stan"] == "rozliczony"


# ── D12: szczegóły dokumentu ────────────────────────────────────────────

def test_dokument_ma_kg_zaplacono_zostalo_i_pelna_kwote_wplaty(db):
    _klient("k", "KLIENT")
    a = dodaj_fakture("k", numer="FV 1/11", data=date(2026, 11, 10), kwota=1000,
                      termin=None, forma=None, uwagi="", kto="biuro", kg=40)
    b = dodaj_fakture("k", numer="FV 2/11", data=date(2026, 11, 11), kwota=1000,
                      termin=None, forma=None, uwagi="", kto="biuro", kg=60)
    w = dodaj_wplate("k", ksiega="fv", forma="przelew", kwota=1500, data=date(2026, 11, 12),
                     dokument_id=None, uwagi="przelew zbiorczy", kto="ala")

    d = dokument(b["id"])

    assert (d["kwota"], d["zaplacono"], d["zostalo"], d["kg"]) == (1000.0, 500.0, 500.0, 60.0)
    assert d["termin"] == "2026-11-18"
    assert (d["ksiega"], d["client_id"]) == ("fv", "k")
    assert d["pokrycie"] == [{"data": "2026-11-12", "forma": "przelew", "kwota": 500.0,
                              "kwota_wplaty": 1500.0, "uwagi": "przelew zbiorczy",
                              "kto": "ala", "rodzaj": "wplata", "wplata_id": w["id"]}]
    assert dokument(a["id"])["pokrycie"][0]["kwota"] == 1000.0
