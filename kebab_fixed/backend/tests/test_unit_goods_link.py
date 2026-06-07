"""Testy czystego resolvera linku sztuka → wyrób gotowy (finished_units.source_finished_goods_id).

Zasada nadrzędna: NIGDY nie zgaduj. Gdy linia planu wskazuje na >1 wyrób gotowy,
dezambiguujemy po numerze partii (batch_no ∈ seasoned_batch_nos). Jeśli to nie daje
jednoznacznego wyniku — zwracamy None (sztuka zostaje sierotą do ręcznej decyzji),
bo dla inspekcji weterynaryjnej błędny link jest gorszy niż brak linku.
"""
from app.services.finished_units_service import resolve_unit_goods_id


def _cand(goods_id, seasoned=None):
    return {"goods_id": goods_id, "seasoned_batch_nos": seasoned or []}


def test_no_candidates_returns_none():
    # Linia planu bez finished_goods (dzień niezamknięty) → sztuka pending, nie sierota
    assert resolve_unit_goods_id("347", []) is None


def test_single_candidate_assigned_regardless_of_batch():
    # Jednoznaczna linia → przypisz, nawet gdy batch_no nie pasuje do seasoned
    assert resolve_unit_goods_id("999", [_cand("G1", ["347"])]) == "G1"


def test_single_candidate_with_empty_unit_batch():
    assert resolve_unit_goods_id("", [_cand("G1", ["347"])]) == "G1"


def test_duplicate_rows_same_goods_collapse():
    # Junction może zwrócić wiele wierszy na ten sam goods_id → traktuj jak jeden
    cands = [_cand("G1", ["347"]), _cand("G1", ["346"])]
    assert resolve_unit_goods_id("347", cands) == "G1"


def test_two_goods_disambiguated_by_batch_no():
    cands = [_cand("G1", ["346"]), _cand("G2", ["347"])]
    assert resolve_unit_goods_id("347", cands) == "G2"
    assert resolve_unit_goods_id("346", cands) == "G1"


def test_two_goods_batch_matches_none_returns_none():
    cands = [_cand("G1", ["346"]), _cand("G2", ["347"])]
    assert resolve_unit_goods_id("999", cands) is None


def test_two_goods_batch_matches_both_returns_none():
    # Numer partii w obu → wieloznaczne → nie zgaduj
    cands = [_cand("G1", ["347"]), _cand("G2", ["347"])]
    assert resolve_unit_goods_id("347", cands) is None


def test_two_goods_empty_batch_returns_none():
    cands = [_cand("G1", ["346"]), _cand("G2", ["347"])]
    assert resolve_unit_goods_id("", cands) is None


def test_none_seasoned_nos_handled():
    cands = [_cand("G1", None), _cand("G2", ["347"])]
    assert resolve_unit_goods_id("347", cands) == "G2"
