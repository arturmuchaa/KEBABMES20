"""Alokacja sztuk mieszanych (PM) w planowaniu produkcji.

Scenariusz źródłowy: resztka 1 kg z partii 346 dołożona do 19 kg z partii
347 w jednej sztuce 20 kg → sztuka NIE może dostać numeru 347; idzie do
kubełka MIXED (po aktywacji planu → numer PM{n}).
"""
from app.models.production import PlanLineCreate
from app.services.production_plans_service import (
    MIXED_KEY,
    _allocation_kg_per_batch,
    _compute_allocation,
)


def _locked(rows):
    return {r["id"]: dict(r) for r in rows}


def test_mixed_piece_from_two_leftovers():
    # 346 ma 1 kg, 347 ma 19 kg → 1 szt × 20 kg = sztuka MIESZANA
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 19.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    nos, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert MIXED_KEY in alloc
    assert alloc[MIXED_KEY]["pieces"] == 1
    assert alloc[MIXED_KEY]["kg"] == 20.0
    assert alloc[MIXED_KEY]["parts"]["346"] == {"kg": 1.0, "batch_id": "a"}
    assert alloc[MIXED_KEY]["parts"]["347"] == {"kg": 19.0, "batch_id": "b"}
    assert alloc["346"]["pieces"] == 0
    assert alloc["347"]["pieces"] == 0
    # rezerwacje schodzą z OBU partii źródłowych (wcześniej: 0 kg → dziura)
    assert _allocation_kg_per_batch(alloc) == {"a": 1.0, "b": 19.0}


def test_whole_pieces_plus_one_mixed():
    # 20 szt × 20 kg; 346 = resztka 15 kg, 347 = 385 kg
    # → 19 czystych z 347 + 1 mieszana (15 z 346 + 5 z 347)
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 15.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 385.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=20, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    nos, alloc, _, _ = _compute_allocation(None, line, 400.0, locked)
    assert alloc["347"]["pieces"] == 19
    assert alloc[MIXED_KEY]["pieces"] == 1
    assert alloc[MIXED_KEY]["parts"]["346"]["kg"] == 15.0
    assert alloc[MIXED_KEY]["parts"]["347"]["kg"] == 5.0
    kg = _allocation_kg_per_batch(alloc)
    assert kg["a"] == 15.0
    assert kg["b"] == 385.0
    # snapshot locked zaktualizowany — kolejna linia planu liczy się
    # na pomniejszonej puli (fix fałszywych 409 przy wielu liniach)
    assert locked["a"]["kg_reserved"] == 15.0
    assert locked["b"]["kg_reserved"] == 385.0


def test_clean_split_has_no_mixed_bucket():
    # bez resztek: 24 szt = 6 z 346 + 18 z 347 — zachowanie bez zmian
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 120.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 360.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=24, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    nos, alloc, _, _ = _compute_allocation(None, line, 480.0, locked)
    assert MIXED_KEY not in alloc
    assert alloc["346"]["pieces"] == 6
    assert alloc["347"]["pieces"] == 18


def test_shortfall_leaves_remainder_unallocated():
    # resztek nie starcza na całą sztukę → brak kubełka MIXED,
    # sztuka zostaje nieprzydzielona (złapie ją walidacja niedoborów)
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 1.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 5.0, "kg_reserved": 0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    nos, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert MIXED_KEY not in alloc
    assert sum(int(a.get("pieces") or 0) for a in alloc.values()) == 0


def test_respects_existing_reservations():
    # kg_reserved innych planów pomniejsza pulę: 347 ma 40 kg, ale 25 kg
    # zarezerwowane → tylko 15 kg wolne → sztuka mieszana 5+15
    locked = _locked([
        {"id": "a", "batch_no": "346", "kg_available": 5.0, "kg_reserved": 0},
        {"id": "b", "batch_no": "347", "kg_available": 40.0, "kg_reserved": 25.0},
    ])
    line = PlanLineCreate(qty=1, kg_per_unit=20, recipe_id="r",
                          seasoned_batch_ids=["a", "b"])
    nos, alloc, _, _ = _compute_allocation(None, line, 20.0, locked)
    assert alloc[MIXED_KEY]["parts"]["346"]["kg"] == 5.0
    assert alloc[MIXED_KEY]["parts"]["347"]["kg"] == 15.0
