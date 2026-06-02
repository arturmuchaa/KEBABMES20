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
