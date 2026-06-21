"""Czysta logika zapotrzebowania na surowiec (odwrócenie produkcji)."""
from app.services.material_requirements_service import (
    meat_factor,
    kg_meat_from_output,
    normalize_components,
    MIESO_ZS,
)


def test_meat_factor_sums_only_kg_and_l_ingredients():
    ings = [
        {"qty_per_100kg": 10, "unit": "kg"},      # liczy się
        {"qty_per_100kg": 2, "unit": "l"},        # liczy się
        {"qty_per_100kg": 50, "unit": "g"},       # pomijane (g)
        {"qty_per_100kg": 5, "unit": "ml", "is_unlimited": True},  # liczy się (unlimited)
    ]
    assert meat_factor(ings) == (10 + 2 + 5) / 100.0


def test_kg_meat_from_output_inverts_yield():
    # output = kg_meat * (1 + 0.17); dla 117 kg output → 100 kg mięsa
    ings = [{"qty_per_100kg": 17, "unit": "kg"}]
    assert kg_meat_from_output(117.0, ings) == 100.0


def test_kg_meat_from_output_no_ingredients_is_one_to_one():
    assert kg_meat_from_output(40.0, []) == 40.0


def test_kg_meat_from_output_zero_output_is_zero():
    assert kg_meat_from_output(0.0, [{"qty_per_100kg": 17, "unit": "kg"}]) == 0.0


def test_normalize_components_empty_defaults_to_single_mieso_zs():
    comps = normalize_components([], None)
    assert comps == [{"material_type_id": MIESO_ZS, "name": "Mięso z/s", "pct": 100.0}]


def test_normalize_components_uses_fallback_when_primary_empty():
    fallback = [{"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 100}]
    comps = normalize_components([], fallback)
    assert comps == [{"material_type_id": "mat-filet-kurczak", "name": "Filet", "pct": 100.0}]


def test_normalize_components_drops_zero_pct_and_reads_camel():
    comps = normalize_components(
        [{"materialTypeId": MIESO_ZS, "name": "Mięso z/s", "pct": 70},
         {"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 30},
         {"materialTypeId": "x", "name": "x", "pct": 0}],
    )
    assert comps == [
        {"material_type_id": MIESO_ZS, "name": "Mięso z/s", "pct": 70.0},
        {"material_type_id": "mat-filet-kurczak", "name": "Filet", "pct": 30.0},
    ]
