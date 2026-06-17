"""Testy INTEGRACYJNE realnej KONSUMPCJI przyprawionego przy produkcji wyrobu.

`_consume_seasoned_for_entry` (finished_goods_service) zdejmuje kg z seasoned_meat
przy produkcji sztuk: kg_available↓, kg_used↑, ruch magazynowy OUT 'seasoned'.
To moment, w którym mięso przyprawione faktycznie schodzi z magazynu — krytyczne
dla bilansu i śladu. (kg_reserved zwalniany osobno dopiero w finish_day.)

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import json

from app.db import transaction, query_one, execute
from app.services.finished_goods_service import _consume_seasoned_for_entry


def _seed_seasoned(sm_id, batch_no, kg_available, kg_reserved=0, kg_used=0):
    execute(
        "INSERT INTO seasoned_meat "
        "(id, batch_no, recipe_id, kg_produced, kg_available, kg_reserved, kg_used, status) "
        "VALUES (%s,%s,'r1',%s,%s,%s,%s,'available')",
        (sm_id, batch_no, kg_available, kg_available, kg_reserved, kg_used),
    )


def _seed_plan_line(line_id="l1", plan_id="p1", qty=10, batch_allocation=None):
    execute("INSERT INTO production_plans (id, plan_no) VALUES (%s,%s)", (plan_id, "PLAN/" + plan_id))
    ba = json.dumps(batch_allocation if batch_allocation is not None else {})
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, qty, qty_done, worker_entries, line_status, batch_allocation) "
        "VALUES (%s,%s,%s,0,'[]'::jsonb,'DONE',%s::jsonb)",
        (line_id, plan_id, qty, ba),
    )


def test_consume_full_entry_deducts_available_and_emits_out(db):
    _seed_seasoned("sm1", "364", kg_available=100, kg_reserved=40)
    _seed_plan_line(qty=10, batch_allocation={"364": {"batch_id": "sm1", "kg": 40}})

    with transaction() as conn:
        _consume_seasoned_for_entry(
            conn, plan_id="p1", plan_line_id="l1", entry_qty=10, total_kg=40,
            seasoned_batch_nos=["364"],
        )

    sm = query_one("SELECT kg_available, kg_used, kg_reserved FROM seasoned_meat WHERE id=%s", ("sm1",))
    assert float(sm["kg_available"]) == 60.0          # 100 - 40
    assert float(sm["kg_used"]) == 40.0
    assert float(sm["kg_reserved"]) == 40.0           # rezerwacja nieruszona (zwalnia finish_day)

    mv = query_one(
        "SELECT qty FROM stock_movements "
        "WHERE product_type='seasoned' AND batch_id='sm1' AND movement_type='OUT' AND source_id='p1'"
    )
    assert mv is not None and float(mv["qty"]) == -40.0  # OUT ze znakiem ujemnym


def test_consume_partial_entry_scales_by_qty(db):
    # entry 5 z linii 10 szt → bierze połowę zaplanowanych kg (40*0.5=20)
    _seed_seasoned("sm1", "364", kg_available=100)
    _seed_plan_line(qty=10, batch_allocation={"364": {"batch_id": "sm1", "kg": 40}})

    with transaction() as conn:
        _consume_seasoned_for_entry(
            conn, plan_id="p1", plan_line_id="l1", entry_qty=5, total_kg=20,
            seasoned_batch_nos=["364"],
        )

    sm = query_one("SELECT kg_available, kg_used FROM seasoned_meat WHERE id=%s", ("sm1",))
    assert float(sm["kg_available"]) == 80.0
    assert float(sm["kg_used"]) == 20.0


def test_consume_fallback_equal_split_by_batch_no(db):
    # brak alokacji w planie → fallback: podział total_kg po seasoned_batch_nos
    _seed_seasoned("sm1", "364", kg_available=100)
    _seed_plan_line(qty=10, batch_allocation={})

    with transaction() as conn:
        _consume_seasoned_for_entry(
            conn, plan_id="p1", plan_line_id="l1", entry_qty=10, total_kg=30,
            seasoned_batch_nos=["364"],
        )

    sm = query_one("SELECT kg_available, kg_used FROM seasoned_meat WHERE id=%s", ("sm1",))
    assert float(sm["kg_available"]) == 70.0
    assert float(sm["kg_used"]) == 30.0


def test_consume_mixed_pieces_pulls_from_source_batches(db):
    # sztuka mieszana (PM) — kg w `parts`, schodzą z partii źródłowych
    _seed_seasoned("sm1", "364", kg_available=100)
    _seed_seasoned("sm2", "365", kg_available=100)
    _seed_plan_line(qty=10, batch_allocation={
        "PM": {"parts": {
            "364": {"batch_id": "sm1", "kg": 30},
            "365": {"batch_id": "sm2", "kg": 10},
        }},
    })

    with transaction() as conn:
        _consume_seasoned_for_entry(
            conn, plan_id="p1", plan_line_id="l1", entry_qty=10, total_kg=40,
            seasoned_batch_nos=["364", "365"],
        )

    a = query_one("SELECT kg_used FROM seasoned_meat WHERE id=%s", ("sm1",))
    b = query_one("SELECT kg_used FROM seasoned_meat WHERE id=%s", ("sm2",))
    assert float(a["kg_used"]) == 30.0
    assert float(b["kg_used"]) == 10.0
