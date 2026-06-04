from app.services.cmr_service import (
    aggregate_kebab_line,
    build_goods,
    cmr_totals,
)


def _line(qty_done, kg):
    return {"qty_done": qty_done, "kg_per_unit": kg}


def test_aggregate_kebab_line_sums_qty_and_kg():
    line = aggregate_kebab_line([_line(30, 50), _line(20, 40), _line(0, 10)])
    assert line["name"] == "KEBAB MROŻONY"
    assert line["qty"] == 50           # 30+20 (pomijamy qty_done=0)
    assert line["kg"] == 30 * 50 + 20 * 40  # 2300.0
    assert line["auto"] is True


def test_aggregate_kebab_line_empty_when_no_production():
    assert aggregate_kebab_line([]) is None
    assert aggregate_kebab_line([_line(0, 50)]) is None


def test_build_goods_merges_auto_and_manual():
    plan = [_line(10, 50)]
    manual = [{"name": "Jogurt", "qty": 12, "kg": 6.0},
              {"name": "Tortille", "qty": 5, "kg": 2.5}]
    goods = build_goods(plan, manual)
    assert goods[0]["name"] == "KEBAB MROŻONY" and goods[0]["qty"] == 10
    assert goods[1] == {"name": "Jogurt", "qty": 12, "kg": 6.0}
    assert goods[2] == {"name": "Tortille", "qty": 5, "kg": 2.5}


def test_build_goods_only_manual_when_no_kebab():
    goods = build_goods([], [{"name": "Bułki", "qty": 100, "kg": 8.0}])
    assert len(goods) == 1 and goods[0]["name"] == "Bułki"


def test_cmr_totals_gross_kg_is_sum():
    goods = [{"name": "KEBAB MROŻONY", "qty": 10, "kg": 500.0},
             {"name": "Jogurt", "qty": 12, "kg": 6.0}]
    assert cmr_totals(goods) == {"qty": 22, "kg": 506.0}
