"""Test: sztuka (finished_unit) niesie TULEJĘ z linii planu.

Linia planu trzyma tuleję w `packaging_name` (nie ma kolumny `tuleja`), więc
generacja sztuk musi kopiować packaging_name → finished_units.tuleja. Inaczej
skaner sztuki nie pokazuje tulei.

Wymaga TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all
from app.services.finished_units_service import generate_units_from_plan_line


def _seed_plan_line(line_id="pl1", plan_id="pp1", qty=2, packaging_name="METAL 50CM"):
    execute("INSERT INTO production_plans (id, plan_no) VALUES (%s,%s)", (plan_id, "PP/1"))
    execute(
        "INSERT INTO production_plan_lines "
        "(id, plan_id, qty, kg_per_unit, recipe_id, product_type_id, packaging_name, "
        " batch_allocation, seasoned_batch_no, worker_entries, line_status) "
        "VALUES (%s,%s,%s,1.0,'r1','p1',%s,'{}'::jsonb,'364','[]'::jsonb,'PLANNED')",
        (line_id, plan_id, qty, packaging_name),
    )


def test_generated_units_carry_tuleja_from_packaging_name(db):
    _seed_plan_line(packaging_name="METAL 50CM", qty=2)
    generate_units_from_plan_line("pl1")
    rows = query_all("SELECT tuleja FROM finished_units WHERE plan_line_id='pl1'")
    assert len(rows) == 2
    assert all(r["tuleja"] == "METAL 50CM" for r in rows)
