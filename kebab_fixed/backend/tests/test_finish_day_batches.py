from app.services.finished_goods_service import entry_batch_portions


def test_portions_split_clean_allocation():
    # 24 szt: 6 z 346, 18 z 347 → dwie porcje per partia
    portions = entry_batch_portions(24, {"346": {"pieces": 6, "kg": 120.0},
                                         "347": {"pieces": 18, "kg": 360.0}})
    by = {p["batch_no"]: p["qty"] for p in portions}
    assert by == {"346": 6, "347": 18}


def test_portions_single_batch():
    portions = entry_batch_portions(10, {"346": {"pieces": 10, "kg": 200.0}})
    assert portions == [{"batch_no": "346", "qty": 10}]


def test_portions_ignores_zero_piece_batch():
    portions = entry_batch_portions(10, {"349": {"pieces": 10}, "PP1": {"pieces": 0}})
    assert portions == [{"batch_no": "349", "qty": 10}]


def test_portions_empty_when_sum_mismatch():
    # częściowe zamknięcie / niespójna alokacja → [] (tryb łączony / fallback)
    assert entry_batch_portions(20, {"346": {"pieces": 6}, "347": {"pieces": 18}}) == []


def test_portions_empty_when_no_allocation():
    assert entry_batch_portions(10, {}) == []
    assert entry_batch_portions(10, None) == []
