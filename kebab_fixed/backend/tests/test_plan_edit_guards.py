"""Walidacja edycji planu produkcji — wyprodukowane pozycje są ZAMROŻONE.

Partii nie porównujemy (payload nie niesie pełnego zbioru dla multi/70-30,
a alokacja zamrożonej pozycji i tak idzie z bazy). Blokujemy usunięcie oraz
zmianę ilości/receptury pozycji rozpoczętej.
"""
from app.services.production_plans_service import validate_plan_edit


def _ex(id, qty_done, qty=None, recipe_id="r1"):
    return {
        "id": id, "qty_done": qty_done,
        "qty": qty if qty is not None else qty_done, "recipe_id": recipe_id,
    }


def _in(id, qty, recipe_id="r1"):
    return {"id": id, "qty": qty, "recipe_id": recipe_id}


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


def test_batches_not_compared_untouched_produced_line_passes():
    # Kluczowe: pozycja rozpoczęta o niezmienionej ilości/recepturze NIE jest
    # blokowana, choćby payload nie niósł pełnego zbioru partii (70/30).
    assert validate_plan_edit([_ex("l1", 5, qty=5)], [_in("l1", 5)]) == []


def test_new_line_without_id_is_ok():
    assert validate_plan_edit([], [_in("", 40)]) == []


def test_untouched_zero_done_line_removable():
    assert validate_plan_edit([_ex("l1", 0, qty=10)], []) == []
