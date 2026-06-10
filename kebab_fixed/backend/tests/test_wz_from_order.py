from app.services.wz_service import build_order_wz_lines, wz_order_incomplete


def test_incomplete_when_produced_below_ordered():
    assert wz_order_incomplete(5, 10) is True
    assert wz_order_incomplete(10, 10) is False
    assert wz_order_incomplete(12, 10) is False
    assert wz_order_incomplete(0, 0) is False  # brak zamówionych = nie flagujemy


def test_lines_split_per_batch_allocation():
    plan_lines = [{
        "qty_done": 10, "recipe_id": "r1", "recipe_name": "Kebab drobiowy",
        "batch_allocation": {"S1": {"pieces": 6}, "S2": {"pieces": 4}},
    }]
    lines, produced = build_order_wz_lines(plan_lines)
    assert produced == 10
    assert [(l["batch_no"], l["qty"]) for l in lines] == [("S1", 6), ("S2", 4)]
    assert all(l["unit"] == "szt" and l["price"] is None and l["stock_type"] == "fg" for l in lines)
    assert all(l["recipe_id"] == "r1" for l in lines)


def test_fallback_to_seasoned_batch_when_allocation_mismatch():
    plan_lines = [{
        "qty_done": 10, "recipe_id": "r1", "recipe_name": "Kebab",
        "batch_allocation": {"S1": {"pieces": 3}},  # 3 != 10 → fallback
        "seasoned_batch_no": "S9",
    }]
    lines, produced = build_order_wz_lines(plan_lines)
    assert lines == [{"name": "Kebab", "qty": 10, "unit": "szt", "batch_no": "S9",
                      "price": None, "value": None, "stock_type": "fg", "recipe_id": "r1"}]
    assert produced == 10


def test_aggregates_same_recipe_and_batch_across_lines():
    plan_lines = [
        {"qty_done": 2, "recipe_id": "r1", "recipe_name": "Kebab", "seasoned_batch_no": "S1"},
        {"qty_done": 3, "recipe_id": "r1", "recipe_name": "Kebab", "seasoned_batch_no": "S1"},
    ]
    lines, produced = build_order_wz_lines(plan_lines)
    assert lines[0]["qty"] == 5 and produced == 5


def test_skips_lines_without_production():
    lines, produced = build_order_wz_lines([{"qty_done": 0, "recipe_name": "X"}])
    assert lines == [] and produced == 0
