"""Walidacja edycji planu produkcji — nietykalność wyprodukowanych pozycji."""
from app.services.production_plans_service import validate_plan_edit


def _ex(id, qty_done, recipe_id="r1"):
    return {"id": id, "qty_done": qty_done, "recipe_id": recipe_id}


def _in(id, qty, recipe_id="r1"):
    return {"id": id, "qty": qty, "recipe_id": recipe_id}


def test_no_produced_lines_anything_goes():
    assert validate_plan_edit([_ex("l1", 0)], [_in("l1", 50)]) == []


def test_cannot_delete_produced_line():
    errs = validate_plan_edit([_ex("l1", 10)], [])
    assert len(errs) == 1 and "wyprodukowan" in errs[0].lower()


def test_cannot_shrink_below_qty_done():
    errs = validate_plan_edit([_ex("l1", 20)], [_in("l1", 15)])
    assert len(errs) == 1 and "poni" in errs[0].lower()


def test_can_grow_or_equal_produced():
    assert validate_plan_edit([_ex("l1", 20)], [_in("l1", 20)]) == []
    assert validate_plan_edit([_ex("l1", 20)], [_in("l1", 30)]) == []


def test_cannot_change_recipe_on_produced_line():
    errs = validate_plan_edit([_ex("l1", 5, "r1")], [_in("l1", 50, "r2")])
    assert len(errs) == 1 and "receptur" in errs[0].lower()


def test_new_line_without_id_is_ok():
    assert validate_plan_edit([], [_in("", 40)]) == []


def test_untouched_zero_done_line_removable():
    assert validate_plan_edit([_ex("l1", 0)], []) == []
