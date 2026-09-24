"""Zapis rozrachunków: saldo otwarcia, faktury, wpłaty.

ZNAK NAKŁADA SERWIS: biuro wpisuje „2000", bo tyle jest do zapłaty,
a w saldzie obciążenie jest ujemne. Gdyby znak wpisywał człowiek, prędzej
czy później ktoś wpisałby go odwrotnie i saldo pokazałoby nadpłatę
zamiast długu.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.rozrachunki_service import (dodaj_fakture, dodaj_wplate,
                                              karta_klienta, ustaw_otwarcie,
                                              usun_pozycje)


def _klient(cid="c1", waluta="PLN"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled, "
            " settlement_currency) VALUES (%s,%s,'YALCIN',true,%s)",
            (cid, cid.upper(), waluta))
    return cid


def test_saldo_otwarcia_zapisuje_sie_w_walucie_klienta(db):
    """Waluta bierze się z KARTOTEKI, nie z formularza: dwa miejsca na tę
    samą decyzję to dwa miejsca, w których da się ją ustawić inaczej."""
    _klient(waluta="EUR")

    ustaw_otwarcie("c1", -15649.0, date(2026, 9, 1), note="z arkusza")

    row = query_one("SELECT amount, currency, as_of_date FROM client_opening_balances "
                    "WHERE client_id='c1'")
    assert float(row["amount"]) == -15649.0
    assert row["currency"] == "EUR"
    assert row["as_of_date"] == date(2026, 9, 1)


def test_ponowne_ustawienie_NADPISUJE_a_nie_dubluje(db):
    """Biuro poprawia przepisaną z arkusza kwotę — ma wyjść jedno saldo
    otwarcia, nie dwa sumujące się."""
    _klient()
    ustaw_otwarcie("c1", -1000.0, date(2026, 9, 1))
    ustaw_otwarcie("c1", -1200.0, date(2026, 9, 1))

    assert float(query_one("SELECT amount FROM client_opening_balances "
                           "WHERE client_id='c1'")["amount"]) == -1200.0


def test_faktura_zapisuje_sie_jako_obciazenie_ujemne(db):
    _klient()
    ustaw_otwarcie("c1", 0.0, date(2026, 9, 1))

    dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 15), 2000.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == -2000.0


def test_DRUGA_faktura_o_tym_samym_numerze_odmawia(db):
    """Biuro wpisuje numery ręcznie — „wpisałem dwa razy" ma odbić się
    o bazę, nie o czyjeś oko."""
    _klient()
    dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 15), 2000.0)

    with pytest.raises(HTTPException) as e:
        dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 16), 300.0)
    assert e.value.status_code == 409


def test_ten_sam_numer_u_INNEGO_kontrahenta_przechodzi(db):
    """Numeracja faktur jest wspólna dla firmy, ale rozrachunki prowadzi się
    per kontrahent — blokada ma dotyczyć jednej karty, nie całej bazy."""
    _klient("c1"); _klient("c2")
    dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 15), 2000.0)

    dodaj_fakture("c2", "FS 12/09/2026", date(2026, 9, 15), 500.0)

    assert len(karta_klienta("c2")["obciazenia"]) == 1


def test_faktura_bez_numeru_odmawia(db):
    _klient()

    with pytest.raises(HTTPException) as e:
        dodaj_fakture("c1", "  ", date(2026, 9, 15), 2000.0)
    assert e.value.status_code == 400


def test_wplata_zmniejsza_dlug(db):
    _klient()
    ustaw_otwarcie("c1", -1000.0, date(2026, 9, 1))

    dodaj_wplate("c1", date(2026, 9, 20), 400.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == -600.0


def test_NADPLATA_daje_saldo_dodatnie(db):
    """Klient zapłacił więcej, niż był winien — to zaliczka, nie błąd."""
    _klient()
    ustaw_otwarcie("c1", -100.0, date(2026, 9, 1))

    dodaj_wplate("c1", date(2026, 9, 20), 250.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == 150.0


def test_usuniecie_wplaty_przywraca_saldo(db):
    _klient()
    ustaw_otwarcie("c1", -1000.0, date(2026, 9, 1))
    wplata = dodaj_wplate("c1", date(2026, 9, 20), 400.0)

    usun_pozycje("payment", wplata["id"])

    assert karta_klienta("c1")["saldo"]["saldo"] == -1000.0


def test_usuniecie_nieznanego_rodzaju_odmawia(db):
    """Obciążeń z WZ nie da się usunąć tą drogą — znikają, gdy zniknie albo
    zostanie anulowany sam dokument."""
    _klient()

    with pytest.raises(HTTPException) as e:
        usun_pozycje("wz", "cokolwiek")
    assert e.value.status_code == 400


# ─── I11 z recenzji: znak salda otwarcia ────────────────────────────────
#
# Kodeks modułu, powtórzony w trzech docstringach: „ZNAK NAKŁADA SERWIS —
# gdyby znak wpisywał człowiek, prędzej czy później ktoś wpisałby go
# odwrotnie". Przy saldzie otwarcia — JEDYNEJ kwocie przepisywanej ręcznie
# z arkusza — zasada nie była zastosowana.

def test_saldo_otwarcia_domyslnie_jest_DLUGIEM(db):
    """Biuro przepisuje z kolumny `SALDO W €` wartość 15649 i ma dostać dług
    15 649 €, a nie nadpłatę. Wpisanie „-15649" ma dać to samo — znak
    nakłada serwis, tak jak przy fakturach i wpłatach."""
    _klient()

    ustaw_otwarcie("c1", 15649.0, date(2026, 9, 1))

    assert karta_klienta("c1")["saldo"]["saldo"] == -15649.0


def test_wpisanie_ze_znakiem_daje_TO_SAMO(db):
    _klient()

    ustaw_otwarcie("c1", -15649.0, date(2026, 9, 1))

    assert karta_klienta("c1")["saldo"]["saldo"] == -15649.0


def test_NADPLATE_trzeba_zaznaczyc_swiadomie(db):
    """Zaliczka zdarza się rzadko, więc jest osobną decyzją, a nie skutkiem
    wpisania liczby bez minusa."""
    _klient()

    ustaw_otwarcie("c1", 5000.0, date(2026, 9, 1), nadplata=True)

    assert karta_klienta("c1")["saldo"]["saldo"] == 5000.0
