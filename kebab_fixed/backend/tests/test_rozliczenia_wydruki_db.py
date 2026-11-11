"""Rozliczenia — dane wydruków: zestawienie na dzień i historia za okres (scenariusz ROJPAK)."""
from __future__ import annotations

from datetime import date

import pytest

from app.services.rozliczenia_service import (historia_okresu, karta, zestawienie,
                                              zestawienie_dla_wz)
from tests.test_rozliczenia_odczyt_db import (DZIS, _faktura, _id_wz, _klient, _otwarcie,  # noqa: F401
                                              _poz, _wplata, przywroc_start, rojpak)
from tests.test_rozliczenia_wz_db import _wz


def test_zestawienie_ROJPAK(rojpak):
    z = zestawienie(rojpak["cid"], DZIS)

    assert z["waluta"] == "EUR" and z["na_dzien"] == "2026-11-09"
    assert z["klient"]["nazwa"] == "ROJPAK" and z["klient"]["nip"] == "DE123456789"
    assert [(p["numer"], p["pozostalo"], p["dni_po_terminie"]) for p in z["wz"]["pozycje"]] == [
        ("WZ 21/10", 3120.00, 13), ("WZ 02/11", 5289.50, 6)]
    assert z["wz"]["razem"] == 8409.50
    assert [p["numer"] for p in z["fv"]["pozycje"]] == ["528", "541", "553"]
    assert [p["dni_po_terminie"] for p in z["fv"]["pozycje"]] == [6, 0, 0]
    assert z["fv"]["razem"] == 30038.20
    assert z["razem"] == 38447.70
    assert z["po_terminie"] == 15689.50
    assert z["nadplata_wz"] == 0.0 and z["nadplata_fv"] == 0.0
    assert all(not p["ten_dokument"] for p in z["wz"]["pozycje"])


def test_zestawienie_na_wczesniejszy_dzien(rojpak):
    z = zestawienie(rojpak["cid"], date(2026, 10, 28))

    assert [(p["numer"], p["pozostalo"]) for p in z["fv"]["pozycje"]] == [("528", 14280.00)]


def test_zestawienie_dla_wz_oznacza_pozycje_a_WM_to_None(rojpak):
    _otwarcie(rojpak["cid"], "wz", 0, waluta="EUR")  # rozliczenia otwarte
    z = zestawienie_dla_wz("w3")
    assert [p["numer"] for p in z["wz"]["pozycje"] if p["ten_dokument"]] == ["WZ 02/11"]

    _wz("wm1", None, numer="WM 1/11", seria="WM", buyer_name="ROJPAK")
    assert zestawienie_dla_wz("wm1") is None
    _wz("bez", None, numer="WZ 9/11", buyer_name="NIKT")
    assert zestawienie_dla_wz("bez") is None


def test_zestawienie_dla_wz_sprzed_startu_to_None(rojpak):
    _wz("stara", rojpak["cid"], numer="WZ 1/09", release_date="2026-09-15",
        lines=_poz(100), buyer_name="ROJPAK", currency="EUR")
    assert zestawienie_dla_wz("stara") is None


def test_zestawienie_rozliczony_i_nadplata(db):
    _klient("roz")
    fid = _faktura("roz", "FV/1", date(2026, 11, 9), 1000, waluta="PLN")
    _wplata("roz", "fv", 1000, date(2026, 11, 9), dokument_id=fid, waluta="PLN")
    _wplata("roz", "wz", 350, date(2026, 11, 9), waluta="PLN", forma="gotowka")

    z = zestawienie("roz", DZIS)

    assert z["razem"] == 0.0 and z["wz"]["pozycje"] == [] and z["fv"]["pozycje"] == []
    assert z["nadplata_wz"] == 350.0


def test_historia_okresu_ROJPAK(rojpak):
    h = historia_okresu(rojpak["cid"], date(2026, 11, 1), DZIS)

    assert h["fv"]["saldo_poczatek"] == -7280.00
    assert [(w["opis"], w["rodzaj"], w["obciazenie"], w["saldo"]) for w in h["fv"]["wiersze"]] == [
        ("541", "dokument", 12342.20, -19622.20), ("553", "dokument", 10416.00, -30038.20)]
    assert h["fv"]["saldo_koniec"] == -30038.20
    # Po terminie liczone na koniec okresu (09.11): FV 541 ma termin 10.11.
    assert [(w["opis"], w["dni_po_terminie"]) for w in h["fv"]["wiersze"]] == [
        ("541", 0), ("553", 0)]
    wz = {w["opis"]: w["dni_po_terminie"] for w in h["wz"]["wiersze"] if w["rodzaj"] == "dokument"}
    assert wz["WZ 02/11"] == 6
    assert wz["WZ 05/11"] == 0  # zapłacona w całości
    assert all(w["dni_po_terminie"] == 0 for w in h["wz"]["wiersze"] if w["rodzaj"] == "wplata")
    assert h["saldo_koniec"] == -38447.70
    assert h["saldo_poczatek"] == h["wz"]["saldo_poczatek"] + h["fv"]["saldo_poczatek"]
    assert h["saldo_koniec"] == karta(rojpak["cid"], dzis=DZIS)["saldo"]["lacznie"]
    assert h["wz"]["wiersze"][-1]["saldo"] == h["wz"]["saldo_koniec"]


def test_historia_wplaty_kolejnosc_i_opis(rojpak):
    h = historia_okresu(rojpak["cid"], date(2026, 10, 18), date(2026, 10, 30))

    wz = h["wz"]["wiersze"]
    assert [(w["data"], w["rodzaj"]) for w in wz[:2]] == [("2026-10-18", "dokument"),
                                                          ("2026-10-18", "wplata")]
    assert wz[1]["opis"] == "Wpłata gotówką" and wz[1]["wplata"] == 7425.0
    fv = h["fv"]["wiersze"]
    assert [(w["opis"], w["saldo"]) for w in fv] == [
        ("512", -17325.00), ("Wpłata przelewem", 0.0), ("528", -14280.00),
        ("Wpłata przelewem", -7280.00)]
    assert h["fv"]["saldo_poczatek"] == 0.0
    assert fv[-1]["saldo"] == h["fv"]["saldo_koniec"]
