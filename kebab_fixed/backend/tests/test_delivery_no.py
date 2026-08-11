"""Numer przyjęcia (dokument dostawy) — czysta logika formatu.

Numer przyjęcia to TRZECI poziom numeracji, obok numeru porządkowego partii
i numeru partii wyrobu — patrz docstring app/utils/batch_numbers.py.
"""
import datetime as dt

import pytest

from app.utils.batch_numbers import (
    delivery_period,
    format_delivery_no,
    parse_delivery_no,
)


# --- format_delivery_no ----------------------------------------------------
def test_format_delivery_no_is_seq_month_year():
    assert format_delivery_no(1, dt.date(2026, 8, 11)) == "1/08/2026"


def test_format_delivery_no_keeps_seq_without_padding():
    # Numer porządkowy dostawy w miesiącu rośnie naturalnie — bez zer wiodących,
    # tak jak zakład pisze go ręcznie na karcie 1.1.1.
    assert format_delivery_no(12, dt.date(2026, 8, 11)) == "12/08/2026"
    assert format_delivery_no(103, dt.date(2026, 12, 1)) == "103/12/2026"


def test_format_delivery_no_pads_month_to_two_digits():
    assert format_delivery_no(3, dt.date(2026, 1, 9)) == "3/01/2026"


def test_format_delivery_no_accepts_iso_string():
    assert format_delivery_no(5, "2026-08-11") == "5/08/2026"


def test_format_delivery_no_accepts_datetime():
    assert format_delivery_no(5, dt.datetime(2026, 8, 11, 6, 35)) == "5/08/2026"


def test_format_delivery_no_rejects_seq_below_one():
    with pytest.raises(ValueError):
        format_delivery_no(0, dt.date(2026, 8, 11))


# --- parse_delivery_no -----------------------------------------------------
def test_parse_delivery_no_roundtrips():
    assert parse_delivery_no("12/08/2026") == (12, 8, 2026)


def test_parse_delivery_no_tolerates_whitespace_and_padding():
    # Operator przepisuje numer z kartki — „ 07/08/2026 " ma zadziałać.
    assert parse_delivery_no(" 07/08/2026 ") == (7, 8, 2026)


def test_parse_delivery_no_blank_is_none():
    assert parse_delivery_no("") is None
    assert parse_delivery_no("   ") is None
    assert parse_delivery_no(None) is None


def test_parse_delivery_no_rejects_garbage():
    for bad in ("12/2026", "12-08-2026", "abc", "12/13/2026", "0/08/2026"):
        with pytest.raises(ValueError):
            parse_delivery_no(bad)


# --- delivery_period -------------------------------------------------------
def test_delivery_period_is_year_month():
    # Klucz sekwencji: numeracja resetuje się z każdym miesiącem.
    assert delivery_period(dt.date(2026, 8, 11)) == "2026-08"
    assert delivery_period("2026-01-31") == "2026-01"
