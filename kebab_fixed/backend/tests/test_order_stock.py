"""Pokrycie zamówienia zapasem magazynowym (produkcja "na magazyn" sprzed
zamówienia) — czysta logika porcjowania i budowy linii dokumentów."""
from app.services.order_stock_service import (
    compute_shortfalls,
    portion_stock_rows,
    produced_by_key_from_plan_lines,
)
from app.services.hdi_service import units_from_stock_portions
from app.services.wz_service import build_stock_wz_lines
from app.utils.batch_numbers import kebab_batch_wsad


ORDER_LINES = [{"recipe_id": "r1", "kg_per_unit": 40, "qty": 18}]


def _fg(**kw):
    row = {"id": "fg1", "batch_no": "120626 364", "recipe_id": "r1",
           "recipe_name": "Gold2", "product_type_name": "Kebab drobiowy",
           "kg_per_unit": 40, "qty": 18, "qty_available": 18,
           "qty_shipped": 0, "client_order_no": "", "client_name": "",
           "produced_date": "2026-06-12"}
    row.update(kw)
    return row


def test_shortfall_is_ordered_minus_plan_production():
    produced = produced_by_key_from_plan_lines(
        [{"recipe_id": "r1", "kg_per_unit": 40, "qty_done": 10}])
    assert compute_shortfalls(ORDER_LINES, produced) == {("r1", 40.0): 8}


def test_no_shortfall_when_plan_covers_order():
    produced = produced_by_key_from_plan_lines(
        [{"recipe_id": "r1", "kg_per_unit": 40, "qty_done": 18}])
    assert compute_shortfalls(ORDER_LINES, produced) == {}


def test_stock_only_order_fully_covered_from_stock():
    # Scenariusz z produkcji: 18 szt "na magazyn", potem zamówienie na 18.
    short = compute_shortfalls(ORDER_LINES, {})
    portions = portion_stock_rows(short, [_fg()], "ZAGROS/Z/1/06/26")
    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("fg1", 18)]


def test_portion_respects_qty_available_not_qty():
    # Część zapasu już wydana ręcznym WZ — do pokrycia tylko dostępne.
    portions = portion_stock_rows(
        {("r1", 40.0): 18}, [_fg(qty_available=5, qty_shipped=13)], "Z1")
    assert [(p["take"]) for p in portions] == [5]


def test_stamped_rows_count_full_qty_even_when_shipped():
    # Po wystawieniu WZ rozchód stemplował wiersz zamówieniem i wyzerował
    # qty_available — HDI/CMR wystawiane PO WZ nadal muszą widzieć te sztuki.
    row = _fg(client_order_no="Z1", qty_available=0, qty_shipped=18)
    portions = portion_stock_rows({("r1", 40.0): 18}, [row], "Z1")
    assert [(p["take"]) for p in portions] == [18]


def test_rows_for_other_recipe_or_weight_skipped():
    rows = [_fg(id="a", recipe_id="r2"), _fg(id="b", kg_per_unit=30),
            _fg(id="c")]
    portions = portion_stock_rows({("r1", 40.0): 18}, rows, "Z1")
    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("c", 18)]


def test_partial_coverage_across_rows_in_order():
    rows = [_fg(id="a", qty=10, qty_available=10),
            _fg(id="b", qty=10, qty_available=10)]
    portions = portion_stock_rows({("r1", 40.0): 14}, rows, "Z1")
    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("a", 10), ("b", 4)]


def test_build_stock_wz_lines_carry_full_batch_and_stock_id():
    lines = build_stock_wz_lines([{"fg": _fg(), "take": 18}])
    assert lines == [{
        "name": "Gold2 40kg", "qty": 18, "unit": "szt",
        "batch_no": "120626 364", "price": None, "value": None,
        "stock_type": "fg", "stock_id": "fg1", "recipe_id": "r1",
        "kg_per_unit": 40, "total_kg": 720,
    }]


def test_hdi_units_use_bare_wsad_and_produced_date():
    units = units_from_stock_portions(
        [{"fg": _fg(), "take": 2}], {"r1": 30})
    assert len(units) == 2
    u = units[0]
    # Goły wsad — group_hdi_items odtworzy '120626 364' z produced_date.
    assert u["batch_no"] == "364"
    assert u["produced_date"] == "2026-06-12"
    assert u["shelf_life_days"] == 30
    assert u["product_type_name"] == "Gold2"
    assert u["weight_kg"] == 40


def test_kebab_batch_wsad_strips_date_prefix_idempotently():
    assert kebab_batch_wsad("120626 364") == "364"
    assert kebab_batch_wsad("120626 PM1") == "PM1"
    assert kebab_batch_wsad("364") == "364"
    assert kebab_batch_wsad("PP2") == "PP2"
    assert kebab_batch_wsad("") == ""
    assert kebab_batch_wsad(None) == ""
