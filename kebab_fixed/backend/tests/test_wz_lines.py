from app.services.wz_service import build_wz_lines


def test_valued_computes_value_and_total():
    items = [
        {"name": "Kości", "qty": 600, "unit": "kg", "price": 0.02},
        {"name": "Grzbiety", "qty": 400, "unit": "kg", "price": 0.5},
    ]
    lines, total = build_wz_lines(items, valued=True)
    assert lines[0]["value"] == 12.0   # 600 * 0.02
    assert lines[1]["value"] == 200.0  # 400 * 0.5
    assert total == 212.0


def test_quantity_only_has_no_price_value():
    items = [{"name": "Kebab", "qty": 18, "unit": "kg", "price": 0}]
    lines, total = build_wz_lines(items, valued=False)
    assert lines[0]["price"] is None
    assert lines[0]["value"] is None
    assert total == 0.0


def test_rounding_to_grosze():
    items = [{"name": "X", "qty": 3.333, "unit": "kg", "price": 0.3}]
    lines, total = build_wz_lines(items, valued=True)
    assert lines[0]["value"] == 1.0  # round(0.9999, 2)
    assert total == 1.0


def test_missing_price_treated_as_zero_when_valued():
    items = [{"name": "X", "qty": 10, "unit": "kg"}]
    lines, total = build_wz_lines(items, valued=True)
    assert lines[0]["value"] == 0.0
    assert total == 0.0


def test_empty_items():
    assert build_wz_lines([], valued=True) == ([], 0.0)
