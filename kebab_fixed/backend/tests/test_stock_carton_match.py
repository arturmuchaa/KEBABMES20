"""Testy czystej logiki dopasowania kartonu magazynowego do zamówienia.

Karton magazynowy (finished_goods na magazyn) wiąże się z zamówieniem TYLKO gdy
zgadza się: klient + receptura + rodzaj (product_type) + tuleja (packaging) + waga
sztuki (kg_per_unit). Bez DB — czysta funkcja.
"""
from app.services.stock_carton_match_service import match_cartons


def _line(lid, recipe="r1", ptype="p1", pack="pak1", kg=50.0, qty=15):
    return {"id": lid, "recipe_id": recipe, "product_type_id": ptype,
            "packaging_id": pack, "kg_per_unit": kg, "qty": qty}


def _carton(cid, *, carton_no=1, client="c1", recipe="r1", ptype="p1",
            pack="pak1", kg=50.0, qty_available=15):
    return {"id": cid, "carton_no": carton_no, "client_id": client,
            "recipe_id": recipe, "product_type_id": ptype, "packaging_id": pack,
            "kg_per_unit": kg, "qty_available": qty_available}


def test_full_match_returns_suggestion():
    sugg = match_cartons("c1", [_line("l1")], [_carton("k1")])
    assert len(sugg) == 1
    assert sugg[0]["cartonId"] == "k1"
    assert sugg[0]["orderLineId"] == "l1"
    assert sugg[0]["qty"] == 15
    assert sugg[0]["cartonNo"] == 1


def test_wrong_client_no_match():
    sugg = match_cartons("c1", [_line("l1")], [_carton("k1", client="INNY")])
    assert sugg == []


def test_wrong_product_type_no_match():
    sugg = match_cartons("c1", [_line("l1")], [_carton("k1", ptype="INNY")])
    assert sugg == []


def test_wrong_tuleja_no_match():
    sugg = match_cartons("c1", [_line("l1")], [_carton("k1", pack="INNA")])
    assert sugg == []


def test_wrong_weight_no_match():
    sugg = match_cartons("c1", [_line("l1", kg=50.0)], [_carton("k1", kg=40.0)])
    assert sugg == []


def test_wrong_recipe_no_match():
    sugg = match_cartons("c1", [_line("l1")], [_carton("k1", recipe="INNA")])
    assert sugg == []


def test_weight_matched_with_rounding():
    # 50.000 vs 50.0004 — zaokrąglenie do 3 miejsc traktuje jako równe
    sugg = match_cartons("c1", [_line("l1", kg=50.0)], [_carton("k1", kg=50.0004)])
    assert len(sugg) == 1


def test_zero_available_carton_skipped():
    sugg = match_cartons("c1", [_line("l1")], [_carton("k1", qty_available=0)])
    assert sugg == []


def test_multiple_lines_one_matching():
    lines = [_line("l1", ptype="INNY"), _line("l2")]
    sugg = match_cartons("c1", lines, [_carton("k1")])
    assert {s["orderLineId"] for s in sugg} == {"l2"}
