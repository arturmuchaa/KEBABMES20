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


from app.services.deboning_service import (
    YIELD_BAND_MAX_PCT,
    YIELD_BAND_MIN_PCT,
    validate_yield_band,
)


# ── Twarde pasmo wydajności (60–71%) ──────────────────────────────────
def test_pasmo_przepuszcza_typowa_wydajnosc():
    assert validate_yield_band(300.0, 198.0) is None  # 66,0%


def test_pasmo_blokuje_wpis_ze_zla_tara_wozka():
    """442/ANATOLII: 298,5 kg mięsa z 300 kg ćwiartki = 99,5%.
    Różnica do prawdy (198,5) to waga wózka."""
    err = validate_yield_band(300.0, 298.5)
    assert err is not None
    assert "99,5%" in err
    assert "wózek" in err


def test_pasmo_blokuje_rowne_sto_procent():
    """443/SERHII: 150/150. Stary warunek kgMeat>kgQuarter tego NIE łapał."""
    assert validate_yield_band(150.0, 150.0) is not None


def test_pasmo_blokuje_zbyt_niska_wydajnosc():
    err = validate_yield_band(150.0, 82.5)  # 55,0%
    assert err is not None
    assert "zważone" in err


def test_granice_pasma_sa_domkniete():
    assert validate_yield_band(100.0, YIELD_BAND_MIN_PCT) is None   # dokładnie 60,0%
    assert validate_yield_band(100.0, YIELD_BAND_MAX_PCT) is None   # dokładnie 71,0%
    assert validate_yield_band(100.0, 59.9) is not None
    assert validate_yield_band(100.0, 71.1) is not None


def test_male_pobranie_zwolnione_z_pasma():
    """Przy 15 kg zaokrąglenie 0,5 kg to ponad 3 pp — procent jest tam
    z natury rozchwiany (4 takie wpisy na 676 w 25 dni)."""
    assert validate_yield_band(15.0, 8.5) is None      # 56,7%
    assert validate_yield_band(29.9, 29.9) is None     # 100%, ale < 30 kg


def test_duze_pobranie_z_ta_sama_wydajnoscia_juz_nie():
    assert validate_yield_band(150.0, 85.0) is not None  # 56,7% przy 150 kg


def test_furtka_przepuszcza_wszystko():
    assert validate_yield_band(300.0, 298.5, override=True) is None
    assert validate_yield_band(150.0, 82.5, override=True) is None
