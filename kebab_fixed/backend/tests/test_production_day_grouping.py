"""Czyste grupowanie wierszy seasoned_meat po recepturze dla zakładki
'Zamknięcie dnia' — bez DB, wzorzec analogiczny do split_seasoned_sessions."""
from app.services.seasoned_meat_service import _group_production_day_rows

ROWS = [
    {"recipe_id": "r1", "recipe_name": "Gold", "status": "available",
     "kg_available": 100.0, "reconciled_at": None, "reconcile_reason": None},
    {"recipe_id": "r1", "recipe_name": "Gold", "status": "available",
     "kg_available": 50.0, "reconciled_at": "2026-07-23T10:00:00", "reconcile_reason": "ścinki"},
    {"recipe_id": "r2", "recipe_name": "Classic", "status": "closed",
     "kg_available": 0.0, "reconciled_at": None, "reconcile_reason": None},
]


def test_grupuje_po_recepturze_sumuje_teoretyczne():
    groups = {g["recipeId"]: g for g in _group_production_day_rows(ROWS, "2026-07-23")}
    assert groups["r1"]["theoreticalKg"] == 150.0
    assert groups["r1"]["batchCount"] == 2
    assert groups["r1"]["recipeName"] == "Gold"
    assert groups["r1"]["productionDay"] == "2026-07-23"


def test_zamkniete_partie_licza_sie_do_batch_count_nie_do_teoretycznej():
    groups = {g["recipeId"]: g for g in _group_production_day_rows(ROWS, "2026-07-23")}
    assert groups["r2"]["batchCount"] == 1
    assert groups["r2"]["theoreticalKg"] == 0.0


def test_ostatnia_korekta_wybiera_najnowsza():
    groups = {g["recipeId"]: g for g in _group_production_day_rows(ROWS, "2026-07-23")}
    assert groups["r1"]["lastReconciledAt"] == "2026-07-23T10:00:00"
    assert groups["r1"]["lastReconcileReason"] == "ścinki"
    assert groups["r2"]["lastReconciledAt"] is None


def test_posortowane_po_nazwie_receptury():
    groups = _group_production_day_rows(ROWS, "2026-07-23")
    names = [g["recipeName"] for g in groups]
    assert names == sorted(names)
