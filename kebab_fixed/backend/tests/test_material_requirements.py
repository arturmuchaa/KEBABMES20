"""Czysta logika zapotrzebowania na surowiec (odwrócenie produkcji)."""
from app.services.material_requirements_service import (
    meat_factor,
    kg_meat_from_output,
    normalize_components,
    requirements_for_line,
    aggregate_meat_need,
    compute_net_shortage,
    MIESO_ZS,
    CWIARTKA,
)

NAMES = {
    "mat-mieso-zs": "Mięso z/s",
    "mat-cwiartka": "Ćwiartka z kurczaka",
    "mat-filet-kurczak": "Filet z kurczaka",
}


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


def test_requirements_for_line_7030_splits_meat_and_raw():
    # 100 kg mięsa (brak dodatków), skład 70/30, yield 50% → ćwiartka = 70/0.5 = 140
    comps = [
        {"materialTypeId": "mat-mieso-zs", "name": "Mięso z/s", "pct": 70},
        {"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 30},
    ]
    rows = requirements_for_line(100.0, [], comps, None, 50.0, NAMES)
    by = {r["meat_type_id"]: r for r in rows}
    # mięso z/s: 70 kg mięsa → ćwiartka 140 kg, requires_deboning
    assert by["mat-mieso-zs"]["kg_meat"] == 70.0
    assert by["mat-mieso-zs"]["raw_type_id"] == CWIARTKA
    assert by["mat-mieso-zs"]["requires_deboning"] is True
    assert by["mat-mieso-zs"]["kg_raw"] == 140.0
    # filet: 30 kg mięsa → 30 kg surowca 1:1, bez rozbioru
    assert by["mat-filet-kurczak"]["kg_meat"] == 30.0
    assert by["mat-filet-kurczak"]["raw_type_id"] == "mat-filet-kurczak"
    assert by["mat-filet-kurczak"]["requires_deboning"] is False
    assert by["mat-filet-kurczak"]["kg_raw"] == 30.0


def test_requirements_for_line_single_component_mieso_zs():
    # brak składu → cały kg_meat jako mięso z/s; yield 70% → ćwiartka 100/0.7
    rows = requirements_for_line(100.0, [], [], None, 70.0, NAMES)
    assert len(rows) == 1
    assert rows[0]["raw_type_id"] == CWIARTKA
    assert rows[0]["kg_raw"] == round(100.0 / 0.7, 3)


def test_aggregate_meat_need_sums_by_meat_type():
    l1 = requirements_for_line(100.0, [], [
        {"materialTypeId": "mat-mieso-zs", "name": "", "pct": 70},
        {"materialTypeId": "mat-filet-kurczak", "name": "", "pct": 30},
    ], None, 70.0, NAMES)
    l2 = requirements_for_line(100.0, [], [], None, 70.0, NAMES)  # 100 kg mięso z/s
    need = aggregate_meat_need([l1, l2])
    assert need["mat-mieso-zs"] == 170.0
    assert need["mat-filet-kurczak"] == 30.0


def test_compute_net_shortage_cascade_uses_mieso_zs_first_then_cwiartka():
    # potrzeba 170 kg mięsa z/s; magazyn: 50 kg mięsa z/s, 100 kg ćwiartki; yield 50%
    need = {"mat-mieso-zs": 170.0}
    stock = {"mat-mieso-zs": 50.0, "mat-cwiartka": 100.0}
    rows = compute_net_shortage(need, stock, 50.0, NAMES)
    by = {r["raw_type_id"]: r for r in rows}
    # brak mięsa z/s = 170-50 = 120 → ćwiartka = 120/0.5 = 240; netto = 240-100 = 140
    assert by[CWIARTKA]["kg_needed_raw"] == 240.0
    assert by[CWIARTKA]["kg_available"] == 100.0
    assert by[CWIARTKA]["kg_net_shortage"] == 140.0


def test_compute_net_shortage_filet_1to1_against_stock():
    need = {"mat-filet-kurczak": 30.0}
    stock = {"mat-filet-kurczak": 12.0}
    rows = compute_net_shortage(need, stock, 70.0, NAMES)
    by = {r["raw_type_id"]: r for r in rows}
    assert by["mat-filet-kurczak"]["kg_net_shortage"] == 18.0


def test_compute_net_shortage_never_negative():
    need = {"mat-filet-kurczak": 5.0}
    stock = {"mat-filet-kurczak": 50.0}
    rows = compute_net_shortage(need, stock, 70.0, NAMES)
    by = {r["raw_type_id"]: r for r in rows}
    assert by["mat-filet-kurczak"]["kg_net_shortage"] == 0.0


# ── Task 3: wybór współczynnika wydajności rozbioru ──────────────────────
from app.services.settings_service import resolve_yield_pct


def test_resolve_yield_prefers_saved_value():
    assert resolve_yield_pct(saved=65.0, historical_avg=80.0) == 65.0


def test_resolve_yield_falls_back_to_historical_when_unset():
    assert resolve_yield_pct(saved=None, historical_avg=72.5) == 72.5


def test_resolve_yield_defaults_to_70_when_no_data():
    assert resolve_yield_pct(saved=None, historical_avg=None) == 70.0


def test_resolve_yield_ignores_out_of_range_saved():
    # poza (0,100] → traktuj jak brak, użyj historycznej / domyślnej
    assert resolve_yield_pct(saved=0.0, historical_avg=None) == 70.0
    assert resolve_yield_pct(saved=150.0, historical_avg=None) == 70.0
