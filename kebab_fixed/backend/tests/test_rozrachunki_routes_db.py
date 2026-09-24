"""Trasy rozrachunków — kontrakt HTTP.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from app.db import execute
from app.routes import rozrachunki as route


def _klient(cid="c1", nazwa="YALCIN"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES (%s,%s,%s,true)", (cid, cid.upper(), nazwa))


def test_karta_oddaje_saldo_i_walute(db):
    _klient()
    route.ustaw_otwarcie_klienta("c1", {"amount": -1000, "as_of_date": "2026-09-01"})

    karta = route.karta("c1")

    assert karta["waluta"] == "PLN"
    assert karta["saldo"]["saldo"] == -1000.0


def test_zestawienie_oddaje_liste(db):
    _klient()

    assert [z["clientId"] for z in route.lista()] == ["c1"]


def test_dodanie_faktury_przez_trase(db):
    _klient()
    route.ustaw_otwarcie_klienta("c1", {"amount": 0, "as_of_date": "2026-09-01"})

    route.faktura("c1", {"number": "FS 1/2026", "doc_date": "2026-09-15",
                         "amount": 500})

    assert route.karta("c1")["saldo"]["saldo"] == -500.0


def test_dodanie_wplaty_przez_trase(db):
    _klient()
    route.ustaw_otwarcie_klienta("c1", {"amount": -900, "as_of_date": "2026-09-01"})

    route.wplata("c1", {"paid_date": "2026-09-20", "amount": 400})

    assert route.karta("c1")["saldo"]["saldo"] == -500.0


def test_brak_daty_w_ciele_bierze_dzis(db):
    """Formularz bywa wysłany bez daty — lepiej zapisać dzisiejszą niż
    wywrócić żądanie na `None`."""
    _klient()

    route.ustaw_otwarcie_klienta("c1", {"amount": -100})

    assert route.karta("c1")["saldo"]["skonfigurowane"] is True
