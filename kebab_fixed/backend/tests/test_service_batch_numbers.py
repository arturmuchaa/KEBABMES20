"""Numeracja partii przyjmowanych NA USŁUGĘ (mięso z/s klienta).

Zakład produkuje kebab z mięsa powierzonego przez klienta. Taka partia idzie
osobną serią z sufiksem U (48U, 49U…), żeby na magazynie i w produkcji było
od razu widać, że towar jest cudzy — mimo że leży w tym samym magazynie
i można go normalnie masować.
"""
import pytest

from app.utils.batch_numbers import (
    format_reception_no,
    format_service_reception_no,
    is_service_no,
    parse_any_reception_no,
    parse_reception_no,
)


def test_format_numeru_uslugowego():
    assert format_service_reception_no(48) == "48U"
    assert format_service_reception_no(107) == "107U"


def test_rozpoznanie_numeru_uslugowego():
    assert is_service_no("48U") is True
    assert is_service_no("48") is False
    assert is_service_no("PP1") is False
    assert is_service_no(None) is False


def test_maly_u_tez_rozpoznany():
    """Operator wpisze '48u' równie chętnie jak '48U'."""
    assert is_service_no("48u") is True
    assert parse_any_reception_no("48u") == (48, True)


def test_parse_rozroznia_serie():
    assert parse_any_reception_no("344") == (344, False)
    assert parse_any_reception_no("48U") == (48, True)
    assert parse_any_reception_no("") == (None, False)
    assert parse_any_reception_no(None) == (None, False)


def test_parse_odrzuca_smieci():
    for bad in ("U", "48X", "abc", "0U", "-1"):
        with pytest.raises(ValueError):
            parse_any_reception_no(bad)


def test_zwykly_parser_nie_przyjmuje_uslugowego():
    """parse_reception_no zostaje dla serii podstawowej — bez zmian zachowania."""
    with pytest.raises(ValueError):
        parse_reception_no("48U")
    assert parse_reception_no("344") == 344
    assert format_reception_no(344) == "344"
