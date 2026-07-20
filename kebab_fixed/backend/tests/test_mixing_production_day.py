"""Dzień produkcji partii przyprawionego = data planu, nie chwila potwierdzenia.

Prod 2026-07-20: masowanie wykonane w niedzielę (plan 2026-07-19) biuro
potwierdzało w poniedziałek — partia trafiłaby na poniedziałek, a termin
ważności (dzień produkcji + 5) byłby o dobę za długi.
Czyste funkcje — bez bazy."""
from datetime import date

from app.services.mixing_service import _production_day


def test_potwierdzenie_po_fakcie_bierze_date_planu():
    assert _production_day("2026-07-19", "2026-07-20") == "2026-07-19"


def test_potwierdzenie_tego_samego_dnia_bez_zmian():
    assert _production_day("2026-07-20", "2026-07-20") == "2026-07-20"


def test_plan_z_wyprzedzeniem_nie_daje_daty_z_przyszlosci():
    # Plan na jutro domknięty dziś: etykieta nie może mieć jutrzejszej daty.
    assert _production_day("2026-07-21", "2026-07-20") == "2026-07-20"


def test_brak_daty_planu_to_dzisiaj():
    assert _production_day(None, "2026-07-20") == "2026-07-20"
    assert _production_day("", "2026-07-20") == "2026-07-20"


def test_przyjmuje_obiekt_date_i_timestamp():
    assert _production_day(date(2026, 7, 19), "2026-07-20") == "2026-07-19"
    assert _production_day("2026-07-19T22:15:00+00:00", "2026-07-20") == "2026-07-19"
