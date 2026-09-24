"""Rozliczenie dostawy — kartka, którą właściciel wypisuje dziś długopisem.

Wzorzec ze zdjęcia z 24.09.2026 (TRUVA):

    KIRMIZI         30×25kg=750 + 80×20kg=1600 + 60×15kg=900
                    = 3250 kg × 3,20 € = 10 400 €
    KIRMIZI/FILET   30×30kg=900 + 60×25kg=1500 + 40×20kg=800
                    = 3200 kg × 3,40 € = 10 880 €
    BEYAZ           60×30kg=1800        = 1800 kg × 3,20 € =  5 760 €
                                          za dostawę        27 040 €
                                        + BORÇLAR           37 000 €
                                          RAZEM             64 040 €

Kartka opisuje CAŁĄ dostawę (8250 kg), także część, która poszła na fakturę
(3200 kg) — nie jest więc wydrukiem dokumentu WZ, który opisuje 5050 kg.

Czysta funkcja — bez bazy.
"""
from __future__ import annotations

import pytest

from app.services.rozliczenie_dostawy import grupy_dostawy, podsumowanie_dostawy


def _l(name, qty, kg_per_unit):
    return {"name": name, "qty": qty, "kg_per_unit": kg_per_unit,
            "total_kg": qty * kg_per_unit}


LINIE_TRUVA = [
    _l("KIRMIZI", 30, 25.0), _l("KIRMIZI", 80, 20.0), _l("KIRMIZI", 60, 15.0),
    _l("KIRMIZI/FILET", 30, 30.0), _l("KIRMIZI/FILET", 60, 25.0),
    _l("KIRMIZI/FILET", 40, 20.0),
    _l("BEYAZ", 60, 30.0),
]


def test_grupuje_po_nazwie_i_zachowuje_ROZBICIE_na_gramatury():
    """Klient sprawdza dostawę po pojemnikach, nie po kilogramach — samo
    „3250 kg" bez rozbicia byłoby krokiem wstecz wobec kartki."""
    grupy = grupy_dostawy(LINIE_TRUVA)

    assert [g["nazwa"] for g in grupy] == ["KIRMIZI", "KIRMIZI/FILET", "BEYAZ"]
    assert [(p["qty"], p["kg_per_unit"], p["kg"]) for p in grupy[0]["pozycje"]] == [
        (30, 25.0, 750.0), (80, 20.0, 1600.0), (60, 15.0, 900.0)]


def test_kilogramy_grupy_zgadzaja_sie_z_kartka():
    grupy = grupy_dostawy(LINIE_TRUVA)

    assert [g["kg"] for g in grupy] == [3250.0, 3200.0, 1800.0]


def test_ta_sama_gramatura_dwa_razy_sumuje_sie_w_jedna_linie():
    """Towar z dwóch partii schodzi na dwóch wierszach dokumentu, ale dla
    klienta to jedna pozycja: „40 × 25 kg"."""
    grupy = grupy_dostawy([_l("KIRMIZI", 30, 25.0), _l("KIRMIZI", 10, 25.0)])

    assert [(p["qty"], p["kg"]) for p in grupy[0]["pozycje"]] == [(40, 1000.0)]


def test_wartosc_grupy_to_kilogramy_razy_cena():
    """Cena jest PER GRUPA (na kartce 3,20 / 3,40 / 3,20), nie jedna na
    dokument."""
    wynik = podsumowanie_dostawy(
        LINIE_TRUVA,
        {"KIRMIZI": 3.20, "KIRMIZI/FILET": 3.40, "BEYAZ": 3.20},
        saldo_przed=-37000.0)

    assert [g["wartosc"] for g in wynik["grupy"]] == [10400.0, 10880.0, 5760.0]


def test_suma_dostawy_i_RAZEM_zgadzaja_sie_z_kartka():
    wynik = podsumowanie_dostawy(
        LINIE_TRUVA,
        {"KIRMIZI": 3.20, "KIRMIZI/FILET": 3.40, "BEYAZ": 3.20},
        saldo_przed=-37000.0)

    assert wynik["kg_razem"] == 8250.0
    assert wynik["za_dostawe"] == pytest.approx(27040.0)
    assert wynik["razem"] == pytest.approx(-64040.0)


def test_brak_ceny_grupy_nie_wywraca_wydruku():
    """Biuro wpisuje ceny na formularzu; zanim to zrobi, kilogramy mają się
    liczyć, a wartość zostaje zerem zamiast NaN."""
    wynik = podsumowanie_dostawy(LINIE_TRUVA, {}, saldo_przed=0.0)

    assert wynik["kg_razem"] == 8250.0
    assert wynik["za_dostawe"] == 0.0


def test_pusta_dostawa_nie_wywraca_sie():
    wynik = podsumowanie_dostawy([], {}, saldo_przed=-100.0)

    assert wynik["grupy"] == []
    assert wynik["razem"] == pytest.approx(-100.0)
