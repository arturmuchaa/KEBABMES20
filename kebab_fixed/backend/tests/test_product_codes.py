"""Skróty i kody katalogu wyrobów."""
import pytest

from app.utils.product_codes import (
    formatuj_kg, kod_katalogowy, kolejny_wolny, normalizuj_kod, skrot_nazwy, skrot_tulei,
)


class TestSkrotNazwy:
    @pytest.mark.parametrize("nazwa,oczekiwany", [
        ("KEBAB MIX",               "MIX"),
        ("KEBAB MIX 95/5",          "MIX955"),
        ("KEBAB UDO 100%",          "UDO100"),
        ("KEBAB YAPRAK",            "YAPRAK"),
        ("KIRMIZI",                 "KIRMIZI"),
    ])
    def test_skraca_nazwe_do_kodu(self, nazwa, oczekiwany):
        assert skrot_nazwy(nazwa) == oczekiwany

    def test_wiodace_KEBAB_nic_nie_odroznia_wiec_odpada(self):
        assert skrot_nazwy("KEBAB SEBZELI") == "SEBZELI"

    def test_ogonki_znikaja(self):
        # Kod jedzie do księgowości i musi dać się wpisać z każdej klawiatury.
        assert skrot_nazwy("WROCŁAW") == "WROCAW"
        assert "Ł" not in skrot_nazwy("MĄKA ŻÓŁTA")

    def test_slowo_ktore_sie_nie_miesci_wchodzi_INICJALEM(self):
        # Ucinanie w połowie dawało kikuty („BEYAZ AFIYET" → „BEYAZAFIYE")
        # i gubiło różnicę wobec „BEYAZ HALAL".
        assert skrot_nazwy("BEYAZ AFIYET", 8) == "BEYAZA"
        assert skrot_nazwy("BEYAZ HALAL", 8) == "BEYAZH"
        assert skrot_nazwy("BEYAZ AFIYET", 8) != skrot_nazwy("BEYAZ HALAL", 8)

    def test_pusta_nazwa_daje_pusty_skrot(self):
        assert skrot_nazwy("") == ""
        assert skrot_nazwy("///") == ""


class TestSkrotTulei:
    def test_bierze_kod_z_magazynu(self):
        assert skrot_tulei("TUL-M60", "METAL 60CM") == "M60"

    def test_bez_kodu_liczy_z_nazwy_TA_SAMA_regula(self):
        # Skracanie nazwy na sztywno sklejało „KARTON 60CM" i „KARTON 65CM"
        # w jeden człon `KARTON` — dwa różne wyroby dostawały ten sam kod.
        assert skrot_tulei("", "KARTON 60CM") == "K60"
        assert skrot_tulei("", "KARTON 65CM") == "K65"
        assert skrot_tulei("", "KARTON 60CM") != skrot_tulei("", "KARTON 65CM")

    def test_opakowanie_bez_rozmiaru_nie_wywraca_kodu(self):
        assert skrot_tulei("", "Folia stretch") != ""


class TestGramatura:
    def test_calkowita_bez_ogona(self):
        assert formatuj_kg(20.0) == "20"
        assert formatuj_kg(7.0) == "7"

    def test_ulamek_z_podkreslnikiem_zeby_nie_mylil_sie_ze_setkami(self):
        # „12,5 kg" sklejone w „125" znaczyłoby też 125 kg.
        assert formatuj_kg(12.5) == "12_5"
        assert formatuj_kg(12.5) != formatuj_kg(125.0)


class TestKodKatalogowy:
    def test_sklada_cztery_czlony(self):
        assert kod_katalogowy("UDO100", "KIRMIZI", "M60", 20.0) == "UDO100-KIRMIZI-M60-20"

    def test_pusty_czlon_nie_zostawia_dziury(self):
        # Pozycja bez receptury ma dać się przeczytać, a nie „UDO100--M60-20".
        assert kod_katalogowy("UDO100", "", "M60", 20.0) == "UDO100-M60-20"

    def test_ta_sama_czworka_daje_ten_sam_kod(self):
        a = kod_katalogowy("MIX", "KIRMIZI", "K65", 25.0)
        b = kod_katalogowy("MIX", "KIRMIZI", "K65", 25.0)
        assert a == b

    def test_rozna_gramatura_to_INNY_kod(self):
        assert (kod_katalogowy("UDO100", "KIRMIZI", "M60", 20.0)
                != kod_katalogowy("UDO100", "KIRMIZI", "M60", 30.0))


class TestKolejnyWolny:
    def test_wolny_kod_zostaje_bez_zmian(self):
        assert kolejny_wolny("MIX", set()) == "MIX"

    def test_zajety_dostaje_sufiks(self):
        # „KEBAB MIX 70/30" i „MIX 70/30" dają ten sam skrót — kod ma być
        # jednoznaczny, więc drugi bierze wariant.
        assert kolejny_wolny("MIX7030", {"MIX7030"}) == "MIX7030-2"
        assert kolejny_wolny("MIX7030", {"MIX7030", "MIX7030-2"}) == "MIX7030-3"

    def test_brak_wolnego_wariantu_zwraca_None(self):
        zajete = {"X"} | {f"X-{i}" for i in range(2, 100)}
        assert kolejny_wolny("X", zajete) is None


class TestNormalizacja:
    def test_wielkosc_liter_i_spacje(self):
        assert normalizuj_kod(" udo100-kirmizi ") == "UDO100-KIRMIZI"
