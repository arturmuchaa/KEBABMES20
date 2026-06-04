from app.services.hdi_service import _product_label, group_hdi_items, format_hdi_number


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
