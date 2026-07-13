"""Walidacja edycji planu produkcji — wyprodukowane pozycje są ZAMROŻONE."""
from app.services.production_plans_service import validate_plan_edit


def _ex(id, qty_done, qty=None, recipe_id="r1", batch_ids=("b1",)):
    return {
        "id": id, "qty_done": qty_done,
        "qty": qty if qty is not None else qty_done,
        "recipe_id": recipe_id, "batch_ids": list(batch_ids),
    }


def _in(id, qty, recipe_id="r1", batch_ids=("b1",)):
    return {"id": id, "qty": qty, "recipe_id": recipe_id, "batch_ids": list(batch_ids)}


def test_no_produced_lines_anything_goes():
    assert validate_plan_edit([_ex("l1", 0, qty=10)], [_in("l1", 50)]) == []


def test_cannot_delete_produced_line():
    errs = validate_plan_edit([_ex("l1", 10)], [])
    assert len(errs) == 1 and "usun" in errs[0].lower()


def test_cannot_change_qty_on_produced_line():
    errs = validate_plan_edit([_ex("l1", 20, qty=20)], [_in("l1", 30)])
    assert len(errs) == 1 and "ilo" in errs[0].lower()


def test_same_qty_produced_ok():
    assert validate_plan_edit([_ex("l1", 20, qty=20)], [_in("l1", 20)]) == []


def test_cannot_change_recipe_on_produced_line():
    errs = validate_plan_edit(
        [_ex("l1", 5, qty=5, recipe_id="r1")], [_in("l1", 5, recipe_id="r2")]
    )
    assert len(errs) == 1 and "receptur" in errs[0].lower()


def test_cannot_change_batches_on_produced_line():
    errs = validate_plan_edit(
        [_ex("l1", 5, qty=5, batch_ids=("b1",))], [_in("l1", 5, batch_ids=("b2",))]
    )
    assert len(errs) == 1 and "parti" in errs[0].lower()


def test_same_batches_different_order_ok():
    assert validate_plan_edit(
        [_ex("l1", 5, qty=5, batch_ids=("b1", "b2"))],
        [_in("l1", 5, batch_ids=("b2", "b1"))],
    ) == []


def test_new_line_without_id_is_ok():
    assert validate_plan_edit([], [_in("", 40)]) == []


def test_untouched_zero_done_line_removable():
    assert validate_plan_edit([_ex("l1", 0, qty=10)], []) == []
