"""Arytmetyka rozrachunków — bez bazy, na samych liczbach.

Saldo jest jedyną liczbą w tym module, której biuro nie sprawdzi na oko,
więc musi dać się przetestować na wymyślonych danych, bez stawiania
dokumentów.

ZNAK: ujemne = klient jest nam winien. Tak jest w arkuszu biura
(`SALDO W € = -15649` to dług YBM GASTRO) i zmiana tej konwencji przy
przepisywaniu sald otwarcia byłaby źródłem cichych pomyłek.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.services.rozrachunki_saldo import (dni_po_terminie, po_odcieciu,
                                            policz_saldo, termin_platnosci)


def test_saldo_to_otwarcie_plus_obciazenia_minus_wplaty():
    wynik = policz_saldo(
        {"amount": -1000.0},
        [{"amount": -500.0}, {"amount": -300.0}],
        [{"amount": -700.0}])

    assert wynik["saldo"] == pytest.approx(-1100.0)


def test_brak_salda_otwarcia_to_NIE_jest_zero():
    """Review Focus 2. „Nie skonfigurowano" i „zero" to dwie różne rzeczy —
    ekran ma powiedzieć, że saldo otwarcia trzeba wpisać, a nie pokazać
    0,00 i pozwolić biuru uznać, że klient nic nie jest winien."""
    assert policz_saldo(None, [], [])["skonfigurowane"] is False
    assert policz_saldo({"amount": 0.0}, [], [])["skonfigurowane"] is True


def test_odciecie_pomija_dokumenty_SPRZED_daty():
    """REGUŁA NADRZĘDNA modułu. Bez niej 177 historycznych WZ doliczyłoby
    się NA WIERZCHU salda otwarcia, a błąd byłby cichy."""
    poz = [{"doc_date": date(2026, 8, 31), "amount": -100.0},
           {"doc_date": date(2026, 9, 30), "amount": -200.0}]

    assert [p["amount"] for p in po_odcieciu(poz, date(2026, 9, 1), "doc_date")] \
        == [-200.0]


def test_dokument_Z_DATA_ODCIECIA_sie_NIE_liczy():
    """Review Focus 1. Odcięcie zamknięte od dołu: saldo „na dzień 1.09"
    zawiera wszystko do 1.09 włącznie."""
    poz = [{"doc_date": date(2026, 9, 1), "amount": -100.0}]

    assert po_odcieciu(poz, date(2026, 9, 1), "doc_date") == []


def test_bez_daty_odciecia_biora_sie_wszystkie():
    """Klient bez salda otwarcia — nie ukrywamy dokumentów, bo wtedy ekran
    pokazywałby pustą kartę i nikt by nie wiedział, że czegoś brakuje."""
    poz = [{"doc_date": date(2020, 1, 1), "amount": -100.0}]

    assert len(po_odcieciu(poz, None, "doc_date")) == 1


def test_termin_faktury_to_14_dni_od_dostawy():
    assert termin_platnosci(date(2026, 9, 10), "invoice",
                            {"invoice": 14, "wz": 1}) == date(2026, 9, 24)


def test_termin_WZ_to_jeden_dzien():
    """Towar wyjeżdża dzień wcześniej, więc „przy odbiorze" to +1, nie 0."""
    assert termin_platnosci(date(2026, 9, 10), "wz",
                            {"invoice": 14, "wz": 1}) == date(2026, 9, 11)


def test_nieznany_rodzaj_ma_termin_natychmiastowy():
    """Lepiej pokazać pozycję jako wymagalną od razu niż zgubić ją w saldzie
    przez brak wpisu w słowniku terminów."""
    assert termin_platnosci(date(2026, 9, 10), "cos-nowego",
                            {"invoice": 14, "wz": 1}) == date(2026, 9, 10)


def test_dni_po_terminie_liczone_na_dzien_wydruku():
    assert dni_po_terminie(date(2026, 9, 11), date(2026, 9, 20)) == 9


def test_przed_terminem_zero_a_nie_liczba_ujemna():
    """Na papierze dla klienta „-5 dni po terminie" nie znaczy nic."""
    assert dni_po_terminie(date(2026, 9, 30), date(2026, 9, 20)) == 0


def test_puste_listy_daja_saldo_z_samego_otwarcia():
    assert policz_saldo({"amount": -250.0}, [], [])["saldo"] == pytest.approx(-250.0)


def test_nadplata_daje_saldo_DODATNIE():
    """Klient zapłacił więcej, niż był winien — to zaliczka, nie błąd."""
    assert policz_saldo({"amount": -100.0}, [], [{"amount": -250.0}])["saldo"] \
        == pytest.approx(150.0)
