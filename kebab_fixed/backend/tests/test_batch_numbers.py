import pytest

from app.utils.batch_numbers import (
    parse_reception_no,
    format_reception_no,
    combined_batch_no,
    is_combined,
    kebab_batch_no,
)


# --- parse_reception_no ----------------------------------------------------
def test_parse_reception_no_accepts_bare_digits():
    assert parse_reception_no("344") == 344


def test_parse_reception_no_strips_whitespace():
    assert parse_reception_no("  344  ") == 344


def test_parse_reception_no_blank_returns_none():
    assert parse_reception_no("") is None
    assert parse_reception_no("   ") is None
    assert parse_reception_no(None) is None


def test_parse_reception_no_rejects_letters():
    with pytest.raises(ValueError):
        parse_reception_no("R344")
    with pytest.raises(ValueError):
        parse_reception_no("abc")


def test_parse_reception_no_rejects_zero_and_negative():
    with pytest.raises(ValueError):
        parse_reception_no("0")
    with pytest.raises(ValueError):
        parse_reception_no("-5")


# --- format_reception_no ---------------------------------------------------
def test_format_reception_no_is_bare_string():
    assert format_reception_no(344) == "344"


# --- combined_batch_no / is_combined --------------------------------------
def test_combined_batch_no():
    assert combined_batch_no(1) == "PP1"
    assert combined_batch_no(27) == "PP27"


def test_is_combined():
    assert is_combined("PP1") is True
    assert is_combined("344") is False
    assert is_combined("") is False


# --- kebab_batch_no --------------------------------------------------------
def test_kebab_batch_no_single_batch():
    assert kebab_batch_no("2026-06-02", "344") == "020626 344"


def test_kebab_batch_no_combined_batch():
    assert kebab_batch_no("2026-06-02", "PP1") == "020626 PP1"


def test_kebab_batch_no_accepts_date_object():
    from datetime import date
    assert kebab_batch_no(date(2026, 6, 2), "344") == "020626 344"
