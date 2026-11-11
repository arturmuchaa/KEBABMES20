"""Rozliczenia — zapisy biura: faktury, wpłaty z podglądem, saldo otwarcia,
ustawienia kontrahenta, dziennik ustaleń.

Scenariusz ROJPAK ze szkicu (fixture z testów odczytu). Testy DB — bez
TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.rozliczenia_service import (dodaj_fakture, dodaj_wpis_dziennika,
                                              dodaj_wplate, edytuj_dokument, karta,
                                              lista, odhacz_wpis, podglad_wplaty,
                                              usun_dokument, usun_wplate, ustaw_klienta,
                                              ustaw_otwarcie)
from app.services.rozliczenia_wz import synchronizuj_wz
from tests.test_rozliczenia_odczyt_db import (DZIS, _id_wz, _klient, _po_numerze,  # noqa: F401
                                              przywroc_start, rojpak)
from tests.test_rozliczenia_wz_db import _wz


def _blad(fn, *args, **kwargs) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*args, **kwargs)
    return e.value


def _fv(cid, numer="FV/1", data=DZIS, kwota=1000, termin=None, forma=None):
    return dodaj_fakture(cid, numer=numer, data=data, kwota=kwota, termin=termin,
                         forma=forma, uwagi="", kto="biuro")


def _wplac(cid, ksiega, kwota, data=DZIS, dokument_id=None, forma="przelew"):
    return dodaj_wplate(cid, ksiega=ksiega, forma=forma, kwota=kwota, data=data,
                        dokument_id=dokument_id, uwagi="", kto="biuro")


def _historia(obiekt_id):
    return query_all("SELECT * FROM rozl_historia WHERE obiekt_id=%s ORDER BY kiedy, id",
                     (obiekt_id,))


def _ile_wplat():
    return query_one("SELECT count(*) AS n FROM rozl_wplaty")["n"]


# ── Faktury ─────────────────────────────────────────────────────────────

def test_faktura_domyslny_termin_i_forma(db):
    _klient("k")

    d = _fv("k")

    assert d["termin"] == "2026-11-16"
    assert d["forma"] == "przelew"
    assert d["kwota"] == 1000.0
    assert d["zrodlo"] == "reczna"
    row = query_one("SELECT * FROM rozl_dokumenty WHERE id=%s", (d["id"],))
    assert row["waluta"] == "PLN"
    assert row["utworzyl"] == "biuro"
    assert [h["akcja"] for h in _historia(d["id"])] == ["dodano"]


def test_faktura_termin_z_ustawien_klienta(db):
    _klient("k")
    execute("UPDATE clients SET rozl_termin_fv=14, rozl_forma_fv='gotowka' WHERE id='k'")

    d = _fv("k")

    assert d["termin"] == "2026-11-23"
    assert d["forma"] == "gotowka"


def test_faktura_bledne_dane(db):
    _klient("k")
    _fv("k")

    e = _blad(_fv, "k")
    assert e.status_code == 400
    assert e.detail == "Faktura FV/1 jest już wpisana temu kontrahentowi"
    assert _blad(_fv, "k", numer="FV/2", kwota=0).status_code == 400
    assert _blad(_fv, "k", numer="FV/2", kwota=float("nan")).status_code == 400
    e = _blad(_fv, "k", numer="FV/2", data=date(2026, 11, 8))
    assert e.status_code == 400
    assert e.detail == ("Faktura sprzed daty startu rozliczeń (09.11.2026) "
                        "jest już w saldzie otwarcia")
    assert _blad(_fv, "nie-ma", numer="FV/2").status_code == 404


def test_po_usunieciu_numer_mozna_wpisac_ponownie(db):
    _klient("k")
    d = _fv("k")

    assert _blad(usun_dokument, d["id"], "", "biuro").status_code == 400
    usun_dokument(d["id"], "pomyłka", "biuro")
    nowa = _fv("k", kwota=1200)

    assert nowa["id"] != d["id"]
    assert karta("k", dzis=DZIS)["saldo"]["fv"] == -1200.0
    usunieta = _historia(d["id"])[-1]
    assert (usunieta["akcja"], usunieta["powod"]) == ("usunieto", "pomyłka")


def test_faktura_korygujaca(db):
    _klient("k")
    _fv("k", kwota=2000)

    kor = _fv("k", numer="KOR/1", kwota=-500)

    assert kor["kwota"] == -500.0
    assert karta("k", dzis=DZIS)["saldo"]["fv"] == -1500.0


def test_usun_WZ_z_MES_niedozwolone(rojpak):
    e = _blad(usun_dokument, _id_wz("w4"), "bo tak", "biuro")

    assert e.status_code == 400
    assert e.detail == "WZ anuluje się w dokumentach WZ"


def test_usun_dokument_z_subiekta_niedozwolone(db):
    _klient("k")
    execute("INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, waluta, termin) VALUES ('s1','k','fv','subiekt','FS/1',%s,100,'PLN',%s)",
            (DZIS, DZIS))

    e = _blad(usun_dokument, "s1", "bo tak", "biuro")

    assert e.status_code == 400
    assert e.detail == "Fakturę z Subiekta poprawia się w Subiekcie"
    assert query_one("SELECT usuniety_at FROM rozl_dokumenty WHERE id='s1'")["usuniety_at"] \
        is None


def test_faktura_termin_zero_dni_z_ustawien_klienta(db):
    _klient("k")
    execute("UPDATE clients SET rozl_termin_fv=0 WHERE id='k'")

    assert _fv("k")["termin"] == "2026-11-09"


# ── Podgląd i wpłaty ────────────────────────────────────────────────────

def test_podglad_wplaty_ROJPAK(rojpak):
    przed = _ile_wplat()

    p = podglad_wplaty(rojpak["cid"], ksiega="fv", kwota=15000, data=DZIS)

    assert p["przydzialy"] == [
        {"dokument_id": rojpak["fv"]["528"], "numer": "528", "kwota": 7280.0,
         "zostalo_przed": 7280.0, "zostalo_po": 0.0, "zamyka": True},
        {"dokument_id": rojpak["fv"]["541"], "numer": "541", "kwota": 7720.0,
         "zostalo_przed": 12342.2, "zostalo_po": 4622.2, "zamyka": False}]
    assert p["nadwyzka"] == 0.0
    assert _ile_wplat() == przed


def test_podglad_wplaty_przypietej_najpierw_na_wskazany_dokument(rojpak):
    p = podglad_wplaty(rojpak["cid"], ksiega="fv", kwota=12000,
                       dokument_id=rojpak["fv"]["553"], data=DZIS)

    assert [(r["numer"], r["kwota"]) for r in p["przydzialy"]] == [
        ("553", 10416.0), ("528", 1584.0)]


def test_dodaj_wplate_FV(rojpak):
    p = _wplac(rojpak["cid"], "fv", 15000)

    assert p["id"]
    assert [r["numer"] for r in p["przydzialy"]] == ["528", "541"]
    k = karta(rojpak["cid"], dzis=DZIS)
    assert k["saldo"]["fv"] == -15038.20
    row = query_one("SELECT * FROM rozl_wplaty WHERE id=%s", (p["id"],))
    assert row["waluta"] == "EUR"
    assert row["utworzyl"] == "biuro"
    assert [h["akcja"] for h in _historia(p["id"])] == ["dodano"]


def test_wplata_WZ_nie_rusza_FV_przelew_do_WZ_dozwolony(rojpak):
    _wplac(rojpak["cid"], "wz", 1000, forma="przelew")

    k = karta(rojpak["cid"], dzis=DZIS)
    assert k["saldo"]["fv"] == -30038.20
    assert k["saldo"]["wz"] == -7409.50


def test_wplata_bledne_dane(rojpak):
    cid = rojpak["cid"]
    assert _blad(_wplac, cid, "fv", 0).status_code == 400
    assert _blad(_wplac, cid, "fv", -10).status_code == 400
    assert _blad(_wplac, cid, "fv", float("inf")).status_code == 400
    assert _blad(_wplac, cid, "xx", 10).status_code == 400
    assert _blad(_wplac, cid, "fv", 10, forma="czek").status_code == 400
    assert _blad(_wplac, cid, "fv", 10, dokument_id=_id_wz("w4")).status_code == 400
    assert _blad(_wplac, "nie-ma", "fv", 10).status_code == 404


def test_wplata_sprzed_startu_odrzucona(db):
    _klient("k")
    _fv("k")

    e = _blad(_wplac, "k", "fv", 100, data=date(2026, 11, 8))

    assert e.status_code == 400
    assert e.detail == ("Wpłata sprzed daty startu rozliczeń (09.11.2026) "
                        "jest już w saldzie otwarcia")
    assert _ile_wplat() == 0


def test_nadplata_pokrywa_pozniejsza_fakture(rojpak):
    p = _wplac(rojpak["cid"], "fv", 50000)

    assert p["nadwyzka"] == 19961.80
    assert karta(rojpak["cid"], dzis=DZIS)["saldo"]["fv"] == 19961.80

    nowa = _fv(rojpak["cid"], numer="560", kwota=10000)

    assert karta(rojpak["cid"], dzis=DZIS)["saldo"]["fv"] == 9961.80
    assert nowa["stan"]["kod"] == "zaplacony"


def test_wplata_przypieta_do_usunietej_faktury_idzie_na_najstarszy(db):
    _klient("k")
    a = _fv("k", numer="A", kwota=1000)
    b = _fv("k", numer="B", data=date(2026, 11, 10), kwota=500)
    _wplac("k", "fv", 500, dokument_id=b["id"])
    assert _po_numerze(karta("k", dzis=DZIS)["dokumenty"]["fv"], "B")["zostalo"] == 0.0

    usun_dokument(b["id"], "wpisana dwa razy", "biuro")

    k = karta("k", dzis=DZIS)
    assert [d["numer"] for d in k["dokumenty"]["fv"]] == ["A"]
    fa = _po_numerze(k["dokumenty"]["fv"], "A")
    assert fa["id"] == a["id"]
    assert fa["zaplacono"] == 500.0
    assert sum(d["zaplacono"] for d in k["dokumenty"]["fv"]) + max(k["saldo"]["fv"], 0) \
        == sum(w["kwota"] for w in k["wplaty"])


def test_usun_wplate(rojpak):
    p = _wplac(rojpak["cid"], "fv", 15000)

    assert _blad(usun_wplate, p["id"], "  ", "biuro").status_code == 400
    usun_wplate(p["id"], "wpisana na złego klienta", "biuro")

    k = karta(rojpak["cid"], dzis=DZIS)
    assert k["saldo"]["fv"] == -30038.20
    assert p["id"] not in [w["id"] for w in k["wplaty"]]
    h = _historia(p["id"])[-1]
    assert (h["akcja"], h["powod"], h["obiekt"]) == ("usunieto", "wpisana na złego klienta",
                                                     "wplata")
    assert _blad(usun_wplate, "nie-ma", "x", "biuro").status_code == 404


# ── Edycja dokumentów ───────────────────────────────────────────────────

def test_edycja_WZ_z_MES(rojpak):
    wid = _id_wz("w4")

    edytuj_dokument(wid, {"termin": date(2026, 11, 20)}, "biuro")

    row = query_one("SELECT * FROM rozl_dokumenty WHERE id=%s", (wid,))
    assert row["termin"] == date(2026, 11, 20)
    assert row["termin_reczny"] is True
    h = _historia(wid)[-1]
    assert (h["akcja"], h["przed"], h["po"]) == ("termin", {"termin": "2026-11-08"},
                                                 {"termin": "2026-11-20"})
    e = _blad(edytuj_dokument, wid, {"kwota": 1}, "biuro", powod="x")
    assert e.status_code == 400

    synchronizuj_wz()
    assert query_one("SELECT termin FROM rozl_dokumenty WHERE id=%s",
                     (wid,))["termin"] == date(2026, 11, 20)


def test_edycja_faktury_recznej(db):
    _klient("k")
    d = _fv("k", kwota=1000)

    assert _blad(edytuj_dokument, d["id"], {"kwota": 1050}, "biuro").status_code == 400
    assert _blad(edytuj_dokument, d["id"], {"nieznane": 1}, "biuro").status_code == 400
    po = edytuj_dokument(d["id"], {"kwota": 1050, "uwagi": "dopisany transport"}, "biuro",
                         powod="błąd w kwocie")

    assert po["kwota"] == 1050.0
    assert po["uwagi"] == "dopisany transport"
    h = {r["akcja"]: r for r in _historia(d["id"])}
    assert (h["kwota"]["przed"], h["kwota"]["po"], h["kwota"]["powod"]) == (
        {"kwota": 1000.0}, {"kwota": 1050.0}, "błąd w kwocie")
    assert h["uwagi"]["po"] == {"uwagi": "dopisany transport"}
    assert karta("k", dzis=DZIS)["saldo"]["fv"] == -1050.0


def test_edycja_daty_faktury_recznej(db):
    _klient("k")
    d = _fv("k", data=date(2026, 11, 9), termin=date(2026, 11, 20))

    e = _blad(edytuj_dokument, d["id"], {"data": date(2026, 11, 8)}, "biuro")
    assert e.status_code == 400
    assert e.detail == ("Faktura sprzed daty startu rozliczeń (09.11.2026) "
                        "jest już w saldzie otwarcia")
    po = edytuj_dokument(d["id"], {"data": date(2026, 11, 12)}, "biuro")

    assert po["data"] == "2026-11-12"
    h = _historia(d["id"])[-1]
    assert (h["akcja"], h["przed"], h["po"]) == ("zmiana", {"data": "2026-11-09"},
                                                 {"data": "2026-11-12"})


def test_edycja_numeru_na_istniejacy_odrzucona(db):
    _klient("k")
    _fv("k", numer="FV/1")
    d = _fv("k", numer="FV/2")

    assert _blad(edytuj_dokument, d["id"], {"numer": "FV/1"}, "biuro").status_code == 400


# ── Saldo otwarcia ──────────────────────────────────────────────────────

def test_ustaw_otwarcie_dwa_razy(db):
    _klient("k")

    ustaw_otwarcie("k", "fv", kwota=-1000, zalegle_od=date(2026, 10, 20), uwagi="z Excela",
                   kto="biuro")
    ustaw_otwarcie("k", "fv", kwota=-1200, zalegle_od=date(2026, 10, 20), uwagi="z Excela",
                   kto="biuro")

    rows = query_all("SELECT * FROM rozl_otwarcia WHERE client_id='k'")
    assert len(rows) == 1
    assert rows[0]["waluta"] == "PLN"
    h = [r for r in _historia("otwarcie-fv") if r["przed"] == {"kwota": -1000.0}]
    assert len(h) == 1
    assert (h[0]["akcja"], h[0]["po"]) == ("zmiana", {"kwota": -1200.0})
    assert karta("k", dzis=DZIS)["saldo"]["fv"] == -1200.0


def test_otwarcie_zalegle_od_po_starcie_odrzucone(db):
    _klient("k")

    e = _blad(ustaw_otwarcie, "k", "fv", kwota=-10, zalegle_od=date(2026, 11, 10), uwagi="",
              kto="biuro")

    assert e.status_code == 400


# ── Ustawienia kontrahenta ──────────────────────────────────────────────

def test_ustaw_klienta_termin_fv(db):
    _klient("k")
    stara = _fv("k", numer="FV/1")

    ustaw_klienta("k", {"termin_fv": 14, "notatka": "płaci w piątki"}, "biuro")
    nowa = _fv("k", numer="FV/2")

    assert nowa["termin"] == "2026-11-23"
    assert query_one("SELECT termin FROM rozl_dokumenty WHERE id=%s",
                     (stara["id"],))["termin"] == date(2026, 11, 16)
    k = karta("k", dzis=DZIS)["klient"]
    assert (k["termin_fv"], k["notatka"]) == (14, "płaci w piątki")
    h = _historia("k")
    assert sorted((r["obiekt"], r["akcja"], str(r["przed"]), str(r["po"])) for r in h) == [
        ("klient", "zmiana", "{'notatka': ''}", "{'notatka': 'płaci w piątki'}"),
        ("klient", "zmiana", "{'termin_fv': 7}", "{'termin_fv': 14}")]


def test_ustaw_klienta_termin_wz_nie_rusza_istniejacych_WZ(db):
    _klient("k", nazwa="K")
    _wz("w1", "k", buyer_name="K")
    synchronizuj_wz()

    ustaw_klienta("k", {"termin_wz": 5}, "biuro")
    synchronizuj_wz()

    assert query_one("SELECT termin FROM rozl_dokumenty WHERE id=%s",
                     (_id_wz("w1"),))["termin"] == date(2026, 11, 10)


def test_ustaw_klienta_bledne_dane(db):
    _klient("k")

    assert _blad(ustaw_klienta, "k", {"waluta": "USD"}, "biuro").status_code == 400
    assert _blad(ustaw_klienta, "k", {"termin_fv": 366}, "biuro").status_code == 400
    assert _blad(ustaw_klienta, "k", {"forma_wz": "czek"}, "biuro").status_code == 400
    assert _blad(ustaw_klienta, "k", {"nic": 1}, "biuro").status_code == 400
    ustaw_klienta("k", {"waluta": "EUR"}, "biuro")
    assert karta("k", dzis=DZIS)["klient"]["waluta"] == "EUR"


# ── Dziennik ────────────────────────────────────────────────────────────

def test_dziennik_przypomnienie(db):
    _klient("k")
    _fv("k")

    wpis = dodaj_wpis_dziennika("k", "obiecał zapłacić", date(2026, 11, 9), "artur")

    assert wpis["tresc"] == "obiecał zapłacić"
    assert wpis["kto"] == "artur"
    assert lista(dzis=DZIS)["kontrahenci"][0]["przypomnienie"] is True
    odhacz_wpis(wpis["id"], "artur")
    assert lista(dzis=DZIS)["kontrahenci"][0]["przypomnienie"] is False
    assert _blad(dodaj_wpis_dziennika, "k", "  ", None, "artur").status_code == 400
    assert _blad(odhacz_wpis, "nie-ma", "artur").status_code == 404
