import pytest

from app.utils.unit_codes import (
    unit_qr,
    parse_unit_qr,
    next_produced_status,
    PRODUCED,
    PLANNED,
    PACKED,
)


def test_unit_qr_format():
    assert unit_qr("abc123") == "U|abc123"


def test_parse_unit_qr_ok():
    assert parse_unit_qr("U|abc123") == "abc123"


def test_parse_unit_qr_trims_whitespace():
    assert parse_unit_qr("  U|abc123  ") == "abc123"


def test_parse_unit_qr_rejects_other_tokens():
    assert parse_unit_qr("PAL|x|1") is None
    assert parse_unit_qr("abc123") is None
    assert parse_unit_qr("") is None
    assert parse_unit_qr(None) is None


def test_next_produced_status_from_planned():
    assert next_produced_status(PLANNED) == PRODUCED


def test_next_produced_status_duplicate_raises():
    with pytest.raises(ValueError):
        next_produced_status(PRODUCED)
    with pytest.raises(ValueError):
        next_produced_status(PACKED)


from app.utils.unit_codes import best_before, validate_pack


def test_best_before_adds_days():
    assert best_before("2026-06-02", 5) == "2026-06-07"
    assert best_before("2026-06-02", 365) == "2027-06-02"


def test_best_before_blank_inputs():
    assert best_before("", 5) == ""
    assert best_before("2026-06-02", 0) == "2026-06-02"


def test_validate_pack_ok():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 5}
    ok, reason = validate_pack(unit, carton)
    assert ok is True
    assert reason == ""


def test_validate_pack_wrong_weight():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 30, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 5}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "kg" in reason


def test_validate_pack_not_produced():
    unit = {"status": "planned", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 0}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "produkcj" in reason.lower()


def test_validate_pack_already_packed():
    unit = {"status": "packed", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": "c1"}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 5}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "spakowan" in reason.lower()


def test_validate_pack_wrong_client():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Inny", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 0}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "klient" in reason.lower()


def test_validate_pack_carton_full():
    unit = {"status": "produced", "product_type_id": "P1", "recipe_id": "R1",
            "weight_kg": 40, "client_name": "Zagros", "carton_id": None}
    carton = {"product_type_id": "P1", "recipe_id": "R1", "target_weight_kg": 40,
              "client_name": "Zagros", "target_qty": 20, "packed_qty": 20}
    ok, reason = validate_pack(unit, carton)
    assert ok is False
    assert "pełny" in reason.lower() or "pelny" in reason.lower()
