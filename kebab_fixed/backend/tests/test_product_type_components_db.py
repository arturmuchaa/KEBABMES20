"""Testy: RODZAJ produktu jest kanonicznym źródłem składu 70/30 na produkcji.

Skład (np. 70% udo z rozbioru `mat-cwiartka` + 30% filet `mat-filet-kurczak`)
mieszka na product_types.components i steruje alokacją per komponent oraz
etykietą dwupartiową `partiamięsa/partiafileta`. Receptura zostaje fallbackiem
wstecznym.

Czyste testy `_allocate_components` działają zawsze; testy DB wymagają
TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import json

from app.db import execute, transaction
from app.services.production_plans_service import (
    _allocate_components,
    _line_components,
    _product_type_components,
)
from app.utils.ids import now_iso


class _Line:
    """Minimalny stand-in PlanLineCreate — tylko pola czytane przez _line_components."""
    def __init__(self, product_type_id=None, recipe_id=None):
        self.product_type_id = product_type_id
        self.recipe_id = recipe_id


def _seed_product_type(pt_id, comps):
    execute(
        "INSERT INTO product_types (id, name, components, active, created_at) "
        "VALUES (%s,%s,%s::jsonb,true,%s)",
        (pt_id, "Kebab MIX 70/30", json.dumps(comps), now_iso()),
    )


def _seed_recipe(recipe_id, comps):
    execute(
        "INSERT INTO recipes (id, name, components, active, created_at) "
        "VALUES (%s,%s,%s::jsonb,true,%s)",
        (recipe_id, "Receptura", json.dumps(comps), now_iso()),
    )


# ── Czysta alokacja 70/30 + etykieta dwupartiowa (bez DB) ──────────────
def test_allocate_components_70_30_dual_label():
    comps = [
        {"materialTypeId": "mat-cwiartka", "pct": 70},
        {"materialTypeId": "mat-filet-kurczak", "pct": 30},
    ]
    pools = [
        [{"bid": "udo1", "b_no": "170625", "free": 700.0}],   # udo z rozbioru
        [{"bid": "fil1", "b_no": "180625", "free": 300.0}],   # filet
    ]
    alloc = _allocate_components(qty=1000, kg_pu=1.0, components=comps, pools=pools)

    key = "170625/180625"  # partiamięsa/partiafileta
    assert key in alloc
    assert alloc[key]["pieces"] == 1000
    parts = alloc[key]["parts"]
    assert round(parts["170625"]["kg"], 1) == 700.0   # 70%
    assert round(parts["180625"]["kg"], 1) == 300.0   # 30%


# ── Źródło składu z RODZAJU produktu ───────────────────────────────────
def test_product_type_components_reads_material_and_pct(db):
    _seed_product_type("pt1", [
        {"id": "c1", "name": "Udo z kurczaka", "pct": 70, "materialTypeId": "mat-cwiartka"},
        {"id": "c2", "name": "Filet z kurczaka", "pct": 30, "materialTypeId": "mat-filet-kurczak"},
        {"id": "c3", "name": "Pusty", "pct": 0, "materialTypeId": "mat-x"},      # pct=0 → pominięty
        {"id": "c4", "name": "Bez surowca", "pct": 10, "materialTypeId": ""},     # brak material → pominięty
    ])
    with transaction() as conn:
        comps = _product_type_components(conn, "pt1")
    assert [(c["materialTypeId"], c["pct"]) for c in comps] == [
        ("mat-cwiartka", 70.0),
        ("mat-filet-kurczak", 30.0),
    ]


def test_line_components_prefers_product_type_over_recipe(db):
    # Rodzaj ma 2 komponenty (70/30) → wygrywa z komponentami receptury
    _seed_product_type("pt1", [
        {"id": "c1", "name": "Udo", "pct": 70, "materialTypeId": "mat-cwiartka"},
        {"id": "c2", "name": "Filet", "pct": 30, "materialTypeId": "mat-filet-kurczak"},
    ])
    _seed_recipe("r1", [
        {"materialTypeId": "mat-INNE", "pct": 100},
    ])
    line = _Line(product_type_id="pt1", recipe_id="r1")
    with transaction() as conn:
        comps = _line_components(conn, line)
    assert {c["materialTypeId"] for c in comps} == {"mat-cwiartka", "mat-filet-kurczak"}


def test_line_components_falls_back_to_recipe_when_single_component(db):
    # Rodzaj jednoskładnikowy (100% udo) → produkcja idzie starą ścieżką
    # receptury (back-compat). _line_components zwraca komponenty receptury.
    _seed_product_type("pt2", [
        {"id": "c1", "name": "Udo", "pct": 100, "materialTypeId": "mat-cwiartka"},
    ])
    _seed_recipe("r2", [
        {"materialTypeId": "mat-cwiartka", "pct": 60},
        {"materialTypeId": "mat-filet-kurczak", "pct": 40},
    ])
    line = _Line(product_type_id="pt2", recipe_id="r2")
    with transaction() as conn:
        comps = _line_components(conn, line)
    # zwrócono komponenty RECEPTURY (rodzaj miał <2 komponentów)
    assert {c["materialTypeId"] for c in comps} == {"mat-cwiartka", "mat-filet-kurczak"}
    assert sum(c["pct"] for c in comps) == 100.0
