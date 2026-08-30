import pytest

from app.utils.batch_numbers import (
    parse_reception_no,
    format_reception_no,
    combined_batch_no,
    format_ddfip_no,
    is_combined,
    kebab_batch_no,
    parse_ddfip_no,
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
    assert is_combined("PP27") is True
    assert is_combined("344") is False
    assert is_combined("") is False
    assert is_combined("PP") is False
    assert is_combined("PPx") is False


# --- kebab_batch_no --------------------------------------------------------
def test_kebab_batch_no_single_batch():
    assert kebab_batch_no("2026-06-02", "344") == "020626 344"


def test_kebab_batch_no_combined_batch():
    assert kebab_batch_no("2026-06-02", "PP1") == "020626 PP1"


def test_kebab_batch_no_accepts_date_object():
    from datetime import date
    assert kebab_batch_no(date(2026, 6, 2), "344") == "020626 344"


# --- production_combined_batch_no / is_production_combined --------------------
def test_production_combined_batch_no():
    from app.utils.batch_numbers import production_combined_batch_no
    assert production_combined_batch_no(1) == "PPP1"
    assert production_combined_batch_no(7) == "PPP7"


def test_is_production_combined_true_for_ppp():
    from app.utils.batch_numbers import is_production_combined
    assert is_production_combined("PPP1") is True


def test_is_production_combined_false_for_pp_and_bare():
    from app.utils.batch_numbers import is_production_combined
    assert is_production_combined("PP1") is False
    assert is_production_combined("326") is False
    assert is_production_combined(None) is False


def test_pp_is_not_mistaken_for_ppp_by_is_combined():
    # PP (mieszalnik) nadal jest "combined", ale NIE "production_combined"
    from app.utils.batch_numbers import is_combined, is_production_combined
    assert is_combined("PP1") is True
    assert is_production_combined("PP1") is False


def test_production_mixed_batch_no_pm():
    from app.utils.batch_numbers import is_production_mixed, production_mixed_batch_no
    assert production_mixed_batch_no(1) == "PM1"
    assert is_production_mixed("PM1") is True
    assert is_production_mixed("PP1") is False     # masownica
    assert is_production_mixed("PPP1") is False    # legacy produkcja
    assert is_production_mixed("326") is False
    assert is_production_mixed(None) is False


def test_classify_pm_as_production():
    from app.utils.batch_numbers import classify_batch_type
    assert classify_batch_type("060626 PM2") == "production"
    assert classify_batch_type("PM2") == "production"
    # legacy PPP nadal rozpoznawane
    assert classify_batch_type("060626 PPP1") == "production"


# --- scrap_pool_batch_no (pula ścinków z dnia produkcji) -------------------
def test_scrap_pool_batch_no_format():
    from app.utils.batch_numbers import scrap_pool_batch_no
    assert scrap_pool_batch_no(1) == "SC1"
    assert scrap_pool_batch_no(12) == "SC12"


# ─── Numeracja DDFiP (przyprawy, dodatki, opakowania) — instrukcja 1.3 ───────

class TestNumerDdfip:
    """Numer przyjęcia artykułów pomocniczych: ``DF/1/08``.

    Instrukcja 1.3 oPRP: „DF — wyróżnik wyróżniający od surowców pochodzenia
    zwierzęcego, 1 — numer kolejny dostawy w danym miesiącu, 08 — miesiąc
    dostawy". Numeracja rusza od 1 pierwszego dnia każdego miesiąca.

    UWAGA: ta sama instrukcja mówi też zdanie wyżej „Numeracja zaczyna się
    każdego miesiąca od litery P" — to błąd w księdze (zgłoszony). Idziemy za
    przykładem i za nagłówkiem karty 1.3.1, które oba mówią DF.
    """

    def test_format_wg_przykladu_z_instrukcji(self):
        assert format_ddfip_no(1, "2026-08-30") == "DF/1/08"

    def test_miesiac_zawsze_dwucyfrowy(self):
        assert format_ddfip_no(7, "2026-01-05") == "DF/7/01"

    def test_numer_nie_niesie_roku(self):
        # Karta 1.3.1 jest miesięczna, więc rok wynika z dokumentu — tak samo
        # jak przy numerze przyjęcia surowca (poprawka z 12.08.2026).
        assert "2026" not in format_ddfip_no(3, "2026-08-30")

    def test_parse_odwraca_format(self):
        assert parse_ddfip_no("DF/12/08") == (12, 8)

    def test_parse_wybacza_spacje_i_male_litery(self):
        assert parse_ddfip_no("  df / 12 / 08 ") == (12, 8)

    def test_puste_znaczy_numer_z_sekwencji(self):
        assert parse_ddfip_no("") is None
        assert parse_ddfip_no(None) is None

    def test_numer_surowca_nie_przechodzi_jako_ddfip(self):
        # „1/08" to numer przyjęcia MIĘSA. Gdyby wpadł tu bez litery, dwa
        # rejestry dzieliłyby jedną serię i karta 1.3.1 pokazałaby dostawę
        # wołowiny między foliami.
        with pytest.raises(ValueError):
            parse_ddfip_no("1/08")

    def test_zly_miesiac_odrzucony(self):
        with pytest.raises(ValueError):
            parse_ddfip_no("DF/1/13")

    def test_numer_zero_odrzucony(self):
        with pytest.raises(ValueError):
            parse_ddfip_no("DF/0/08")
