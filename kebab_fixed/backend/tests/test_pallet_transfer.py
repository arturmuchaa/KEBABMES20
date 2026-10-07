"""Czysta logika przypięcia palety z poczekalni do zamówienia. Bez DB."""
from app.services.pallet_transfer_service import plan_attach

SPEC = {"recipe_id": "r1", "product_type_id": "pt1", "packaging_id": "m65"}


def _l(lid, kg, qty):
    return {"id": lid, **SPEC, "kg_per_unit": kg, "qty": qty}


def _it(kg, qty, **kw):
    return {**SPEC, "kg_per_unit": kg, "qty": qty, **kw}


def test_cala_paleta_pasuje_i_miesci_sie():
    lines = [_l("a", 30, 30), _l("b", 50, 45)]
    free = {("r1", "pt1", "m65", 30.0): 30, ("r1", "pt1", "m65", 50.0): 45}
    assert plan_attach([_it(30, 30)], lines, {}, free) == [("a", 30)]
    assert plan_attach([_it(30.0001, 10), _it(50, 15)], lines, {}, free) == [("a", 10), ("b", 15)]


def test_brak_pozycji_albo_miejsca_to_brak_przypiecia():
    lines = [_l("a", 30, 30)]
    free = {("r1", "pt1", "m65", 30.0): 20}
    assert plan_attach([_it(30, 30)], lines, {}, free) is None          # za mało wolnego
    assert plan_attach([_it(15, 5)], lines, {}, {("r1", "pt1", "m65", 15.0): 99}) is None  # brak pozycji
    assert plan_attach([_it(30, 5, packaging_id="k65")], lines, {}, free) is None        # inna tuleja
    assert plan_attach([], lines, {}, free) is None


def test_rozklad_na_kilka_pozycji_tej_samej_specyfikacji():
    lines = [_l("a", 30, 10), _l("b", 30, 20)]
    free = {("r1", "pt1", "m65", 30.0): 30}
    assert plan_attach([_it(30, 25)], lines, {"a": 4}, free) == [("a", 6), ("b", 19)]
