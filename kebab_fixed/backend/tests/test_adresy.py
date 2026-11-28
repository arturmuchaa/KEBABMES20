"""Rozbijanie i formatowanie adresów z rejestrów (MF/GUS, VIES).

Przypadki wzięte z kartoteki prod (27.11.2026) i z formatów MF/VIES, na
których stary parser gubił ulicę (FARMEX „44/46”), zostawiał spacje
(„ Košice”, „04022 ”) albo kod w mieście.
"""
import pytest

from app.services import adresy

PL = [
    ("JANA KILIŃSKIEGO 17, 40-001 KATOWICE", "Jana Kilińskiego 17", "40-001", "Katowice"),
    ("UL. KWIATOWA 12, 48-300 NYSA", "Kwiatowa 12", "48-300", "Nysa"),
    ("ZALESIE 41F, 62-300 ZALESIE", "Zalesie 41F", "62-300", "Zalesie"),
    ("BRZEZIE 812 A, 32-002 BRZEZIE", "Brzezie 812A", "32-002", "Brzezie"),
    ("DŁUGA 15B/15C, 31-147 KRAKÓW", "Długa 15B/15C", "31-147", "Kraków"),
    ("PL. GRUNWALDZKI 20B, 50-001 WROCŁAW", "Grunwaldzki 20B", "50-001", "Wrocław"),
    ("KS.KARDYNAŁA STEFANA WYSZYŃSKIEGO 5, 87-100 TORUŃ",
     "ks. Kardynała Stefana Wyszyńskiego 5", "87-100", "Toruń"),
    ("PIOTRKOWSKA 44/46, 90-001 ŁÓDŹ", "Piotrkowska 44/46", "90-001", "Łódź"),
    ("LEGNICKA 208 LOK. 5, 54-200 WROCŁAW", "Legnicka 208/5", "54-200", "Wrocław"),
    ("OPOLSKA 7, 46-061 GÓRKI WIELKIE", "Opolska 7", "46-061", "Górki Wielkie"),
    ("AL. JANA PAWŁA II 12, 43-300 BIELSKO-BIAŁA", "Jana Pawła II 12", "43-300", "Bielsko-Biała"),
]

VIES = [
    ("DE", "Hauptstr. 21\n50667 Köln", "Hauptstr. 21", "50667", "Köln"),
    ("AT", "Hauptplatz 7\nAT-4490 St.Florian-Markt", "Hauptplatz 7", "4490",
     "St.Florian-Markt"),
    ("SK", "Hlavná 1200/4\n04011 Košice - mestská časť Juh\nSlovensko",
     "Hlavná 1200/4", "040 11", "Košice - mestská časť Juh"),
    ("CZ", "Polní 45\nHOSTIVICE\n253 01  HOSTIVICE", "Polní 45", "253 01", "Hostivice"),
    ("SI", "TRŽAŠKA CESTA 9 A, 1000 LJUBLJANA", "Tržaška Cesta 9A", "1000",
     "Ljubljana"),
    ("ES", "CALLE MAYOR 6 1 12001 BENICASSIM CASTELLON", "Calle Mayor 6 1", "12001",
     "Benicassim Castellon"),
    ("FR", "AV DE LA GARE 12/24\n93000 BOBIGNY", "Av de la Gare 12/24", "93000", "Bobigny"),
    ("BE", "Kerkstraat 10\n2000 Antwerpen", "Kerkstraat 10", "2000", "Antwerpen"),
    ("IT", "VIA DEI MILLE 323 \n12100 CUNEO CN\n", "Via dei Mille 323",
     "12100", "Cuneo CN"),
    ("NL", "Keizersgracht 1\n1015CJ Amsterdam", "Keizersgracht 1", "1015 CJ", "Amsterdam"),
]


@pytest.mark.parametrize("napis,ulica,kod,miasto", PL)
def test_rozbij_pl(napis, ulica, kod, miasto):
    r = adresy.rozbij_adres_pl(napis)
    assert (r["ulica"], r["kod_pocztowy"], r["miasto"]) == (ulica, kod, miasto)
    assert r["surowy"] == napis


