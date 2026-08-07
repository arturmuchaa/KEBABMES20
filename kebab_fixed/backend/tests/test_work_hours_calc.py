"""Liczenie godzin z zakresu od–do. Czyste funkcje — działa bez bazy."""
import pytest
from fastapi import HTTPException

from app.services.work_hours_service import compute_hours, parse_hhmm


def test_zwykla_zmiana():
    assert compute_hours("6:00", "15:00") == 9.0
    assert compute_hours("06:00", "14:30") == 8.5


def test_zmiana_przez_polnoc():
    """22:00–6:00 to 8 godzin, nie minus 16."""
    assert compute_hours("22:00", "06:00") == 8.0


def test_kwadranse():
    assert compute_hours("6:15", "14:00") == 7.75


def test_brak_konca_to_zmiana_otwarta():
    """Rano zapisujemy sam start i czekamy — godzin jeszcze nie ma."""
    assert compute_hours("6:00", None) is None
    assert compute_hours("6:00", "") is None


def test_brak_startu_tez_daje_none():
    assert compute_hours(None, "15:00") is None


def test_rowne_godziny_to_blad():
    """6:00–6:00 nie znaczy 24 h ani 0 h — to pomyłka przy wpisywaniu."""
    with pytest.raises(HTTPException) as exc:
        compute_hours("6:00", "6:00")
    assert exc.value.status_code == 400


def test_parse_hhmm_akceptuje_skroty():
    """Biuro wpisuje szybko: '6' ma znaczyć 6:00."""
    assert parse_hhmm("6") == 360
    assert parse_hhmm("6:00") == 360
    assert parse_hhmm("06:05") == 365


def test_parse_hhmm_odrzuca_smiecie():
    for bad in ("", "25:00", "6:61", "abc", "-1:00"):
        with pytest.raises(HTTPException):
            parse_hhmm(bad)


def test_parse_hhmm_przecinek_jedna_cyfra_to_ulamek():
    """Dwukropek wymaga Shift — połówki wpisuje się przecinkiem."""
    assert parse_hhmm("8,5") == 8 * 60 + 30
    assert parse_hhmm("8.5") == 8 * 60 + 30


def test_parse_hhmm_przecinek_dwie_cyfry_to_minuty():
    """„8,30" to naturalny zapis 8:30. Czytanie tego jako 0,30 h (8:18)
    po cichu zaniżyłoby wypłatę."""
    assert parse_hhmm("8,30") == 8 * 60 + 30
    assert parse_hhmm("14,45") == 14 * 60 + 45
    assert parse_hhmm("6,05") == 6 * 60 + 5


def test_parse_hhmm_odrzuca_minuty_poza_zakresem():
    for bad in ("8,60", "8,99"):
        with pytest.raises(HTTPException):
            parse_hhmm(bad)


def test_compute_hours_przyjmuje_przecinek():
    """Zapis przecinkowy musi liczyć się tak samo jak dwukropkowy."""
    assert compute_hours("6,5", "15,0") == compute_hours("6:30", "15:00")
    assert compute_hours("6,5", "15,0") == 8.5
