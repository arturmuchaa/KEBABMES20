"""Schemat rozrachunków z odbiorcami.

Domyślnie rozliczenie jest WYŁĄCZONE: właściciel prowadzi rozliczenia dla
części kontrahentów (27 zakładek w arkuszu), a w kartotece jest ich więcej.
Włączenie wszystkim naraz zrobiłoby z ekranu listę, której nikt nie czyta.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services import clients_service


def test_nowy_klient_ma_rozliczenie_wylaczone(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c9','C9','TEST')")

    row = query_one("SELECT settlement_enabled, settlement_currency "
                    "FROM clients WHERE id='c9'")

    assert row["settlement_enabled"] is False
    assert row["settlement_currency"] == "PLN"


def test_tabele_rozrachunkow_istnieja(db):
    for t in ("client_opening_balances", "client_charges", "client_payments"):
        assert query_one(
            "SELECT 1 AS x FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name=%s", (t,)) is not None, t


def test_zmiana_waluty_przy_NIEZEROWYM_saldzie_odmawia(db):
    """Review Focus 4. Zamiana 'PLN' na 'EUR' nie przelicza kwot — zrobiłaby
    z długu 15 649 zł dług 15 649 €, a liczba wyglądałaby tak samo sensownie
    jak przedtem. Odmawiamy i każemy to rozstrzygnąć świadomie."""
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES ('c1','C1','YALCIN',true)")
    execute("INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date) "
            "VALUES ('c1',-15649,'PLN','2026-09-01')")

    with pytest.raises(HTTPException) as e:
        clients_service.ustaw_rozliczenie("c1", enabled=True, currency="EUR")
    assert e.value.status_code == 409


def test_zmiana_waluty_przy_ZEROWYM_saldzie_przechodzi(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','C1','YALCIN')")

    clients_service.ustaw_rozliczenie("c1", enabled=True, currency="EUR")

    assert query_one("SELECT settlement_currency, settlement_enabled "
                     "FROM clients WHERE id='c1'")["settlement_currency"] == "EUR"


def test_nieznana_waluta_odmawia(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','C1','YALCIN')")

    with pytest.raises(HTTPException) as e:
        clients_service.ustaw_rozliczenie("c1", enabled=True, currency="USD")
    assert e.value.status_code == 400


# ─── I7 z recenzji: PUT nie moze kasowac pol, ktorych nie wyslano ───────

def test_zmiana_waluty_NIE_kasuje_podstawy_rozliczenia(db):
    """Trasa ma semantykę PUT-a, a klient API wysyłał tylko `{enabled,
    currency}`. Każde użycie resetowało `settlement_basis` do 'both',
    kasując ustawienie zrobione dla konkretnego kontrahenta."""
    execute("INSERT INTO clients (id, code, name, settlement_basis) "
            "VALUES ('c1','C1','TRUVA','wz')")

    clients_service.ustaw_rozliczenie("c1", enabled=True, currency="EUR")

    assert query_one("SELECT settlement_basis FROM clients WHERE id='c1'"
                     )["settlement_basis"] == "wz"


def test_podstawe_da_sie_zmienic_swiadomie(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','C1','TRUVA')")

    clients_service.ustaw_rozliczenie("c1", enabled=True, currency="PLN", basis="wz")

    assert query_one("SELECT settlement_basis FROM clients WHERE id='c1'"
                     )["settlement_basis"] == "wz"
