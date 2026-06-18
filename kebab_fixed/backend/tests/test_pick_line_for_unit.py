from app.services.stock_cartons_service import pick_line_for_unit


def _line(**kw):
    base = dict(id="l1", recipe_id="r1", product_type_id="pt1",
                packaging_name="Tuleja A", kg_per_unit=10.0, target_qty=5, packed_qty=0)
    base.update(kw)
    return base


def _unit(**kw):
    base = dict(recipe_id="r1", product_type_id="pt1", tuleja="Tuleja A", weight_kg=10.0)
    base.update(kw)
    return base


def test_matches_single_line():
    assert pick_line_for_unit(_unit(), [_line()])["id"] == "l1"


def test_no_match_wrong_recipe():
    assert pick_line_for_unit(_unit(recipe_id="rX"), [_line()]) is None


def test_skips_full_line_picks_next():
    full = _line(id="l1", packed_qty=5)
    free = _line(id="l2", packed_qty=0)
    assert pick_line_for_unit(_unit(), [full, free])["id"] == "l2"


def test_weight_compared_with_rounding():
    assert pick_line_for_unit(_unit(weight_kg=10.0004), [_line(kg_per_unit=10.0)])["id"] == "l1"


def test_returns_none_when_all_full():
    assert pick_line_for_unit(_unit(), [_line(packed_qty=5)]) is None
