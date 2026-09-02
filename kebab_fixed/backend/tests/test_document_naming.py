"""Nazwa pozycji na dokumentach handlowych — tuleja niestandardowa.

Właściciel (2026-09-02): „na WZ osobna pozycja na niestandardy tulei,
np. YALCIN standardy normalnie rozpisane, a powyżej 65 cm w nawiasie (80cm)
i osobne pozycje". Ta sama zasada na HDI — inaczej dokumenty przestałyby
się zgadzać 1:1, bo ta sama receptura i waga jedzie u was w dwóch tulejach
naraz (YALCIN: KIRMIZI 30 kg w METAL 65CM i METAL 80CM).

Test czysty — bez bazy."""
from app.services.document_naming import (TULEJA_STD_MAX, TULEJA_STD_MIN,
                                          rozmiar_tulei, tuleja_suffix)


def test_czyta_rozmiar_z_nazwy():
    assert rozmiar_tulei("METAL 80CM") == 80
    assert rozmiar_tulei("KARTON 45CM") == 45
    assert rozmiar_tulei("metal 65cm") == 65


def test_nazwa_bez_rozmiaru_nie_ma_rozmiaru():
    assert rozmiar_tulei("Folia stretch") is None
    assert rozmiar_tulei("KARTON KLAPOWY") is None
    assert rozmiar_tulei("") is None
    assert rozmiar_tulei(None) is None


def test_standard_nie_dostaje_dopisku():
    """45-65 cm to codzienna tuleja — dopisek byłby szumem na papierze."""
    for n in ("METAL 45CM", "METAL 50CM", "KARTON 60CM", "METAL 65CM"):
        assert tuleja_suffix(n) == ""


def test_niestandard_dostaje_dopisek_w_nawiasie():
    assert tuleja_suffix("METAL 80CM") == " (80cm)"
    assert tuleja_suffix("METAL 75CM") == " (75cm)"
    assert tuleja_suffix("METAL 70CM") == " (70cm)"


def test_granice_zakresu_sa_standardem():
    assert tuleja_suffix(f"METAL {TULEJA_STD_MIN}CM") == ""
    assert tuleja_suffix(f"METAL {TULEJA_STD_MAX}CM") == ""
    assert tuleja_suffix(f"METAL {TULEJA_STD_MAX + 1}CM") == f" ({TULEJA_STD_MAX + 1}cm)"


def test_tuleja_ponizej_zakresu_tez_jest_niestandardem():
    """Zakład bierze 45-65 cm. Cokolwiek spoza tego wymaga oznaczenia —
    także tuleja krótsza, gdyby kiedyś doszła."""
    assert tuleja_suffix("METAL 40CM") == " (40cm)"


def test_brak_rozmiaru_nie_dodaje_dopisku():
    """Folia i karton klapowy to nie tuleje — nie ma czego oznaczać.
    (Do sortowania traktujemy je jak niestandard, ale na papierze
    dopisek '(0cm)' byłby bez sensu.)"""
    assert tuleja_suffix("Folia stretch") == ""
    assert tuleja_suffix("") == ""
    assert tuleja_suffix(None) == ""
