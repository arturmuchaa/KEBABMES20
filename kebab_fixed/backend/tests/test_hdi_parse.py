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


# --- pułapki znalezione na 11 prawdziwych skanach (2026-08-12) --------------
def test_smiec_przed_waga_nie_wchodzi_jako_tysiace():
    """OCR dokleja do kolumny znaki z sąsiedztwa: „hS4 600,00".

    Spacja w liczbie to u nas separator tysięcy, więc bez zastrzeżenia
    „nie zaczynaj tuż za literą" 600 kg zamieniało się w 4600 kg — cicho
    i wiarygodnie. To najgorszy możliwy rodzaj błędu w traceability.
    """
    out = parse_hdi_text(
        "| 2 ĆWIARTKA Z KURCZAKA KL. A SCHŁODZONA hS4 600,00 112730 2026-07-29 2026-08-05")
    assert [l["kg"] for l in out["lines"]] == [600.0]


def test_prawdziwy_separator_tysiecy_dziala_dalej():
    """Warunek nie może zepsuć wag, które NAPRAWDĘ mają tysiące."""
    out = parse_hdi_text("1 800,00 112822 2026-08-10 2026-08-17")
    assert [l["kg"] for l in out["lines"]] == [1800.0]


def test_podkreslniki_tabeli_nie_blokuja_wagi():
    """OCR rysuje podkreślnikami linie tabeli („____600,00") — to nie litera."""
    out = parse_hdi_text("____600,00 112819 2026-08-10 2026-08-17")
    assert [l["kg"] for l in out["lines"]] == [600.0]


def test_data_bez_drugiego_mysnika():
    """OCR gubi myślnik: „2026-0810". Wiersz i tak musi wejść, a data
    ma wyjść znormalizowana — inaczej trafi do bazy w dwóch formatach."""
    out = parse_hdi_text("1050,00 112761 2026-08-03 2026-0810")
    assert len(out["lines"]) == 1
    assert out["lines"][0]["expiry_date"] == "2026-08-10"


def test_smiec_i_waga_nie_sklejaja_sie_w_miliony():
    """„464 1200,00" (śmieć OCR + prawdziwa waga) dawało 4 641 200 kg.

    Prawdziwy separator tysięcy grupuje cyfry PO TRZY — bez tego warunku
    każda spacja sklejała sąsiednie liczby w jedną.
    """
    out = parse_hdi_text("| 3 ĆWIARTKA 464 1200,00 112725 2026-07-29 2026-08-05")
    assert [l["kg"] for l in out["lines"]] == [1200.0]


def test_wagi_czterocyfrowe_bez_separatora_dzialaja():
    """„2400,00" nie ma separatora i musi przejść — wymuszenie grupowania
    po trzy nie może odciąć zwykłych czterocyfrowych wag."""
    out = parse_hdi_text("2400,00 112831 2026-08-11 2026-08-18")
    assert [l["kg"] for l in out["lines"]] == [2400.0]
