"""Zdarzenie pracy powstaje razem z zapisem sztuk — w jednej transakcji.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all
from app.services.production_plans_service import update_line_progress


def _seed(qty=20, qty_done=0, entries="[]"):
    execute(
        "INSERT INTO production_plans (id, plan_no, plan_date, status) "
        "VALUES ('pp1','PP/1','2026-08-27','active')"
    )
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, position, qty, qty_done, kg_per_unit, recipe_id, recipe_name, "
        " product_type_id, batch_allocation, seasoned_batch_no, worker_entries, line_status) "
        "VALUES ('pl1','pp1',0,%s,%s,40.0,'r1','WROCLAW','p1','{}'::jsonb,'364',%s::jsonb,'PLANNED')",
        (qty, qty_done, entries),
    )


def _wpisy(pieces, wid="w1", nazwa="DAWID NOWAK"):
    return [{"workerId": wid, "workerName": nazwa, "pieces": pieces, "addedAt": "10:00"}]


def test_dopisanie_sztuk_zostawia_zdarzenie(db):
    _seed()
    update_line_progress("pp1", "pl1", 5, "IN_PROGRESS", _wpisy(5))

    ev = query_all("SELECT * FROM production_work_events WHERE plan_id='pp1'")
    assert len(ev) == 1
    assert ev[0]["pieces_delta"] == 5
    assert ev[0]["recipe_id"] == "r1"
    assert float(ev[0]["kg_per_unit"]) == 40.0
    assert ev[0]["worker_id"] == "w1"
    assert ev[0]["crew_size"] == 1


def test_odjecie_sztuk_zostawia_zdarzenie_UJEMNE(db):
    _seed(qty_done=5, entries='[{"workerId":"w1","workerName":"DAWID NOWAK","pieces":5,"addedAt":"10:00"}]')
    update_line_progress("pp1", "pl1", 3, "IN_PROGRESS", _wpisy(3))

    ev = query_all("SELECT pieces_delta FROM production_work_events WHERE plan_id='pp1'")
    assert [e["pieces_delta"] for e in ev] == [-2]


def test_zapis_bez_zmiany_liczby_sztuk_nie_zostawia_zdarzenia(db):
    _seed(qty_done=5, entries='[{"workerId":"w1","workerName":"DAWID NOWAK","pieces":5,"addedAt":"10:00"}]')
    update_line_progress("pp1", "pl1", 5, "IN_PROGRESS", _wpisy(5))

    assert query_all("SELECT 1 FROM production_work_events WHERE plan_id='pp1'") == []


def test_odrzucony_zapis_NIE_zostawia_zdarzenia(db):
    """Rollback transakcji musi zabrać ze sobą log — inaczej uczenie liczyłoby
    pracę, której nie ma."""
    _seed(qty=20, qty_done=10)
    execute(
        "INSERT INTO finished_units (id, qr_code, qr_seq, plan_line_id, status, created_at) "
        "VALUES ('u1','KEBAB-u1',1,'pl1','produced', now())"
    )
    with pytest.raises(HTTPException):
        update_line_progress("pp1", "pl1", 0, "PLANNED", [])

    assert query_all("SELECT 1 FROM production_work_events WHERE plan_id='pp1'") == []


def test_zaloga_liczona_z_zywych_wpisow(db):
    _seed(qty_done=5, entries='[{"workerId":"w1","workerName":"A","pieces":5,"addedAt":"10:00"}]')
    update_line_progress("pp1", "pl1", 8, "IN_PROGRESS", [
        {"workerId": "w1", "workerName": "A", "pieces": 5, "addedAt": "10:00"},
        {"workerId": "w2", "workerName": "B", "pieces": 3, "addedAt": "11:00"},
    ])

    ev = query_all("SELECT crew_size FROM production_work_events WHERE plan_id='pp1'")
    assert ev[-1]["crew_size"] == 2
