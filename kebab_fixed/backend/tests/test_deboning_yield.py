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


# --- validate_take_completion (domknięcie pobrania — bez pasma uzysku) --------
# Domknięcie to jawna decyzja operatora, a mięso z porcji weigh-part jest już
# fizycznie na magazynie — pasmo 30–95% tu tylko zakleszczało 'pending'.

def test_domkniecie_wysoki_uzysk_przechodzi():
    from app.services.deboning_service import validate_take_completion
    assert validate_take_completion(300.0, 290.5) is None  # 96,8% — realny przypadek


def test_domkniecie_zbyt_niski_uzysk_nadal_blokuje():
    # Dolny próg 30% zostaje — zbyt mało mięsa to sygnał „sprawdź dane".
    from app.services.deboning_service import validate_take_completion
    err = validate_take_completion(300.0, 60.0)  # 20%
    assert err and "niska" in err


def test_domkniecie_mieso_zero_blokuje():
    from app.services.deboning_service import validate_take_completion
    assert validate_take_completion(300.0, 0.0)


def test_domkniecie_mieso_wieksze_niz_cwiartka_blokuje():
    from app.services.deboning_service import validate_take_completion
    err = validate_take_completion(300.0, 320.0)
    assert err and "ćwiartk" in err
