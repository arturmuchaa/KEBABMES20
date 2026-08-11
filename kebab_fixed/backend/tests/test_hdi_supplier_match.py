"""Rozpoznanie dostawcy z HDI — po NIP, numerze weterynaryjnym albo nazwie.

Realia z pierwszego skanu (HDI 33656): pieczątkę z NIP-em przecina odręczny
podpis i OCR czyta „5180279931" zamiast „5130279931" — JEDNA cyfra. Dlatego
NIP wchodzi w grę wyłącznie po sprawdzeniu sumy kontrolnej; inaczej system
przypisałby dostawę do przypadkowego kontrahenta albo do żadnego, nie mówiąc
czemu.
"""
from pathlib import Path

from app.services.hdi_parse import match_supplier, nip_checksum_ok, parse_hdi_text

FIXTURE = Path(__file__).parent / "fixtures" / "hdi_koko_33656.txt"

#: Kontrahenci jak na produkcji (numery weterynaryjne u nas puste).
DOSTAWCY = [
    {"id": "koko", "name": "KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
     "display_name": "KOKO", "nip": "5130279931", "vet_number": ""},
    {"id": "farmex", "name": '"FARMEX" SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
     "display_name": "FARMEX", "nip": "7732408632", "vet_number": ""},
    {"id": "psinwest", "name": "PS INWEST PLUS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
     "display_name": "SZUMERA", "nip": "6372228843", "vet_number": ""},
]


# --- suma kontrolna NIP ----------------------------------------------------
def test_poprawny_nip_przechodzi():
    assert nip_checksum_ok("5130279931") is True
    assert nip_checksum_ok("513-027-99-31") is True


def test_nip_zle_odczytany_przez_ocr_odpada():
    """Dokładnie ten błąd, który OCR popełnia na skanie 33656."""
    assert nip_checksum_ok("5180279931") is False


def test_nip_o_zlej_dlugosci_odpada():
    assert nip_checksum_ok("51302799") is False
    assert nip_checksum_ok("") is False


# --- rozpoznanie dostawcy --------------------------------------------------
def test_rozpoznaje_koko_z_prawdziwego_skanu():
    """NIP na tym skanie jest uszkodzony, więc zostaje nazwa — i wystarcza."""
    text = FIXTURE.read_text(encoding="utf-8")
    m = match_supplier(text, parse_hdi_text(text), DOSTAWCY)
    assert m is not None
    assert m["id"] == "koko"
    assert m["matched_by"] == "nazwie"


def test_poprawny_nip_wygrywa_z_nazwa():
    """Gdy NIP przejdzie sumę kontrolną, jest pewniejszy niż nazwa."""
    text = "Nazwa: KOKO SP. Z O.O.\nNIP: 7732408632\n"
    m = match_supplier(text, parse_hdi_text(text), DOSTAWCY)
    assert m["id"] == "farmex"
    assert m["matched_by"] == "NIP"


def test_numer_weterynaryjny_gdy_kontrahent_go_ma():
    dostawcy = [{**DOSTAWCY[0], "vet_number": "PL 12033904 WE"}]
    text = "Weterynaryjny numer identyfikacyjny zakładu: PL 12033904 WE\n"
    m = match_supplier(text, parse_hdi_text(text), dostawcy)
    assert m["matched_by"] == "numerze weterynaryjnym"


def test_nieznany_dostawca_to_brak_dopasowania_a_nie_zgadywanie():
    text = "Nazwa i adres wysyłającego: DRÓBPOL SP. Z O.O.\nNIP: 1111111111\n"
    assert match_supplier(text, parse_hdi_text(text), DOSTAWCY) is None


def test_dwoch_pasujacych_po_nazwie_nie_wybiera_zadnego():
    """Lepiej kazać operatorowi wybrać, niż podstawić losowego."""
    dostawcy = [
        {"id": "a", "name": "MEAT SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
         "display_name": "MEAT", "nip": "", "vet_number": ""},
        {"id": "b", "name": "MEAT SPÓŁKA AKCYJNA", "display_name": "MEAT", "nip": "", "vet_number": ""},
    ]
    text = "Nazwa i adres wysyłającego: MEAT SP. Z O.O.\n"
    assert match_supplier(text, parse_hdi_text(text), dostawcy) is None


def test_krotki_skrot_nie_lapie_przypadkiem():
    """Dwuliterowy skrót trafiłby się w dowolnym tekście — pomijamy."""
    dostawcy = [{"id": "x", "name": "PW", "display_name": "PW", "nip": "", "vet_number": ""}]
    assert match_supplier("Opis towaru: PW ĆWIARTKA", parse_hdi_text(""), dostawcy) is None
