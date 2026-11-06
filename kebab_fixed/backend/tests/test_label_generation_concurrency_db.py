"""Real PostgreSQL concurrency regression; isolated TEST_DATABASE_URL only."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from app.db import execute, query_all
from app.services.finished_units_service import generate_units_from_plan_line


def test_two_simultaneous_requests_create_one_set_of_qrs(db):
    execute("INSERT INTO production_plans (id, plan_no, plan_date, status) VALUES ('label-plan','PP/LABEL-TEST','2026-10-15','active')")
    execute("""INSERT INTO production_plan_lines
        (id, plan_id, position, qty, kg_per_unit, recipe_id, product_type_id,
         batch_allocation, seasoned_batch_no, line_status)
        VALUES ('label-line','label-plan',0,100,20,'r1','p1','{}'::jsonb,'401','PLANNED')""")
    barrier = Barrier(2)

    def generate():
        barrier.wait(timeout=10)
        return generate_units_from_plan_line('label-line')

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: generate(), range(2)))
    assert sorted(r['created'] for r in results) == [0, 100]
    units = query_all("SELECT id, qr_code, qr_seq FROM finished_units WHERE plan_line_id='label-line'")
    assert len(units) == len({u['qr_code'] for u in units}) == len({u['qr_seq'] for u in units}) == 100
    assert all(u['qr_code'] == 'U|' + u['id'] for u in units)
    before = {u['qr_code'] for u in units}
    assert generate_units_from_plan_line('label-line')['created'] == 0
    assert {u['qr_code'] for u in query_all("SELECT qr_code FROM finished_units WHERE plan_line_id='label-line'")} == before
