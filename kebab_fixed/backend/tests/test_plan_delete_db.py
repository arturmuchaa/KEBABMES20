"""Usuwanie planu produkcji, którego nikt jeszcze nie zaczął robić.

POWÓD ISTNIENIA: plan wpisany omyłkowo albo na zły dzień zostawał w systemie
na zawsze — dało się go najwyżej anulować, więc lista planów puchła od pozycji,
których nigdy nie było. Usuwamy tylko to, po czym NIE MA śladu na hali:
szkic albo plan aktywny, z którego nie wyprodukowano ani jednej sztuki.

Plan trzyma REZERWACJE mięsa przyprawionego — usunięcie musi je oddać do puli,
inaczej kilogramy zniknęłyby razem z planem i nikt by ich nie odzyskał.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.services.production_plans_service import (
    create_plan, delete_plan, get_plan, update_plan_status,
)


def _partia(batch_id: str, recipe_id: str, kg: float):
    execute(
        "INSERT INTO seasoned_meat (id, recipe_id, batch_no, production_day, "
        "kg_produced, kg_available, kg_reserved) VALUES (%s,%s,%s,'2026-08-24',%s,%s,0)",
        (batch_id, recipe_id, batch_id, kg, kg),
    )


def _plan(qty: int = 10, kg: float = 10.0, batches: list[str] | None = None):
    return create_plan(ProductionPlanCreate(
        plan_date="2026-08-24",
        lines=[PlanLineCreate(qty=qty, kg_per_unit=kg, recipe_id="r-KIRMIZI",
                              recipe_name="KIRMIZI", client_name="Bulli",
                              seasoned_batch_ids=batches or [])],
    ))


def test_szkic_da_sie_usunac(db):
    p = _plan()
    delete_plan(p["id"])
    assert query_one("SELECT id FROM production_plans WHERE id=%s", (p["id"],)) is None


def test_usuniecie_zabiera_ze_soba_pozycje(db):
    p = _plan()
    delete_plan(p["id"])
    assert query_all("SELECT id FROM production_plan_lines WHERE plan_id=%s", (p["id"],)) == []


def test_usuniecie_ODDAJE_zarezerwowane_mieso(db):
    """Bez tego kilogramy znikałyby razem z planem i nikt by ich nie odzyskał."""
    _partia("sm-1", "r-KIRMIZI", 500.0)
    p = _plan(qty=10, kg=10.0, batches=["sm-1"])     # 100 kg
    update_plan_status(p["id"], "active")
    zarezerwowane = float(query_one("SELECT kg_reserved FROM seasoned_meat WHERE id='sm-1'")["kg_reserved"])
    assert zarezerwowane > 0

    delete_plan(p["id"])

    po = float(query_one("SELECT kg_reserved FROM seasoned_meat WHERE id='sm-1'")["kg_reserved"])
    assert po == 0.0


def test_plan_z_wyprodukowana_sztuka_NIE_da_sie_usunac(db):
    p = _plan()
    linia = p["lines"][0]["id"]
    execute("UPDATE production_plan_lines SET qty_done=1 WHERE id=%s", (linia,))
    with pytest.raises(HTTPException) as err:
        delete_plan(p["id"])
    assert err.value.status_code == 400
    assert get_plan(p["id"]) is not None


def test_plan_wykonany_NIE_da_sie_usunac(db):
    p = _plan()
    update_plan_status(p["id"], "done")
    with pytest.raises(HTTPException) as err:
        delete_plan(p["id"])
    assert err.value.status_code == 400


def test_plan_aktywny_ale_NIERUSZONY_da_sie_usunac(db):
    """Aktywny to jeszcze nie zrobiony — dopóki hala nic nie wyprodukowała,
    plan jest tylko zapowiedzią."""
    _partia("sm-2", "r-KIRMIZI", 500.0)
    p = _plan(batches=["sm-2"])
    update_plan_status(p["id"], "active")
    delete_plan(p["id"])
    assert query_one("SELECT id FROM production_plans WHERE id=%s", (p["id"],)) is None


def test_nieistniejacy_plan(db):
    with pytest.raises(HTTPException) as err:
        delete_plan("nie-ma-takiego")
    assert err.value.status_code == 404
