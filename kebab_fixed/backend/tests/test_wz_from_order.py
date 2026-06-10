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


def test_skips_zero_piece_batches_in_allocation():
    # Realny przypadek: alokacja zawiera partię z pieces=0 (np. PP1) obok
    # właściwej — pozycja zerowa nie może trafić na dokument.
    plan_lines = [{
        "qty_done": 10, "recipe_id": "r1", "recipe_name": "GOLD KEBAB",
        "batch_allocation": {"349": {"pieces": 10}, "PP1": {"pieces": 0}},
    }]
    lines, produced = build_order_wz_lines(plan_lines)
    assert [(l["batch_no"], l["qty"]) for l in lines] == [("349", 10)]
    assert produced == 10


def test_skips_lines_without_production():
    lines, produced = build_order_wz_lines([{"qty_done": 0, "recipe_name": "X"}])
    assert lines == [] and produced == 0


def test_lines_carry_weight_like_manual_wz():
    # Jak w WZ ręcznym: nazwa z wagą, kg_per_unit/total_kg na linii (wycena za kg)
    plan_lines = [{
        "qty_done": 10, "recipe_id": "r1", "recipe_name": "Gold2", "kg_per_unit": 40,
        "batch_allocation": {"353": {"pieces": 10}},
    }]
    lines, produced = build_order_wz_lines(plan_lines)
    assert produced == 10
    assert lines[0]["name"] == "Gold2 40kg"
    assert lines[0]["kg_per_unit"] == 40 and lines[0]["total_kg"] == 400
    assert lines[0]["qty"] == 10 and lines[0]["batch_no"] == "353"


def test_lines_split_per_weight_same_recipe():
    # Gold2 40kg i Gold2 30kg to OSOBNE pozycje (jak w zamyśle: rodzaj+waga)
    plan_lines = [
        {"qty_done": 10, "recipe_id": "r1", "recipe_name": "Gold2", "kg_per_unit": 40,
         "seasoned_batch_no": "353"},
        {"qty_done": 30, "recipe_id": "r1", "recipe_name": "Gold2", "kg_per_unit": 30,
         "seasoned_batch_no": "353"},
    ]
    lines, produced = build_order_wz_lines(plan_lines)
    assert produced == 40
    assert [(l["name"], l["qty"], l.get("total_kg")) for l in lines] == [
        ("Gold2 40kg", 10, 400), ("Gold2 30kg", 30, 900)]
