"""Kebab komponentowy (np. 70/30): sztuka składana CELOWO z kilku partii
(po jednej na komponent) → partia wyrobu "355/356". Resztkowe sztuki,
w których udział komponentu dosztukowano z 2 partii → kubełek MIXED (PM).
"""
from app.services.production_plans_service import (
    MIXED_KEY,
    _allocate_components,
    _allocation_kg_per_batch,
)

COMPS = [
    {"materialTypeId": "mat-cwiartka", "materialName": "Ćwiartka", "pct": 70},
    {"materialTypeId": "mat-filet-kurczak", "materialName": "Filet", "pct": 30},
]


def _pool(*rows):
    return [{"bid": r[0], "b_no": r[1], "free": float(r[2])} for r in rows]


def test_basic_70_30_single_batches():
    # 10 szt × 20 kg = 140 kg ćwiartki (355) + 60 kg filetu (356)
    pools = [_pool(("a", "355", 200.0)), _pool(("f", "356", 100.0))]
    alloc = _allocate_components(10, 20.0, COMPS, pools)
    assert list(alloc.keys()) == ["355/356"]
    g = alloc["355/356"]
    assert g["pieces"] == 10
    assert g["kg"] == 200.0
    assert g["parts"]["355"] == {"kg": 140.0, "batch_id": "a"}
    assert g["parts"]["356"] == {"kg": 60.0, "batch_id": "f"}
    assert _allocation_kg_per_batch(alloc) == {"a": 140.0, "f": 60.0}


def test_component_batch_change_creates_second_group():
    # Ćwiartka: 355 starcza na 5 szt (70 kg), potem 357; filet jeden (356)
    # → 5× "355/356" + 5× "357/356" (etykiety per faktyczny skład sztuki)
    pools = [
        _pool(("a", "355", 70.0), ("b", "357", 200.0)),
        _pool(("f", "356", 100.0)),
    ]
    alloc = _allocate_components(10, 20.0, COMPS, pools)
    assert alloc["355/356"]["pieces"] == 5
    assert alloc["357/356"]["pieces"] == 5
    assert alloc["355/356"]["parts"]["355"]["kg"] == 70.0
    assert alloc["357/356"]["parts"]["357"]["kg"] == 70.0
    # filet rozłożony między obie grupy: 30+30
    assert alloc["355/356"]["parts"]["356"]["kg"] == 30.0
    assert alloc["357/356"]["parts"]["356"]["kg"] == 30.0
    assert MIXED_KEY not in alloc


def test_boundary_piece_goes_to_pm():
    # Ćwiartka 355 ma 77 kg: 5 szt po 14 kg = 70, resztka 7 kg → 6. sztuka
    # dosztukowana 7+7 z 357 → MIXED (PM); dalej czyste 357
    pools = [
        _pool(("a", "355", 77.0), ("b", "357", 200.0)),
        _pool(("f", "356", 100.0)),
    ]
    alloc = _allocate_components(10, 20.0, COMPS, pools)
    assert alloc["355/356"]["pieces"] == 5
    assert alloc[MIXED_KEY]["pieces"] == 1
    assert alloc[MIXED_KEY]["parts"]["355"]["kg"] == 7.0
    assert alloc[MIXED_KEY]["parts"]["357"]["kg"] == 7.0
    assert alloc[MIXED_KEY]["parts"]["356"]["kg"] == 6.0
    assert alloc["357/356"]["pieces"] == 4
    # bilans: razem 10 szt × 20 kg = 200 kg
    total = sum(v for v in _allocation_kg_per_batch(alloc).values())
    assert round(total, 3) == 200.0


def test_shortfall_leaves_pieces_unallocated():
    # filetu starcza tylko na 3 sztuki (3×6=18 kg z 20 kg)
    pools = [_pool(("a", "355", 500.0)), _pool(("f", "356", 20.0))]
    alloc = _allocate_components(10, 20.0, COMPS, pools)
    pieces = sum(int(g.get("pieces") or 0) for g in alloc.values())
    assert pieces == 3
