"""Przypisanie roboczogodzin do receptury.

Model: praca między dwoma kolejnymi zapisami poszła w to, co WŁAŚNIE zapisano.
Pierwsze zdarzenie dnia tylko ustawia zegar — nie wnosi ani kilogramów, ani
godzin, bo nie wiadomo, kiedy zaczęła się praca, która do niego doprowadziła.
"""
from datetime import datetime, timedelta, timezone

from app.services.production_rates_service import person_hours_by_recipe

T0 = datetime(2026, 8, 27, 6, 0, tzinfo=timezone.utc)


def ev(minuty, recipe, sztuk, kg_szt=40.0, zaloga=2):
    return {"at": T0 + timedelta(minutes=minuty), "recipe_id": recipe,
            "pieces_delta": sztuk, "kg_per_unit": kg_szt, "crew_size": zaloga}


def test_pierwsze_zdarzenie_tylko_ustawia_zegar():
    out = person_hours_by_recipe([ev(0, "r1", 5)], [])
    assert out == {}


def test_drugie_zdarzenie_liczy_sie_od_pierwszego():
    # 30 min x 2 osoby = 1 rbh; 5 szt x 40 kg = 200 kg
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(30, "r1", 5)], [])
    assert out["r1"]["personHours"] == 1.0
    assert out["r1"]["kg"] == 200.0


def test_dwie_receptury_przeplatane_dostaja_swoje_godziny():
    zdarzenia = [ev(0, "r1", 5), ev(30, "r1", 5), ev(60, "r2", 5), ev(75, "r1", 5)]
    out = person_hours_by_recipe(zdarzenia, [])
    assert out["r1"]["personHours"] == 1.0 + 0.5      # 30 min + 15 min, po 2 osoby
    assert out["r2"]["personHours"] == 1.0            # 30 min x 2


def test_przerwa_nie_jest_praca():
    # zapis o 0, przerwa 30 min od 10, zapis o 60 -> praca 30 min x 2 = 1 rbh
    przerwy = [(T0 + timedelta(minutes=10), T0 + timedelta(minutes=40))]
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(60, "r1", 5)], przerwy)
    assert out["r1"]["personHours"] == 1.0


def test_nieodnotowana_dziura_jest_ucinana():
    # 4 h bez zapisu (awaria) -> liczymy najwyzej 30 min
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(240, "r1", 5)], [])
    assert out["r1"]["personHours"] == 1.0            # 30 min x 2 osoby


def test_korekta_w_dol_nie_jest_praca():
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(30, "r1", -3)], [])
    assert out == {}


def test_zmiana_zalogi_w_ciagu_dnia_wchodzi_do_godzin():
    zdarzenia = [ev(0, "r1", 5, zaloga=2), ev(30, "r1", 5, zaloga=6)]
    out = person_hours_by_recipe(zdarzenia, [])
    assert out["r1"]["personHours"] == 3.0            # 0.5 h x 6 osob


def test_zerowa_zaloga_nie_generuje_godzin():
    out = person_hours_by_recipe([ev(0, "r1", 5), ev(30, "r1", 5, zaloga=0)], [])
    assert out["r1"]["personHours"] == 0.0


from app.services.production_rates_service import shrink


def test_bez_probek_zostaje_sam_rodzic():
    assert shrink(0.0, 0, 120.0) == 120.0


def test_pierwsza_probka_wazy_jedna_trzecia():
    # (1x180 + 2x120) / 3 = 140
    assert shrink(180.0, 1, 120.0) == 140.0


def test_piec_probek_wazy_piec_siodmych():
    # (5x180 + 2x120) / 7 = 162.857...
    assert round(shrink(180.0, 5, 120.0), 3) == 162.857


def test_kurczenie_nigdy_nie_skacze_miedzy_dniami():
    """Przy każdym kolejnym dniu waga rośnie monotonicznie — bez cliffa,
    który dawałby próg typu „receptura liczy się od 3. dnia"."""
    poprzednie = shrink(180.0, 0, 120.0)
    for n in range(1, 12):
        teraz = shrink(180.0, n, 120.0)
        assert teraz >= poprzednie
        assert abs(teraz - poprzednie) < 25.0
        poprzednie = teraz
