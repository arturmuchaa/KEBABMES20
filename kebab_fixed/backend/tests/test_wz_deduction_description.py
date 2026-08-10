"""Opis potrącenia z WZ — pracownik czyta pasek, nie ewidencję.

Numer „WZ/11/08/26" nic mu nie mówi; ma zobaczyć, za co mu potrącono:
asortyment, ile kilogramów i po jakiej cenie. Czysta funkcja — bez bazy.
"""
from app.services.wz_service import deduction_description_from_lines as descr


def test_jedna_pozycja_kg():
    lines = [{"name": "Ćwiartka z kurczaka", "qty": 5, "unit": "kg", "price": 7}]
    assert descr(lines) == "Ćwiartka z kurczaka 5 kg × 7 zł"


def test_cena_ulamkowa_po_polsku():
    lines = [{"name": "Mięso z/s", "qty": 3, "unit": "kg", "price": 11.2}]
    assert descr(lines) == "Mięso z/s 3 kg × 11,20 zł"


def test_wyrob_w_sztukach_wyceniany_za_kg():
    """FG sprzedaje się w sztukach, ale cena jest ZA KG — na pasku musi
    stać ta sama podstawa, po której policzono kwotę."""
    lines = [{"name": "Kebab 3kg", "qty": 2, "unit": "szt", "price": 15,
              "kg_per_unit": 3, "total_kg": 6}]
    assert descr(lines) == "Kebab 3kg 6 kg × 15 zł"


def test_dwie_pozycje_po_przecinku():
    lines = [
        {"name": "Ćwiartka z kurczaka", "qty": 5, "unit": "kg", "price": 7},
        {"name": "Mięso z/s", "qty": 2, "unit": "kg", "price": 15},
    ]
    assert descr(lines) == "Ćwiartka z kurczaka 5 kg × 7 zł, Mięso z/s 2 kg × 15 zł"


def test_duzo_pozycji_skraca_sie_do_paska():
    """Komórka paska ma 148 mm — pełna lista sześciu pozycji by się rozjechała."""
    lines = [{"name": f"Towar {i}", "qty": 1, "unit": "kg", "price": 10} for i in range(6)]
    out = descr(lines)
    # 6 pozycji, dwie pokazane → w skrócie zostają cztery
    assert out == "Towar 0 1 kg × 10 zł, Towar 1 1 kg × 10 zł +4 poz."


def test_bez_ceny_sam_asortyment():
    lines = [{"name": "Ćwiartka", "qty": 5, "unit": "kg", "price": None}]
    assert descr(lines) == "Ćwiartka 5 kg"


def test_ulamkowe_kilogramy():
    lines = [{"name": "Filet", "qty": 2.5, "unit": "kg", "price": 20}]
    assert descr(lines) == "Filet 2,5 kg × 20 zł"


def test_brak_pozycji_daje_pusty_opis():
    assert descr([]) == ""
