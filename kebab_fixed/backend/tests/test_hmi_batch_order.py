"""Testy normalizacji kolejności partii na pasku HMI rozbioru.

Czysta walidacja — bez bazy, więc działa też w CI.
"""
import pytest

from app.services.settings_service import normalize_batch_order, MAX_BATCH_ORDER


def test_pusta_konfiguracja_daje_pusta_liste():
    assert normalize_batch_order(None) == []
    assert normalize_batch_order([]) == []


def test_zachowuje_kolejnosc_podana_przez_hale():
    assert normalize_batch_order(["467", "468", "466"]) == ["467", "468", "466"]


def test_usuwa_duplikaty_zachowujac_pierwsze_wystapienie():
    # duplikat znaczylby ten sam kafel dwa razy na pasku
    assert normalize_batch_order(["467", "466", "467"]) == ["467", "466"]


def test_pomija_puste_i_biale_znaki():
    assert normalize_batch_order(["467", "", "  ", " 468 "]) == ["467", "468"]


def test_liczby_sa_zamieniane_na_tekst():
    assert normalize_batch_order([467, 468]) == ["467", "468"]


def test_odrzuca_wartosc_ktora_nie_jest_lista():
    with pytest.raises(ValueError):
        normalize_batch_order("467")
    with pytest.raises(ValueError):
        normalize_batch_order({"order": "467"})


def test_odrzuca_zbyt_dlugi_numer_partii():
    with pytest.raises(ValueError):
        normalize_batch_order(["x" * 33])


def test_odrzuca_liste_ponad_limit():
    with pytest.raises(ValueError):
        normalize_batch_order([str(i) for i in range(MAX_BATCH_ORDER + 1)])


def test_limit_dokladnie_na_granicy_przechodzi():
    out = normalize_batch_order([str(i) for i in range(MAX_BATCH_ORDER)])
    assert len(out) == MAX_BATCH_ORDER
