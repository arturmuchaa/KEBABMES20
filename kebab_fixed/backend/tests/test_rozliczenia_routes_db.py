"""Trasy rozliczeń — kontrakt HTTP (wołanie funkcji tras wprost).

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.routes import rozliczenia as route
from tests.test_rozliczenia_odczyt_db import przywroc_start  # noqa: F401
from tests.test_rozliczenia_wz_db import _wz

KTO = SimpleNamespace(state=SimpleNamespace(subject={"username": "ala"}))


def _klient(cid="c1", nazwa="YALCIN"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES (%s,%s,%s,true)", (cid, cid.upper(), nazwa))


def test_faktura_z_kwota_tekstowa_z_przecinkiem(db, przywroc_start):
    _klient()

    route.dodaj_fakture("c1", {"numer": "FV 1/11", "data": "2026-11-10",
                               "kwota": "1 234,56"}, KTO)

    row = query_one("SELECT kwota FROM rozl_dokumenty WHERE numer='FV 1/11'")
    assert float(row["kwota"]) == 1234.56


def test_kwota_z_twarda_spacja_i_bledna():
    assert route._kwota("15 000,50") == 15000.50
    assert route._kwota(12) == 12
    with pytest.raises(HTTPException) as e:
        route._kwota("abc")
    assert e.value.status_code == 400 and e.value.detail == "Nieprawidłowa kwota"


def test_zla_data_to_400(db, przywroc_start):
    _klient()

    with pytest.raises(HTTPException) as e:
        route.dodaj_fakture("c1", {"numer": "FV 2", "data": "10.11.2026",
                                   "kwota": 10}, KTO)

    assert e.value.status_code == 400 and e.value.detail == "Nieprawidłowa data"


def test_na_wz_dla_wm_to_404(db, przywroc_start):
    _wz("wm1", None, numer="WM 1/11", seria="WM", buyer_name="ROJPAK")

    with pytest.raises(HTTPException) as e:
        route.na_wz("wm1")

    assert e.value.status_code == 404


def test_ustawienia_start_round_trip(db, przywroc_start):
    route.ustaw_ustawienia({"start": "2026-11-12"}, KTO)

    assert route.ustawienia() == {"start": "2026-11-12"}


def test_lista_i_karta(db, przywroc_start):
    _klient()

    assert route.karta("c1")["klient"]["id"] == "c1"
    assert route.lista() is not None


@pytest.fixture
def pdf_stub(monkeypatch):
    wolane = []
    monkeypatch.setattr(route, "render_url_to_pdf",
                        lambda url: wolane.append(url) or b"%PDF-1.4")
    return wolane


def test_pdf_zestawienia(db, przywroc_start, pdf_stub):
    _klient()

    r = route.zestawienie_pdf("c1", na_dzien="2026-11-10")

    assert r.media_type == "application/pdf" and r.body == b"%PDF-1.4"
    assert "/office/rozliczenia/c1/zestawienie/druk?pdf=1" in pdf_stub[0]
    assert "na_dzien=2026-11-10" in pdf_stub[0]
    assert "SALDO_YALCIN_2026-11-10.pdf" in r.headers["content-disposition"]


def test_pdf_historii(db, przywroc_start, pdf_stub):
    _klient()

    r = route.historia_pdf("c1", od="2026-11-01", do="2026-11-10")

    assert "/office/rozliczenia/c1/historia/druk?pdf=1&od=2026-11-01&do=2026-11-10" in pdf_stub[0]
    assert "ROZLICZENIA_YALCIN_" in r.headers["content-disposition"]


def test_kwota_waski_nbsp_i_nieskonczone():
    assert route._kwota("15\u202f000,50") == 15000.50
    for zla in ("nan", "inf", "-inf", float("nan"), float("inf")):
        with pytest.raises(HTTPException) as e:
            route._kwota(zla)
        assert e.value.status_code == 400 and e.value.detail == "Nieprawidłowa kwota"
