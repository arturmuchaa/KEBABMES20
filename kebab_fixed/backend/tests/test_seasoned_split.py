"""Czysta logika rozdzielenia zlanej partii przyprawionego (korekta danych 364)."""
from app.services.seasoned_meat_service import split_seasoned_sessions


# Dane z produkcji dla batch_no='364' (recipe_name, dzień, kg_output)
SESSIONS_364 = [
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-12", "kg_output": 720.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 720.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 240.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 2880.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-13", "kg_output": 240.0},
    {"recipe_id": "g2", "recipe_name": "Gold2",      "day": "2026-06-16", "kg_output": 360.0},
    {"recipe_id": "gk", "recipe_name": "GOLD KEBAB", "day": "2026-06-16", "kg_output": 250.2},
    {"recipe_id": "gk", "recipe_name": "GOLD KEBAB", "day": "2026-06-16", "kg_output": 250.2},
]


def test_groups_by_recipe_and_day():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=720.0)
    summary = [(g["recipe_name"], g["production_day"], g["kg_produced"]) for g in groups]
    assert summary == [
        ("Gold2", "2026-06-12", 720.0),
        ("Gold2", "2026-06-13", 4080.0),
        ("Gold2", "2026-06-16", 360.0),
        ("GOLD KEBAB", "2026-06-16", 500.4),
    ]


def test_used_attributed_fefo_earliest_day_first():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=720.0)
    avail = {(g["recipe_name"], g["production_day"]): g["kg_available"] for g in groups}
    used = {(g["recipe_name"], g["production_day"]): g["kg_used"] for g in groups}
    assert used[("Gold2", "2026-06-12")] == 720.0
    assert avail[("Gold2", "2026-06-12")] == 0.0
    assert avail[("Gold2", "2026-06-13")] == 4080.0
    assert avail[("GOLD KEBAB", "2026-06-16")] == 500.4


def test_sum_available_matches_total():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=720.0)
    assert round(sum(g["kg_available"] for g in groups), 3) == 4940.4
    assert round(sum(g["kg_produced"] for g in groups), 3) == 5660.4


def test_no_used_leaves_all_available():
    groups = split_seasoned_sessions(SESSIONS_364, kg_used_total=0.0)
    assert all(g["kg_used"] == 0.0 for g in groups)
    assert round(sum(g["kg_available"] for g in groups), 3) == 5660.4
