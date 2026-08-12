"""Magazyn skanów HDI — dokument dostawy do okazania przy kontroli."""
from app.services.hdi_scan_store import is_safe_id


def test_identyfikator_z_zewnatrz_nie_moze_wyjsc_z_katalogu():
    """Identyfikator trafia do ŚCIEŻKI pliku, więc bez tej kontroli
    „../../etc/passwd" czytałoby cokolwiek na serwerze."""
    for zly in ("../../etc/passwd", "a/b", "a\\b", "", "..", "x" * 200, "kot!"):
        assert is_safe_id(zly) is False


def test_zwykly_identyfikator_przechodzi():
    assert is_safe_id("cl9k2x8v0000qwer") is True
    assert is_safe_id("abc-DEF_123") is True