@pytest.mark.parametrize("kraj,napis,ulica,kod,miasto", VIES)
def test_rozbij_vies(kraj, napis, ulica, kod, miasto):
    r = adresy.rozbij_adres_vies(napis, kraj)
    assert (r["ulica"], r["kod_pocztowy"], r["miasto"]) == (ulica, kod, miasto)
    assert r["surowy"] == napis


def test_nieznany_format_zwraca_surowy():
    r = adresy.rozbij_adres_pl("BRAK ADRESU")
    assert r == {"ulica": "", "kod_pocztowy": "", "miasto": "", "surowy": "BRAK ADRESU"}


def test_pusty_adres():
    assert adresy.rozbij_adres_pl("") == {"ulica": "", "kod_pocztowy": "", "miasto": "", "surowy": ""}
    assert adresy.rozbij_adres_vies("", "DE")["ulica"] == ""


def test_ladne_litery_nie_rusza_mieszanych():
    assert adresy.ladne_litery("Hauptstr. 21") == "Hauptstr. 21"
    assert adresy.ladne_litery("GÓRKI WIELKIE") == "Górki Wielkie"


def test_normalizuj_kod():
    assert adresy.normalizuj_kod("04022 ", "SK") == "040 22"
    assert adresy.normalizuj_kod("40001", "PL") == "40-001"
    assert adresy.normalizuj_kod("1015CJ", "NL") == "1015 CJ"
    assert adresy.normalizuj_kod(" 4490", "AT") == "4490"
    assert adresy.normalizuj_kod("253 01", "CZ") == "253 01"


def test_kraj_z_vat():
    assert adresy.kraj_z_vat("ATU12345675") == "AT"
    assert adresy.kraj_z_vat("1112223334") == "PL"
    assert adresy.kraj_z_vat("EL123456789") == "GR"
    assert adresy.kraj_z_vat("") == "PL"
    assert adresy.kraj_z_vat("PL1112223334") == "PL"


def test_kraje_ue():
    assert "AT" in adresy.KRAJE_UE and "XI" in adresy.KRAJE_UE and "GR" in adresy.KRAJE_UE
    assert "CH" not in adresy.KRAJE_UE and "GB" not in adresy.KRAJE_UE


def test_przedrostek_ulicy_tylko_dla_polski():
    """„PL” na początku francuskiej ulicy to „place”, nie polski skrót do usunięcia."""
    r = adresy.rozbij_adres_vies("PL DE LA REPUBLIQUE 5\n75001 PARIS", "FR")
    assert r["ulica"] == "Pl de la Republique 5"
    assert adresy.formatuj_ulice("PL DE LA REPUBLIQUE 5", "FR") == "Pl de la Republique 5"
    assert adresy.formatuj_ulice("PL. GRUNWALDZKI 20B") == "Grunwaldzki 20B"


def test_slowo_na_m_to_nie_numer_lokalu():
    """Przegląd 27.11: „M” w regule lokalu zjadało ostatnie słowo ulicy."""
    assert adresy.formatuj_ulice("12 RUE DU MOULIN", "FR") == "12 Rue du Moulin"
    assert adresy.formatuj_ulice("3 AVENUE MOZART", "FR") == "3 Avenue Mozart"
    assert adresy.formatuj_ulice("PLAC MICKIEWICZA") == "Plac Mickiewicza"
    assert adresy.formatuj_ulice("Am Markt", "DE") == "Am Markt"
    r = adresy.rozbij_adres_vies("Park Komenského 13\n04022 Košice - mestská časť Staré Mesto", "SK")
    assert r["ulica"] == "Park Komenského 13" and r["miasto"] == "Košice - mestská časť Staré Mesto"
    assert adresy.formatuj_ulice("LEGNICKA 208 LOK. 5") == "Legnicka 208/5"
    assert adresy.formatuj_ulice("DŁUGA 12 M. 3") == "Długa 12/3"
    assert adresy.formatuj_ulice("DŁUGA 12 M 3") == "Długa 12/3"
