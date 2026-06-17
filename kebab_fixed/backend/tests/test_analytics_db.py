"""Testy integracyjne agregacji analityki (SQL na bazie testowej)."""
from app.db import execute
from app.services.analytics_service import mixing_yield, volume, cost_trend


def _seed_session(order_id, kg_meat, kg_output, day):
    # mixing_sessions wymaga order_id (FK do mixing_orders)
    execute(
        "INSERT INTO mixing_orders (id, order_no, status) VALUES (%s,%s,'done') "
        "ON CONFLICT (id) DO NOTHING",
        (order_id, f"MAS/{order_id}"),
    )
    execute(
        "INSERT INTO mixing_sessions (id, order_id, machine_id, kg_meat, kg_output, batch_no, started_at) "
        "VALUES (%s,%s,1,%s,%s,'b', %s::timestamptz)",
        (f"s-{order_id}-{day}-{kg_output}", order_id, kg_meat, kg_output, f"{day} 10:00:00+00"),
    )


def test_mixing_yield_groups_by_day_and_computes_pct(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    _seed_session("o2", 200, 240, "2026-06-10")   # ten sam dzień → sumuje
    _seed_session("o3", 100, 110, "2026-06-11")
    rows = mixing_yield("2026-06-01", "2026-06-30", "day")
    by = {str(r["period"]): r for r in rows}
    assert float(by["2026-06-10"]["kgMeat"]) == 300.0
    assert float(by["2026-06-10"]["kgOutput"]) == 365.0
    assert round(float(by["2026-06-10"]["yieldPct"]), 2) == round(365 / 300 * 100, 2)
    assert "2026-06-11" in by


def test_mixing_yield_month_bucket_merges_days(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    _seed_session("o2", 100, 130, "2026-06-20")
    rows = mixing_yield("2026-06-01", "2026-06-30", "month")
    assert len(rows) == 1
    assert float(rows[0]["kgOutput"]) == 255.0


def test_volume_counts_mixed_and_produced(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    execute("INSERT INTO production_plans (id, plan_no, plan_date) VALUES ('p1','PL/1','2026-06-10')")
    execute(
        "INSERT INTO production_plan_lines (id, plan_id, qty, qty_done, kg_per_unit, total_kg, worker_entries, line_status) "
        "VALUES ('l1','p1',10,8,40,320,'[]'::jsonb,'DONE')",
    )
    rows = volume("2026-06-01", "2026-06-30", "day")
    by = {str(r["period"]): r for r in rows}
    assert float(by["2026-06-10"]["kgSeasoned"]) == 125.0
    assert int(by["2026-06-10"]["unitsProduced"]) == 8
    assert float(by["2026-06-10"]["kgProduced"]) == 320.0   # 8 * 40


def test_cost_trend_weighted_avg_raw_price(db):
    execute("INSERT INTO raw_batches (id, internal_batch_no, price_per_kg, kg_received, received_date) "
            "VALUES ('r1','RB1',10,100,'2026-06-10')")
    execute("INSERT INTO raw_batches (id, internal_batch_no, price_per_kg, kg_received, received_date) "
            "VALUES ('r2','RB2',20,300,'2026-06-10')")   # ważona: (10*100+20*300)/400 = 17.5
    rows = cost_trend("2026-06-01", "2026-06-30", "day")
    by = {str(r["period"]): r for r in rows}
    assert round(float(by["2026-06-10"]["rawCostPerKg"]), 2) == 17.5


def test_invalid_granularity_defaults_to_day(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    rows = mixing_yield("2026-06-01", "2026-06-30", "nonsense")
    assert len(rows) == 1   # potraktowane jak day
