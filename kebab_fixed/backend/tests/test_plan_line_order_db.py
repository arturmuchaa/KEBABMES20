"""Kolejność pozycji planu = kolejność wpisywania przez planistę.

Karta produkcji dla kierownika jest drukowana z planu, więc pozycje MUSZĄ
lecieć tak, jak je wpisano. Wcześniej odczyty szły bez ORDER BY — baza
zwracała pozycje w dowolnej kolejności, innej po każdej edycji (planista
wpisywał NAZAR pierwszy, a na liście lądował gdzie indziej).
"""
import pytest

from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.services.production_plans_service import (
    create_plan,
    list_plans,
    update_plan,
)


def get_plan(plan_id):
    """Plan po ponownym odczycie z bazy (MES czyta plany przez list_plans)."""
    return next(p for p in list_plans() if p["id"] == plan_id)


def _line(recipe_name, qty=1, kg=10.0, line_id=""):
    return PlanLineCreate(
        id=line_id, qty=qty, kg_per_unit=kg, recipe_id="r-" + recipe_name,
        recipe_name=recipe_name, client_name=recipe_name,
    )


@pytest.fixture
def plan_trzy_pozycje(db):
    dto = ProductionPlanCreate(
        plan_date="2026-08-13",
        lines=[_line("NAZAR"), _line("ZAGROS"), _line("POLAT")],
    )
    return create_plan(dto)


def _names(plan):
    return [l["client_name"] for l in plan["lines"]]


def test_kolejnosc_z_formularza_zachowana(plan_trzy_pozycje):
    assert _names(plan_trzy_pozycje) == ["NAZAR", "ZAGROS", "POLAT"]
    assert [l["position"] for l in plan_trzy_pozycje["lines"]] == [1, 2, 3]


def test_odczyt_planu_nie_zmienia_kolejnosci(plan_trzy_pozycje):
    assert _names(get_plan(plan_trzy_pozycje["id"])) == ["NAZAR", "ZAGROS", "POLAT"]


def test_edycja_zachowuje_kolejnosc_formularza(plan_trzy_pozycje):
    # planista przestawia POLAT na początek
    stare = {l["client_name"]: l["id"] for l in plan_trzy_pozycje["lines"]}
    dto = ProductionPlanCreate(
        plan_date="2026-08-13",
        lines=[
            _line("POLAT", line_id=stare["POLAT"]),
            _line("NAZAR", line_id=stare["NAZAR"]),
            _line("ZAGROS", line_id=stare["ZAGROS"]),
        ],
    )
    zmieniony = update_plan(plan_trzy_pozycje["id"], dto)
    assert _names(zmieniony) == ["POLAT", "NAZAR", "ZAGROS"]
    # i po ponownym odczycie z bazy — nie tylko w odpowiedzi na zapis
    assert _names(get_plan(plan_trzy_pozycje["id"])) == ["POLAT", "NAZAR", "ZAGROS"]


def test_dopisana_pozycja_lada_na_swoim_miejscu(plan_trzy_pozycje):
    stare = {l["client_name"]: l["id"] for l in plan_trzy_pozycje["lines"]}
    dto = ProductionPlanCreate(
        plan_date="2026-08-13",
        lines=[
            _line("NAZAR", line_id=stare["NAZAR"]),
            _line("NOWY"),                     # wstawiony w środek
            _line("ZAGROS", line_id=stare["ZAGROS"]),
            _line("POLAT", line_id=stare["POLAT"]),
        ],
    )
    update_plan(plan_trzy_pozycje["id"], dto)
    assert _names(get_plan(plan_trzy_pozycje["id"])) == [
        "NAZAR", "NOWY", "ZAGROS", "POLAT",
    ]
