"""Testy dezambiguacji recall: goły numer partii może wskazywać na wiele etapów
(„347" = surowiec i lot i masowanie). Recall ma zwrócić wszystkie z etykietą etapu
i flagę ambiguous, zamiast po cichu zgadywać po precedencji.
"""
from app.services.traceability_service import label_candidates, is_ambiguous


def test_single_candidate_not_ambiguous():
    cands = [{"type": "raw_batch", "id": "r1", "number": "347"}]
    assert is_ambiguous(cands) is False
    labeled = label_candidates(cands)
    assert labeled[0]["stage"] == "Surowiec (przyjęcie)"


def test_multiple_types_is_ambiguous():
    cands = [
        {"type": "raw_batch", "id": "r1", "number": "347"},
        {"type": "seasoned_meat", "id": "s1", "number": "347"},
        {"type": "meat_lot", "id": "m1", "number": "347"},
    ]
    assert is_ambiguous(cands) is True


def test_same_type_multiple_rows_not_ambiguous():
    # Dwa surowce o tym numerze (teoretycznie) to nadal jeden etap
    cands = [
        {"type": "raw_batch", "id": "r1", "number": "347"},
        {"type": "raw_batch", "id": "r2", "number": "347"},
    ]
    assert is_ambiguous(cands) is False


def test_label_order_downstream_first():
    cands = [
        {"type": "raw_batch", "id": "r1", "number": "347"},
        {"type": "finished_goods", "id": "f1", "number": "347"},
        {"type": "meat_lot", "id": "m1", "number": "347"},
        {"type": "seasoned_meat", "id": "s1", "number": "347"},
    ]
    order = [c["type"] for c in label_candidates(cands)]
    assert order == ["finished_goods", "seasoned_meat", "meat_lot", "raw_batch"]


def test_empty_candidates():
    assert is_ambiguous([]) is False
    assert label_candidates([]) == []


def test_unknown_type_labeled_with_raw_value_and_sorted_last():
    cands = [
        {"type": "mystery", "id": "x", "number": "1"},
        {"type": "finished_goods", "id": "f", "number": "1"},
    ]
    labeled = label_candidates(cands)
    assert labeled[0]["type"] == "finished_goods"
    assert labeled[-1]["stage"] == "mystery"
