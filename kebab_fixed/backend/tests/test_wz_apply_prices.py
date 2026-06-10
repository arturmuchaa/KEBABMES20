from app.services.wz_service import apply_wz_prices


def _lines():
    return [
        {"name": "Kebab A", "qty": 10, "unit": "szt", "price": None, "value": None},
        {"name": "Kebab B", "qty": 4, "unit": "szt", "price": None, "value": None},
    ]


def test_applies_prices_and_totals():
    lines, total = apply_wz_prices(_lines(), [{"index": 0, "price": 2.5}, {"index": 1, "price": 10}])
    assert lines[0]["price"] == 2.5 and lines[0]["value"] == 25.0
    assert lines[1]["price"] == 10.0 and lines[1]["value"] == 40.0
    assert total == 65.0


def test_partial_prices_total_counts_only_priced():
    lines, total = apply_wz_prices(_lines(), [{"index": 1, "price": 1}])
    assert lines[0]["price"] is None and lines[0]["value"] is None
    assert total == 4.0


def test_out_of_range_index_ignored():
    lines, total = apply_wz_prices(_lines(), [{"index": 5, "price": 9}, {"index": -1, "price": 9}])
    assert all(l["price"] is None for l in lines)
    assert total == 0.0


def test_does_not_mutate_input():
    src = _lines()
    apply_wz_prices(src, [{"index": 0, "price": 3}])
    assert src[0]["price"] is None
