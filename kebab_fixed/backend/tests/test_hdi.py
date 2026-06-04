from app.services.hdi_service import (
    _product_label,
    group_hdi_items,
    format_hdi_number,
    units_from_plan_lines,
)


def test_product_label():
    assert _product_label("KEBAB", 40.0) == "KEBAB 40KG"
    assert _product_label("KEBAB UDO", 30) == "KEBAB UDO 30KG"


def test_format_hdi_number():
    assert format_hdi_number(15, "2605") == "15/05/26"


def _u(pt="KEBAB", w=40, batch="326", pd="2026-05-29", shelf=365):
    return {"product_type_name": pt, "weight_kg": w, "batch_no": batch,
            "produced_date": pd, "shelf_life_days": shelf}


def test_group_two_products():
    items = group_hdi_items([_u(pt="KEBAB", w=40), _u(pt="KEBAB", w=30)])
    names = {i["name"] for i in items}
    assert names == {"KEBAB 40KG", "KEBAB 30KG"}
    assert all(i["qty"] == 1 for i in items)


def test_group_sums_and_batches():
    items = group_hdi_items([
        _u(w=40, batch="326", pd="2026-05-29"),
        _u(w=40, batch="326", pd="2026-05-29"),
        _u(w=40, batch="332", pd="2026-05-30"),
    ])
    assert len(items) == 1
    it = items[0]
    assert it["name"] == "KEBAB 40KG" and it["qty"] == 3 and it["kg"] == 120.0
    assert len(it["batches"]) == 2
    b = {x["partia"]: x for x in it["batches"]}
    assert "290526 326" in b and b["290526 326"]["qty"] == 2
    assert b["290526 326"]["termin"] == "29.05.2027"


def test_group_empty():
    assert group_hdi_items([]) == []


def _line(qty_done=2, kg=40, recipe_id="r1", recipe_name="GOLD KEBAB",
          ba=None, sbn=None, pd="2026-05-27T11:43:47+00:00"):
    return {"qty_done": qty_done, "kg_per_unit": kg, "recipe_id": recipe_id,
            "recipe_name": recipe_name, "product_type_name": None,
            "batch_allocation": ba,
            "seasoned_batch_no": (sbn[0] if sbn else None),
            "seasoned_batch_nos": sbn, "progress_updated_at": pd}


def test_units_from_plan_lines_allocation_splits_pieces():
    lines = [_line(qty_done=30, kg=50,
                   ba={"349": {"pieces": 26}, "PP1": {"pieces": 4}},
                   sbn=["PP1", "349"])]
    units = units_from_plan_lines(lines, {"r1": 365})
    assert len(units) == 30
    assert sum(1 for u in units if u["batch_no"] == "349") == 26
    assert sum(1 for u in units if u["batch_no"] == "PP1") == 4
    assert all(u["product_type_name"] == "GOLD KEBAB" for u in units)
    assert all(u["weight_kg"] == 50 for u in units)
    assert all(u["produced_date"] == "2026-05-27" for u in units)
    assert all(u["shelf_life_days"] == 365 for u in units)


def test_units_from_plan_lines_single_batch():
    lines = [_line(qty_done=40, kg=10, ba={"MP209": {"pieces": 40}}, sbn=["MP209"])]
    units = units_from_plan_lines(lines, {"r1": 365})
    assert len(units) == 40
    assert all(u["batch_no"] == "MP209" for u in units)


def test_units_from_plan_lines_no_allocation_uses_seasoned():
    lines = [_line(qty_done=5, kg=20, ba=None, sbn=["349"])]
    units = units_from_plan_lines(lines, {"r1": 0})
    assert len(units) == 5
    assert all(u["batch_no"] == "349" for u in units)


def test_units_from_plan_lines_skips_zero_done():
    assert units_from_plan_lines([_line(qty_done=0)], {}) == []


def test_units_allocation_mismatch_falls_back_to_qty_done():
    # allocation total (26) != qty_done (10) → single bucket of qty_done
    lines = [_line(qty_done=10, kg=20, ba={"349": {"pieces": 26}}, sbn=["349"])]
    units = units_from_plan_lines(lines, {"r1": 0})
    assert len(units) == 10
    assert all(u["batch_no"] == "349" for u in units)


def test_units_partial_production_grouped_to_hdi_items():
    # 40x10 done fully + 30x50 only 12 produced → HDI reflects actual produced
    lines = [
        _line(qty_done=40, kg=10, ba={"MP209": {"pieces": 40}}, sbn=["MP209"]),
        _line(qty_done=12, kg=50, ba=None, sbn=["349"]),
    ]
    items = group_hdi_items(units_from_plan_lines(lines, {"r1": 365}))
    by_name = {i["name"]: i for i in items}
    assert by_name["GOLD KEBAB 10KG"]["qty"] == 40
    assert by_name["GOLD KEBAB 50KG"]["qty"] == 12
