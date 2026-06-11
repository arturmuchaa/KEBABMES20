from app.services.finished_goods_service import entry_batch_portions


def test_portions_split_clean_allocation():
    # 24 szt: 6 z 346, 18 z 347 → dwie porcje per partia
    portions = entry_batch_portions(24, {"346": {"pieces": 6, "kg": 120.0},
                                         "347": {"pieces": 18, "kg": 360.0}})
    by = {p["batch_no"]: p["qty"] for p in portions}
    assert by == {"346": 6, "347": 18}


def test_portions_single_batch():
    portions = entry_batch_portions(10, {"346": {"pieces": 10, "kg": 200.0}})
    assert portions == [{"batch_no": "346", "qty": 10, "source_nos": ["346"]}]


def test_portions_ignores_zero_piece_batch():
    portions = entry_batch_portions(10, {"349": {"pieces": 10}, "PP1": {"pieces": 0}})
    assert portions == [{"batch_no": "349", "qty": 10, "source_nos": ["349"]}]


def test_portions_empty_when_sum_mismatch():
    # częściowe zamknięcie / niespójna alokacja → [] (tryb łączony / fallback)
    assert entry_batch_portions(20, {"346": {"pieces": 6}, "347": {"pieces": 18}}) == []


def test_portions_empty_when_no_allocation():
    assert entry_batch_portions(10, {}) == []
    assert entry_batch_portions(10, None) == []


def test_portions_mixed_bucket_pm():
    # 20 szt: 19 czystych z 347 + 1 MIESZANA (PM1 = 1 kg z 346 + 19 kg z 347)
    # → porcja PM1 z partiami źródłowymi w source_nos (lineage)
    portions = entry_batch_portions(20, {
        "346": {"pieces": 0, "kg": 0, "batch_id": "a"},
        "347": {"pieces": 19, "kg": 380.0, "batch_id": "b"},
        "PM1": {"pieces": 1, "kg": 20.0, "parts": {
            "346": {"kg": 1.0, "batch_id": "a"},
            "347": {"kg": 19.0, "batch_id": "b"},
        }},
    })
    by = {p["batch_no"]: p for p in portions}
    assert by["347"]["qty"] == 19
    assert by["PM1"]["qty"] == 1
    assert sorted(by["PM1"]["source_nos"]) == ["346", "347"]
    assert "346" not in by  # 0 całych sztuk → bez własnej porcji
