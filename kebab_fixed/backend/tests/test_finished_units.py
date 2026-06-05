from app.services.finished_units_service import batch_sequence


def test_batch_sequence_splits_per_allocation():
    # 24 szt: 6 z partii 346, 18 z partii 347 (jak ustawione w planowaniu)
    seq = batch_sequence(24, {"346": {"pieces": 6}, "347": {"pieces": 18}},
                         "346", ["346", "347"])
    assert len(seq) == 24
    assert seq.count("346") == 6
    assert seq.count("347") == 18


def test_batch_sequence_single_when_no_allocation():
    seq = batch_sequence(10, None, "346", ["346"])
    assert seq == ["346"] * 10


def test_batch_sequence_fallback_when_allocation_mismatch():
    # suma alokacji (5) != qty (10) → cała partia do jednego wsadu (bezpieczny fallback)
    seq = batch_sequence(10, {"346": {"pieces": 5}}, "346", ["346"])
    assert seq == ["346"] * 10


def test_batch_sequence_uses_seasoned_nos_when_no_singular():
    seq = batch_sequence(3, {}, None, ["349"])
    assert seq == ["349"] * 3


def test_batch_sequence_three_batches():
    seq = batch_sequence(30, {"349": {"pieces": 26}, "PP1": {"pieces": 4}},
                         "PP1", ["PP1", "349"])
    assert len(seq) == 30
    assert seq.count("349") == 26
    assert seq.count("PP1") == 4
