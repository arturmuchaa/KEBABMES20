"""Rozbicie produktów ubocznych rozbioru na loty ABP (kości/grzbiety/inne).

Model masy: remainder (część niemięsna ćwiartki) = kości + grzbiety + inne.
Domyka bilans: kg_meat + kg_remainder = kg_quarter. „inne" = remainder bez
sklasyfikowanych kości/grzbietów (skóra, tłuszcz, ubytek).
"""
from app.services.byproducts_service import byproduct_breakdown


def test_only_remainder_becomes_other():
    # Brak rozbicia kości/grzbietów → cały remainder to „inne"
    lots = byproduct_breakdown(0, 0, 50)
    assert lots == [{"kind": "other", "kg": 50.0}]


def test_bones_backs_fully_describe_remainder():
    # 300 kości + 200 grzbietów = 500 remainder → brak „inne"
    lots = byproduct_breakdown(300, 200, 500)
    assert {"kind": "bones", "kg": 300.0} in lots
    assert {"kind": "backs", "kg": 200.0} in lots
    assert all(l["kind"] != "other" for l in lots)


def test_partial_classification_leaves_other():
    # 100 kości z 500 remainder → 400 „inne"
    lots = byproduct_breakdown(100, 0, 500)
    kinds = {l["kind"]: l["kg"] for l in lots}
    assert kinds == {"bones": 100.0, "other": 400.0}


def test_no_byproduct_when_zero():
    assert byproduct_breakdown(0, 0, 0) == []


def test_overclassified_clamps_other_to_zero():
    # Gdyby kości+grzbiety > remainder (dane niespójne) — „inne" nie schodzi poniżej 0
    lots = byproduct_breakdown(400, 300, 500)
    assert all(l["kind"] != "other" for l in lots)
    assert {"kind": "bones", "kg": 400.0} in lots


def test_total_kg_equals_remainder_when_consistent():
    lots = byproduct_breakdown(120, 80, 300)
    assert round(sum(l["kg"] for l in lots), 3) == 300.0
