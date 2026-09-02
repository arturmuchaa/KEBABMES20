"""Kto dosięga tras podpisu.

Warstwa prefiksów jest DEFAULT-DENY: nowy endpoint bez wpisu dostaje
„office", a kiosk rozbioru dostałby 403 — i wzoru nie dałoby się narysować
na jedynym dotykowym ekranie w zakładzie. Test czysty, bez bazy."""
from app.auth.permissions import can_access, permission_for_path

KIOSK = {"kind": "operator", "departments": ["rozbior"]}
KIOSK_INNY = {"kind": "operator", "departments": ["pakowanie"]}
BIURO = {"kind": "office", "role": "office"}


def test_wzory_dostepne_dla_kiosku_rozbioru():
    p = permission_for_path("/api/signature-samples/w-1", "PUT")
    assert can_access(KIOSK, p)


def test_wzory_dostepne_tez_dla_biura():
    """Biuro potrzebuje podglądu wzoru w dialogu podpisu."""
    p = permission_for_path("/api/signature-samples/w-1", "GET")
    assert can_access(BIURO, p)


def test_wzory_niedostepne_dla_innego_dzialu():
    p = permission_for_path("/api/signature-samples/w-1", "PUT")
    assert not can_access(KIOSK_INNY, p)


def test_skladanie_podpisu_zostaje_w_biurze():
    """Sam dokument podpisuje się z biura — kiosk tylko rysuje wzór."""
    p = permission_for_path("/api/signatures", "POST")
    assert can_access(BIURO, p)
    assert not can_access(KIOSK, p)


def test_niezalogowany_nie_wchodzi_nigdzie():
    for sciezka in ("/api/signatures", "/api/signature-samples/w-1"):
        assert not can_access(None, permission_for_path(sciezka, "GET"))
