"""Migracja: stock_carton_lines + backfill jednorodnych kartonów."""
from app.db import execute, query_all, query_one
from app.migrations import _backfill_stock_carton_lines


def test_backfill_creates_one_line_per_legacy_carton(db):
    execute(
        """INSERT INTO stock_cartons
             (id, carton_no, client_id, client_name, recipe_id, recipe_name,
              product_type_id, product_type_name, packaging_id, packaging_name,
              kg_per_unit, target_qty, packed_qty, status, created_at)
           VALUES ('c1', 1, 'cl1', 'Zagros', 'r1', 'Klasyk',
                   'pt1', 'Udo', 'pk1', 'Tuleja A', 10.0, 50, 0, 'open', now())""",
    )
    _backfill_stock_carton_lines()
    lines = query_all("SELECT * FROM stock_carton_lines WHERE carton_id='c1'")
    assert len(lines) == 1
    assert lines[0]["recipe_id"] == "r1"
    assert int(lines[0]["target_qty"]) == 50
    assert float(lines[0]["kg_per_unit"]) == 10.0


def test_backfill_is_idempotent(db):
    execute(
        """INSERT INTO stock_cartons
             (id, carton_no, client_id, kg_per_unit, target_qty, packed_qty, status, created_at)
           VALUES ('c2', 2, 'cl1', 5.0, 20, 0, 'open', now())""",
    )
    _backfill_stock_carton_lines()
    _backfill_stock_carton_lines()
    rows = query_one("SELECT count(*) AS c FROM stock_carton_lines WHERE carton_id='c2'")
    assert int(rows["c"]) == 1
