"""Testy konsumpcji/rezerwacji przyprawionego w PRODUKCJI (production_plans_service).

Produkcja kebaba rezerwuje seasoned_meat przez `kg_reserved` (z guardem wolnych kg),
a przy zamknięciu/edycji planu zwalnia rezerwację. To ścieżka konsumpcji surowca
pośredniego — błąd = błędny ślad / over-reservation.

Czyste testy `_allocation_kg_per_batch` działają zawsze; testy DB wymagają
TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import json
import pytest
from fastapi import HTTPException

from app.db import transaction, query_one, execute
from app.services.production_plans_service import (
    _apply_reservations,
    _restore_reservations,
    _allocation_kg_per_batch,
)


def _seed_seasoned(sm_id, batch_no, kg_available, kg_reserved=0, material_type_id="mat-A"):
    execute(
        "INSERT INTO seasoned_meat "
        "(id, batch_no, recipe_id, kg_produced, kg_available, kg_reserved, status, material_type_id) "
        "VALUES (%s,%s,%s,%s,%s,%s,'available',%s)",
        (sm_id, batch_no, "r1", kg_available, kg_available, kg_reserved, material_type_id),
    )


# ── Czysta logika sumowania alokacji (bez DB) ──────────────────────────
def test_allocation_kg_per_batch_simple():
    alloc = {"364": {"batch_id": "sm1", "kg": 30}, "365": {"batch_id": "sm2", "kg": 20}}
    assert _allocation_kg_per_batch(alloc) == {"sm1": 30.0, "sm2": 20.0}


def test_allocation_kg_per_batch_mixed_parts():
    # sztuka mieszana (PM) — kg siedzą w `parts`
    alloc = {"MIXED": {"parts": {
        "364": {"batch_id": "sm1", "kg": 10},
        "365": {"batch_id": "sm2", "kg": 5},
    }}}
    assert _allocation_kg_per_batch(alloc) == {"sm1": 10.0, "sm2": 5.0}


def test_allocation_kg_per_batch_sums_same_batch():
    alloc = {"a": {"batch_id": "sm1", "kg": 30}, "b": {"batch_id": "sm1", "kg": 20}}
    assert _allocation_kg_per_batch(alloc) == {"sm1": 50.0}


# ── Rezerwacja na bazie ────────────────────────────────────────────────
def test_apply_reservations_increases_kg_reserved(db):
    _seed_seasoned("sm1", "364", 100)
    with transaction() as conn:
        _apply_reservations(conn, {"x": {"batch_id": "sm1", "kg": 30}})
    sm = query_one("SELECT kg_reserved, kg_available, kg_used FROM seasoned_meat WHERE id=%s", ("sm1",))
    assert float(sm["kg_reserved"]) == 30.0
    # rezerwacja NIE dotyka available/used (konsumpcja dopiero w finish_day)
    assert float(sm["kg_available"]) == 100.0
    assert float(sm["kg_used"]) == 0.0


def test_apply_reservations_insufficient_raises_409_and_rolls_back(db):
    _seed_seasoned("sm1", "364", 100, kg_reserved=80)  # wolne = 20
    with pytest.raises(HTTPException) as exc:
        with transaction() as conn:
            _apply_reservations(conn, {"x": {"batch_id": "sm1", "kg": 50}})
    assert exc.value.status_code == 409
    sm = query_one("SELECT kg_reserved FROM seasoned_meat WHERE id=%s", ("sm1",))
    assert float(sm["kg_reserved"]) == 80.0  # bez zmian (rollback)


def test_restore_reservations_returns_kg(db):
    _seed_seasoned("sm1", "364", 100, kg_reserved=40)
    execute("INSERT INTO production_plans (id, plan_no) VALUES (%s,%s)", ("p1", "PLAN/1"))
    ba = json.dumps({"x": {"batch_id": "sm1", "kg": 40}})
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, qty_done, worker_entries, line_status, batch_allocation) "
        "VALUES (%s,%s,0,'[]'::jsonb,'DONE',%s::jsonb)",
        ("l1", "p1", ba),
    )
    with transaction() as conn:
        _restore_reservations(conn, "p1")
    sm = query_one("SELECT kg_reserved FROM seasoned_meat WHERE id=%s", ("sm1",))
    assert float(sm["kg_reserved"]) == 0.0
