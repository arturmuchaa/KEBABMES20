"""Czysta walidacja wydajności rozbioru — wspólna dla zapisu 'od razu'
i domknięcia pobrania mięsem. Bez bazy."""
from app.services.deboning_service import validate_meat_yield


def test_prawidlowa_wydajnosc_przechodzi():
    assert validate_meat_yield(100.0, 70.0) is None


def test_mieso_zero_blokuje():
    assert validate_meat_yield(100.0, 0.0)


def test_mieso_wieksze_niz_cwiartka_blokuje():
    err = validate_meat_yield(100.0, 120.0)
    assert err and "ćwiartk" in err


def test_wydajnosc_powyzej_95_blokuje():
    err = validate_meat_yield(100.0, 96.0)
    assert err and "nierealna" in err


def test_wydajnosc_ponizej_30_blokuje():
    err = validate_meat_yield(100.0, 20.0)
    assert err and "niska" in err
