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


def test_group_sorted_by_weight_desc_within_recipe():
    units = (
        [_u(pt="GOLD KEBAB", w=15)] * 1
        + [_u(pt="GOLD KEBAB", w=50)] * 1
        + [_u(pt="GOLD KEBAB", w=30)] * 1
        + [_u(pt="GOLD KEBAB", w=40)] * 1
    )
    items = group_hdi_items(units)
    assert [i["name"] for i in items] == [
        "GOLD KEBAB 50KG", "GOLD KEBAB 40KG", "GOLD KEBAB 30KG", "GOLD KEBAB 15KG"]


def test_group_two_recipes_each_sorted_desc():
    units = [
        _u(pt="GOLD KEBAB", w=20), _u(pt="GOLD KEBAB", w=40),
        _u(pt="DROB KEBAB", w=10), _u(pt="DROB KEBAB", w=30),
    ]
    items = group_hdi_items(units)
    assert [i["name"] for i in items] == [
        "DROB KEBAB 30KG", "DROB KEBAB 10KG", "GOLD KEBAB 40KG", "GOLD KEBAB 20KG"]


def test_group_batches_sorted_by_qty_desc():
    units = (
        [_u(w=20, batch="325", pd="2026-05-30")] * 74
        + [_u(w=20, batch="332", pd="2026-05-29")] * 6
    )
    items = group_hdi_items(units)
    assert len(items) == 1
    batches = items[0]["batches"]
    assert [b["qty"] for b in batches] == [74, 6]
    assert batches[0]["partia"] == "300526 325"


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


def test_build_hdi_from_wz_grupuje_partie_surowca(db):
    """HDI z WZ surowcowego: pozycje per rodzaj, partie per linia z kg
    i terminem ważności partii surowca (WZ celowo nie ma kolumny partii)."""
    from app.db import execute
    from app.services.wz_service import create_manual_wz
    from app.services.hdi_service import build_hdi_from_wz, generate_hdi_for_wz
    from app.utils.ids import now_iso

    for bid, no, exp in [("rbA", "404", "2026-07-15"), ("rbB", "405", "2026-07-16")]:
        execute(
            "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name, "
            "kg_received, kg_available, status, material_type_id, material_name, expiry_date, created_at) "
            "VALUES (%s,%s,%s,'Dostawca',2000,2000,'active','mat-cwiartka','Ćwiartka',%s,%s)",
            (bid, no, int(no), exp, now_iso()),
        )
    execute(
        "INSERT INTO byproduct_lots (id, deboning_entry_id, raw_batch_id, raw_batch_no, kind, kg, status, created_at) "
        "VALUES ('lot1', NULL, 'rbA', '404', 'bones', 993, 'open', now()), "
        "('lot2', NULL, 'rbB', '405', 'bones', 1077.5, 'open', now())"
    )
    wz = create_manual_wz(
        buyer={"name": "Skup Kości Sp. z o.o.", "nip": "PL5252248481"},
        selections=[
            {"stock_type": "byproduct", "stock_id": "lot1", "name": "Kości", "unit": "kg",
             "qty": 993, "price": 1, "batch_no": "404", "containers": 7},
            {"stock_type": "byproduct", "stock_id": "lot2", "name": "Kości", "unit": "kg",
             "qty": 1077.5, "price": 1, "batch_no": "405", "containers": 8},
        ],
    )
    data = build_hdi_from_wz(wz["id"])
    assert len(data["items"]) == 1
    it = data["items"][0]
    assert it["name"] == "Kości" and it["qty"] == 15 and it["kg"] == 2070.5
    partie = {b["partia"]: b for b in it["batches"]}
    assert partie["404"]["qty"] == 7 and partie["404"]["termin"] == "15.07.2026"
    assert partie["405"]["kg"] == 1077.5
    # idempotencja per WZ: drugi generate zwraca ten sam numer
    h1 = generate_hdi_for_wz(wz["id"])
    h2 = generate_hdi_for_wz(wz["id"])
    assert h1["number"] == h2["number"] and h1["id"] == h2["id"]
