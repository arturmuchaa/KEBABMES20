"""Odczyt HDI dostawcy z tekstu po OCR.

Fixture `hdi_koko_33656.txt` to PRAWDZIWE wyjście tesseractu ze skanu HDI
33656 (KOKO, 11.08.2026) — ze wszystkimi śmieciami, jakie OCR produkuje:
podkreślnikami zamiast spacji, kropką zamiast przecinka, cudzysłowem przed
liczbą, urwanym numerem pozycji w ostatnim wierszu. Testy celowo NIE używają
tekstu wyczyszczonego ręcznie: parser ma sobie radzić z tym, co dostanie.
"""
from pathlib import Path

import pytest

from app.services.hdi_parse import parse_hdi_text

FIXTURE = Path(__file__).parent / "fixtures" / "hdi_koko_33656.txt"


@pytest.fixture
def hdi():
    return parse_hdi_text(FIXTURE.read_text(encoding="utf-8"))


# --- nagłówek --------------------------------------------------------------
def test_czyta_numer_hdi_i_dokument_handlowy(hdi):
    assert hdi["hdi_no"] == "33656"
    assert hdi["document_no"] == "WZ 388/MDU/08/2026"


def test_czyta_date_wysylki(hdi):
    assert hdi["shipped_date"] == "2026-08-11"


# --- pozycje ---------------------------------------------------------------
def test_czyta_wszystkie_osiem_pozycji(hdi):
    assert len(hdi["lines"]) == 8


def test_numery_partii_dostawcy_bez_pomylek(hdi):
    assert [l["supplier_batch_no"] for l in hdi["lines"]] == [
        "112819", "112820", "112821", "112822",
        "112823", "112824", "112827", "112828",
    ]


def test_wagi_mimo_smieci_ocr(hdi):
    # „____600,00" (podkreślniki), „1800.00" (kropka), „\"1005,00" (cudzysłów)
    assert [l["kg"] for l in hdi["lines"]] == [
        600.0, 600.0, 435.0, 1800.0, 1800.0, 600.0, 1005.0, 2160.0]


def test_daty_per_pozycja(hdi):
    first, last = hdi["lines"][0], hdi["lines"][-1]
    assert (first["slaughter_date"], first["expiry_date"]) == ("2026-08-10", "2026-08-17")
    # Ostatnia pozycja ma INNE daty — parser nie może kopiować pierwszego wiersza.
    assert (last["slaughter_date"], last["expiry_date"]) == ("2026-08-11", "2026-08-18")


def test_wiersz_z_urwanym_numerem_pozycji_też_wchodzi(hdi):
    """Ostatni wiersz OCR przeczytał jako „(  „WIARTKA…" — numer pozycji
    i pierwsza litera nazwy poszły. Dane są całe, więc wiersz MUSI wejść:
    parser nie ma prawa opierać się na Lp ani na nazwie towaru."""
    assert hdi["lines"][-1]["supplier_batch_no"] == "112828"
    assert hdi["lines"][-1]["kg"] == 2160.0


# --- stopka (sumy kontrolne) ----------------------------------------------
def test_czyta_sumy_ze_stopki(hdi):
    # „Ilość pojemników: 600, llość palet: 16, Masa netto: 9 000,00"
    # — OCR pomylił I na l w „Ilość", więc parser szuka rdzenia słowa.
    assert hdi["total_kg"] == 9000.0
    assert hdi["containers"] == 600
    assert hdi["pallets"] == 16


def test_suma_pozycji_zgadza_sie_ze_stopka(hdi):
    """Najważniejsza kontrola całego odczytu: jeśli OCR zgubi albo zdubluje
    wiersz, sumy się rozjadą i formularz to pokaże."""
    assert sum(l["kg"] for l in hdi["lines"]) == hdi["total_kg"]


# --- odporność -------------------------------------------------------------
def test_pusty_tekst_nie_wywala_sie(hdi):
    out = parse_hdi_text("")
    assert out["lines"] == []
    assert out["hdi_no"] == ""
    assert out["total_kg"] is None


def test_ignoruje_liczby_ktore_nie_sa_pozycja_tabeli():
    """Sam numer weterynaryjny czy NIP nie może udawać wiersza — wiersz to
    dopiero waga + numer partii + DWIE daty."""
    out = parse_hdi_text(
        "Weterynaryjny numer identyfikacyjny zakładu: PL 12033904 WE\n"
        "NIP: 5130279931\nREGON 622652974\n")
    assert out["lines"] == []
