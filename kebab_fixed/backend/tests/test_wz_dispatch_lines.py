from app.services.wz_service import build_dispatch_wz_lines


def test_groups_to_quantity_lines():
    groups = {
        ("2026-06-01", "K123", "r1"): {"count": 10, "kg": 200.0},
        ("2026-06-01", "K124", "r2"): {"count": 4, "kg": 60.0},
    }
    lines = build_dispatch_wz_lines(groups, {"r1": "Kebab drobiowy", "r2": "Kebab wołowy"})
    assert len(lines) == 2
    by_batch = {l["batch_no"]: l for l in lines}
    assert by_batch["K123"]["name"] == "Kebab drobiowy"
    assert by_batch["K123"]["qty"] == 10
    assert by_batch["K123"]["unit"] == "szt"
    assert by_batch["K123"]["price"] is None and by_batch["K123"]["value"] is None
    assert by_batch["K123"]["stock_type"] == "fg"


def test_recipe_name_fallback():
    groups = {("2026-06-01", "K1", "rX"): {"count": 1, "kg": 20.0}}
    lines = build_dispatch_wz_lines(groups, {})
    assert lines[0]["name"] == "Kebab"


def test_stable_order_by_name_then_batch():
    groups = {
        ("d", "B2", "r1"): {"count": 1, "kg": 1.0},
        ("d", "B1", "r1"): {"count": 1, "kg": 1.0},
        ("d", "A1", "r2"): {"count": 1, "kg": 1.0},
    }
    lines = build_dispatch_wz_lines(groups, {"r1": "B-kebab", "r2": "A-kebab"})
    assert [(l["name"], l["batch_no"]) for l in lines] == [
        ("A-kebab", "A1"), ("B-kebab", "B1"), ("B-kebab", "B2")]


def test_empty_groups():
    assert build_dispatch_wz_lines({}, {}) == []
