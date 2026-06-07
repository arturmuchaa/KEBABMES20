from app.services.wz_service import build_manual_wz_lines


def test_maps_stock_fields_and_values():
    sel = [
        {"stock_type": "fg", "stock_id": "g1", "name": "Kebab", "unit": "szt", "qty": 18, "price": 10, "batch_no": "347"},
        {"stock_type": "raw", "stock_id": "r1", "name": "Ćwiartka", "unit": "kg", "qty": 100, "price": 5, "batch_no": "350"},
    ]
    lines, total = build_manual_wz_lines(sel, valued=True)
    assert lines[0]["unit"] == "szt" and lines[0]["value"] == 180.0
    assert lines[0]["stock_type"] == "fg" and lines[0]["stock_id"] == "g1" and lines[0]["batch_no"] == "347"
    assert lines[1]["unit"] == "kg" and lines[1]["value"] == 500.0
    assert lines[1]["stock_type"] == "raw" and lines[1]["stock_id"] == "r1"
    assert total == 680.0


def test_not_valued_no_prices():
    sel = [{"stock_type": "fg", "stock_id": "g1", "name": "Kebab", "unit": "szt", "qty": 5, "price": 10}]
    lines, total = build_manual_wz_lines(sel, valued=False)
    assert lines[0]["price"] is None and lines[0]["value"] is None
    assert total == 0.0
