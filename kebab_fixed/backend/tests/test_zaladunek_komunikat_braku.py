"""Komunikat odmowy przy załadunku: CZEGO brakuje, nie tylko ile.

Incydent produkcyjny 24.09.2026. Auto załadowane, wszystko zeskanowane,
magazynier klika „Potwierdź" i dostaje „Skan nie został przyjęty, zawołaj
biuro". Backend wiedział więcej, ale mówił tylko sumami:

    „YALCIN/Z/7/09/26: magazyn nie pokrywa zeskanowanych palet —
     na paletach 506 szt, na stanie 505 szt."

Przy 506 sztukach na 17 paletach ta liczba nie pozwala ruszyć z miejsca.
Faktycznie brakowało JEDNEJ sztuki 40 kg BEYAZ AFIYET — bo 29 sztuk tej
pozycji trzymał stempel zamówienia Z/8, jadącego dopiero za pięć dni.

Właściciel: „zrób aby był komunikat czego brakuje".

Czysta funkcja — bez bazy.
"""
from __future__ import annotations

from app.services.loading_service import _braki_pokrycia, _komunikat_braku


def _poz(recipe, kg, ptype, qty, rodzaj="", receptura=""):
    return {"recipe_id": recipe, "kg_per_unit": kg, "product_type_id": ptype,
            "packaging_id": None, "qty": qty, "rodzaj": rodzaj, "receptura": receptura}


def _pick(recipe, kg, ptype, take):
    return {"fg": {"recipe_id": recipe, "kg_per_unit": kg, "product_type_id": ptype,
                   "packaging_id": None}, "take": take}


def test_wskazuje_POZYCJE_ktorej_brakuje():
    """Sedno zgłoszenia: nazwa wyrobu i gramatura, nie sama liczba sztuk."""
    braki = _braki_pokrycia(
        [_poz("r-beyaz", 40.0, "pt-udo", 40, "KEBAB UDO 100%", "BEYAZ AFIYET")],
        [_pick("r-beyaz", 40.0, "pt-udo", 39)])

    assert len(braki) == 1
    assert braki[0]["etykieta"] == "KEBAB UDO 100% BEYAZ AFIYET 40 kg"
    assert braki[0]["brak"] == 1
    assert braki[0]["rozpis"] == 40
    assert braki[0]["stan"] == 39


def test_pozycje_pokryte_nie_trafiaja_do_komunikatu():
    """Realny załadunek miał 17 palet i 26 pozycji — wypisanie wszystkich
    utopiłoby tę jedną, o którą chodzi."""
    braki = _braki_pokrycia(
        [_poz("r-a", 40.0, "pt-udo", 20, "UDO", "A"),
         _poz("r-b", 25.0, "pt-udo", 30, "UDO", "B")],
        [_pick("r-a", 40.0, "pt-udo", 20), _pick("r-b", 25.0, "pt-udo", 30)])

    assert braki == []


def test_kilka_brakow_naraz():
    braki = _braki_pokrycia(
        [_poz("r-a", 40.0, "pt-udo", 20, "UDO", "A"),
         _poz("r-b", 25.0, "pt-udo", 30, "UDO", "B")],
        [_pick("r-a", 40.0, "pt-udo", 18), _pick("r-b", 25.0, "pt-udo", 25)])

    assert [(b["etykieta"], b["brak"]) for b in braki] == [
        ("UDO A 40 kg", 2), ("UDO B 25 kg", 5)]


def test_pozycja_bez_ANI_JEDNEJ_sztuki_tez_sie_liczy():
    """Brak pokrycia w całości to najczęstszy przypadek przy nowej recepturze —
    nie może wypaść tylko dlatego, że nie ma go wśród `picks`."""
    braki = _braki_pokrycia([_poz("r-x", 30.0, "pt-mix", 12, "MIX", "YAPRAK")], [])

    assert braki[0]["etykieta"] == "MIX YAPRAK 30 kg"
    assert braki[0]["brak"] == 12


def test_gramatura_bez_zbednego_zera():
    """„40 kg", nie „40.0 kg" — to idzie na ekran magazyniera."""
    braki = _braki_pokrycia([_poz("r-a", 40.0, "pt-udo", 5, "UDO", "A")], [])
    assert "40 kg" in braki[0]["etykieta"]
    braki = _braki_pokrycia([_poz("r-a", 12.5, "pt-udo", 5, "UDO", "A")], [])
    assert "12.5 kg" in braki[0]["etykieta"]


def test_brak_nazw_nie_wywraca_komunikatu():
    """Starsze wiersze bywają bez rodzaju/receptury — lepiej podać samą
    gramaturę niż wywalić załadunek na formatowaniu."""
    braki = _braki_pokrycia([_poz("r-a", 40.0, "pt-udo", 5)], [])
    assert braki[0]["etykieta"] == "40 kg"


def test_komunikat_nazywa_zamowienie_i_pozycje():
    tekst = _komunikat_braku("YALCIN/Z/7/09/26", [
        {"etykieta": "KEBAB UDO 100% BEYAZ AFIYET 40 kg", "brak": 1, "rozpis": 40, "stan": 39}])

    assert "YALCIN/Z/7/09/26" in tekst
    assert "KEBAB UDO 100% BEYAZ AFIYET 40 kg" in tekst
    assert "1 szt" in tekst
    # Liczby zostają: mówią, czy poprawiać rozpis, czy stan magazynu.
    assert "40" in tekst and "39" in tekst


def test_komunikat_miesci_sie_na_ekranie_skanera():
    """Ekran skanera pokazuje zdanie backendu tylko do 220 znaków
    (`scanMessages.komunikatOdmowy`) — dłuższe zostaje zastąpione ogólnikiem,
    czyli dokładnie tym, co właściciel zgłosił."""
    tekst = _komunikat_braku("YALCIN/Z/7/09/26", [
        {"etykieta": f"RODZAJ {i} RECEPTURA DLUGA NAZWA 40 kg", "brak": i,
         "rozpis": 40, "stan": 40 - i} for i in range(1, 8)])

    assert len(tekst) <= 220, tekst
