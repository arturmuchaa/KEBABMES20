from datetime import date

from app.utils.ids import format_dated_no


def test_first_of_day_is_bare_prefix_date():
    assert format_dated_no("ROZ", date(2026, 6, 6), 1) == "ROZ/06/06/26"


def test_masowanie_prefix():
    assert format_dated_no("MAS", date(2026, 6, 6), 1) == "MAS/06/06/26"


def test_second_same_day_gets_suffix():
    assert format_dated_no("MAS", date(2026, 6, 6), 2) == "MAS/06/06/26/2"
    assert format_dated_no("ROZ", date(2026, 6, 6), 3) == "ROZ/06/06/26/3"


def test_day_and_month_zero_padded():
    assert format_dated_no("PP", date(2026, 1, 9), 1) == "PP/09/01/26"
