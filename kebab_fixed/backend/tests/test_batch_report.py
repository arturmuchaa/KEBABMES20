from app.utils.batch_numbers import classify_batch_type
from app.services.batch_report_service import build_composition


def test_classify_single_batch():
    # 'ddmmrr 326' → pojedyncza
    assert classify_batch_type("060626 326") == "single"


def test_classify_mixer_combined():
    # PP = mieszalnik
    assert classify_batch_type("060626 PP1") == "mixer"


def test_classify_production_combined():
    # PPP = produkcja
    assert classify_batch_type("060626 PPP1") == "production"


def test_classify_bare_code_without_date():
    assert classify_batch_type("PPP3") == "production"
    assert classify_batch_type("PP3") == "mixer"
    assert classify_batch_type("326") == "single"


def test_build_composition_from_allocation():
    # allocation = {bno: {"kg":, "pieces":}} → lista rodziców z kg
    alloc = {"349": {"kg": 1300.0, "pieces": 26}, "PP1": {"kg": 200.0, "pieces": 4}}
    out = build_composition(["349", "PP1"], alloc)
    assert out == [
        {"batch_no": "349", "kg": 1300.0, "pieces": 26},
        {"batch_no": "PP1", "kg": 200.0, "pieces": 4},
    ]


def test_build_composition_missing_alloc_uses_none():
    # brak alokacji dla partii → kg/pieces = None (nie zgadujemy)
    out = build_composition(["357", "358"], {})
    assert out == [
        {"batch_no": "357", "kg": None, "pieces": None},
        {"batch_no": "358", "kg": None, "pieces": None},
    ]
