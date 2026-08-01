"""Czysta walidacja wydajności rozbioru — wspólna dla zapisu 'od razu'
i domknięcia pobrania mięsem. Bez bazy."""
from app.services.deboning_service import (
    YIELD_BANDS,
    validate_meat_yield,
    validate_yield_band,
)


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

def test_domkniecie_wysoki_uzysk_przechodzi_przez_te_funkcje():
    """96,8% (431/ANATOLII) NIE odbija się tutaj — górny pułap trzyma teraz
    validate_yield_band, nie ta funkcja. Sam wpis był błędem (poprawiony tego
    samego dnia na 197,0 z powodem „blad"), więc domknięcie z taką wydajnością
    i tak nie przejdzie całej ścieżki — patrz testy DB."""
    from app.services.deboning_service import validate_take_completion
    assert validate_take_completion(300.0, 290.5) is None


def test_domkniecie_zbyt_niski_uzysk_nadal_blokuje():
    # Dolny próg 30% zostaje — zbyt mało mięsa to sygnał „sprawdź dane".
    from app.services.deboning_service import validate_take_completion
    err = validate_take_completion(300.0, 60.0)  # 20%
    assert err and "niska" in err


def test_furtka_omija_dolny_prog_domkniecia():
    """Furtka musi działać w OBIE strony. Gdyby kod serwisowy przepuszczał
    tylko zawyżoną wydajność, pobranie z realnie niskim uzyskiem zostałoby
    zakleszczone w 'pending' bez wyjścia — czyli ta sama pułapka, przez którą
    usunięto pułap 95% (2026-07-24)."""
    from app.services.deboning_service import validate_take_completion
    assert validate_take_completion(300.0, 60.0, override=True) is None  # 20%


def test_furtka_nie_omija_granic_fizycznych_przy_domknieciu():
    """Kod serwisowy omija pasmo wydajności, nie prawa fizyki."""
    from app.services.deboning_service import validate_take_completion
    assert validate_take_completion(300.0, 320.0, override=True) is not None
    assert validate_take_completion(300.0, 0.0, override=True) is not None
    assert validate_take_completion(0.0, 100.0, override=True) is not None


def test_domkniecie_mieso_zero_blokuje():
    from app.services.deboning_service import validate_take_completion
    assert validate_take_completion(300.0, 0.0)


def test_domkniecie_mieso_wieksze_niz_cwiartka_blokuje():
    from app.services.deboning_service import validate_take_completion
    err = validate_take_completion(300.0, 320.0)
    assert err and "ćwiartk" in err


# ── Twarde pasmo wydajności (60–71% z/s, 45–60% b/s) ──────────────────
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
    lo, hi = YIELD_BANDS["zs"]
    assert validate_yield_band(100.0, lo) is None   # dokładnie 60,0%
    assert validate_yield_band(100.0, hi) is None   # dokładnie 71,0%
    assert validate_yield_band(100.0, 59.9) is not None
    assert validate_yield_band(100.0, 71.1) is not None


def test_male_pobranie_zwolnione_z_pasma():
    """Przy 15 kg zaokrąglenie 0,5 kg to ponad 3 pp — procent jest tam
    z natury rozchwiany (4 takie wpisy na 676 w 25 dni)."""
    assert validate_yield_band(15.0, 8.5) is None      # 56,7%
    assert validate_yield_band(29.9, 29.9) is None     # 100%, ale < 30 kg


def test_dokladnie_30kg_juz_podlega_kontroli():
    """Próg zwolnienia to `<`, nie `<=` — 30,0 kg to już pełna kontrola."""
    assert validate_yield_band(30.0, 30.0) is not None  # 100% przy 30 kg — łapane


def test_duze_pobranie_z_ta_sama_wydajnoscia_juz_nie():
    assert validate_yield_band(150.0, 85.0) is not None  # 56,7% przy 150 kg


def test_furtka_przepuszcza_wszystko():
    assert validate_yield_band(300.0, 298.5, override=True) is None
    assert validate_yield_band(150.0, 82.5, override=True) is None


# ── Pasmo b/s (bez skóry) — inne, też domknięte ───────────────────────
def test_pasmo_bs_jest_inne_i_tez_domkniete():
    assert validate_yield_band(150.0, 85.0, "bs") is None      # 56,7%
    assert validate_yield_band(100.0, 60.0, "bs") is None      # dokładnie 60,0%
    assert validate_yield_band(100.0, 45.0, "bs") is None      # dokładnie 45,0%
    assert validate_yield_band(100.0, 66.0, "bs") is not None  # norma z/s, nie b/s
    assert validate_yield_band(100.0, 44.9, "bs") is not None


def test_nieznany_rodzaj_miesa_leci_po_pasmie_zs():
    assert validate_yield_band(100.0, 66.0, "cokolwiek") is None
    assert validate_yield_band(100.0, 55.0, None) is not None
