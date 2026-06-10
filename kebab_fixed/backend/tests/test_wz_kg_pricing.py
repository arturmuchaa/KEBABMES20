from app.services.wz_service import apply_wz_prices, build_manual_wz_lines, build_wz_lines


def test_fg_lines_priced_per_kg():
    # GOLD KEBAB 40kg: 10 szt → 400 kg × 3.30 = 1320.00
    # GOLD KEBAB 30kg: 30 szt → 900 kg × 3.30 = 2970.00
    items = [
        {"name": "GOLD KEBAB", "qty": 10, "unit": "szt", "price": 3.30, "kg_per_unit": 40},
        {"name": "GOLD KEBAB", "qty": 30, "unit": "szt", "price": 3.30, "kg_per_unit": 30},
    ]
    lines, total = build_wz_lines(items, valued=True)
    assert lines[0]["total_kg"] == 400 and lines[0]["value"] == 1320.00
    assert lines[1]["total_kg"] == 900 and lines[1]["value"] == 2970.00
    assert total == 4290.00


def test_lines_without_kg_keep_per_unit_pricing():
    # Surowiec sprzedawany w kg: qty już jest wagą, brak kg_per_unit
    items = [{"name": "Surowiec X", "qty": 120, "unit": "kg", "price": 8.50}]
    lines, total = build_wz_lines(items, valued=True)
    assert "total_kg" not in lines[0]
    assert lines[0]["value"] == 1020.00 and total == 1020.00


def test_unvalued_lines_still_carry_weight():
    items = [{"name": "GOLD KEBAB", "qty": 5, "unit": "szt", "kg_per_unit": 40}]
    lines, total = build_wz_lines(items, valued=False)
    assert lines[0]["total_kg"] == 200
    assert lines[0]["price"] is None and lines[0]["value"] is None
    assert total == 0


def test_manual_lines_pass_kg_per_unit_through():
    selections = [{
        "stock_type": "fg", "stock_id": "abc", "name": "GOLD KEBAB",
        "qty": 10, "unit": "szt", "price": 3.30, "batch_no": "349", "kg_per_unit": 40,
    }]
    lines, total = build_manual_wz_lines(selections, valued=True)
    assert lines[0]["total_kg"] == 400 and lines[0]["value"] == 1320.00
    assert lines[0]["stock_id"] == "abc"
    assert total == 1320.00


def test_apply_prices_uses_total_kg_when_present():
    lines = [
        {"name": "GOLD KEBAB", "qty": 10, "unit": "szt", "total_kg": 400, "price": None, "value": None},
        {"name": "Surowiec", "qty": 50, "unit": "kg", "price": None, "value": None},
    ]
    out, total = apply_wz_prices(lines, [{"index": 0, "price": 3.30}, {"index": 1, "price": 2.00}])
    assert out[0]["value"] == 1320.00   # 400 kg × 3.30
    assert out[1]["value"] == 100.00    # 50 × 2.00 (bez wagi — po staremu)
    assert total == 1420.00
