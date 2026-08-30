"""Kody pozycji magazynów słownikowych.

Zastane dane miały 13 tulei i opakowań na 9 kodów: cztery pozycje z zasiewu
wpisały PAK-001…004 nie ruszając licznika, a licznik wydał te same numery
drugi raz. Kod, który się powtarza, jest gorszy niż jego brak — wygląda na
identyfikator i da się po nim wyszukiwać.
"""
import pytest

from app.utils.stock_codes import (
    kod_tulei, kod_z_licznika, normalizuj_kod, prefiks_opakowania,
)


class TestKodTulei:
    @pytest.mark.parametrize("nazwa,oczekiwany", [
        ("METAL 65CM",         "TUL-M65"),
        ("KARTON 60CM",        "TUL-K60"),
        ("metal 45 cm",        "TUL-M45"),
        ("Tuleja metal 80CM",  "TUL-M80"),
        ("KARTONOWA 50CM",     "TUL-K50"),
    ])
    def test_czyta_material_i_rozmiar_z_nazwy(self, nazwa, oczekiwany):
        assert kod_tulei(nazwa) == oczekiwany

    @pytest.mark.parametrize("nazwa", ["Folia stretch", "Karton 5 kg", "", "METAL"])
    def test_nazwa_bez_rozmiaru_nie_daje_kodu(self, nazwa):
        assert kod_tulei(nazwa) is None

    def test_metal_i_karton_tego_samego_rozmiaru_to_ROZNE_kody(self):
        # Dokładnie ta para chodziła jako jeden PAK-001.
        assert kod_tulei("METAL 65CM") != kod_tulei("KARTON 65CM")

    def test_zero_wiodace_nie_robi_drugiego_kodu(self):
        assert kod_tulei("METAL 065CM") == kod_tulei("METAL 65CM")


class TestPrefiks:
    def test_rodzaj_wyznacza_prefiks(self):
        assert prefiks_opakowania("tuleja") == "TUL"
        assert prefiks_opakowania("opakowanie") == "OPA"
        assert prefiks_opakowania("inne") == "INN"

    def test_nieznany_rodzaj_nie_wywraca_zapisu(self):
        # 'FOLIA' siedziało w bazie mimo że nie ma go na liście rodzajów.
        assert prefiks_opakowania("FOLIA") == "INN"
        assert prefiks_opakowania("") == "INN"


class TestNormalizacja:
    def test_wielkosc_liter_i_spacje_nie_robia_drugiej_pozycji(self):
        assert normalizuj_kod(" tul-m60 ") == "TUL-M60"
        assert normalizuj_kod("TUL M60") == normalizuj_kod("tulm60")

    def test_pusty_kod_zostaje_pusty(self):
        assert normalizuj_kod("") == ""
        assert normalizuj_kod("   ") == ""


class TestLicznik:
    def test_numer_ma_stala_szerokosc(self):
        assert kod_z_licznika("OPA", 1) == "OPA-001"
        assert kod_z_licznika("SKL", 28) == "SKL-028"

    def test_powyzej_setek_nie_ucina(self):
        assert kod_z_licznika("SKL", 1234) == "SKL-1234"
