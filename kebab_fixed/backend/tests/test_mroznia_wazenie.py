"""RBAC ważenia przy mroźni: kiosk (wydanie) waży i czyta tary, tary zmienia biuro."""
from app.auth.permissions import permission_for_path


def test_rbac_mroznia_wazenie():
    assert permission_for_path("/api/magazyn/mroznia/palety", "GET") == "wydanie"
    assert permission_for_path("/api/magazyn/mroznia/palety", "PUT") == "office"
    assert permission_for_path("/api/magazyn/mroznia/sprawdz", "POST") == "wydanie"
    assert permission_for_path("/api/magazyn/mroznia/wazenie", "POST") == "wydanie"
    assert permission_for_path("/api/magazyn/mroznia/wazenie/abc", "GET") == "wydanie"


def test_trasy_zarejestrowane():
    from app.main import app
    paths = app.openapi()["paths"]
    for p in ("/api/magazyn/mroznia/palety", "/api/magazyn/mroznia/sprawdz",
              "/api/magazyn/mroznia/wazenie", "/api/magazyn/mroznia/wazenie/{container_id}"):
        assert p in paths


# ── Kartka palety zniekształcona przez skaner (29.09.2026) ─────────────────
import pytest

from app.services.pallets_service import parse_code

_ID = "6890e863376444ceaa10"


@pytest.mark.parametrize("kod", [
    f"HTTP://TAURI.LOCALHOST/M/P/{_ID.upper()}/7",
    f"http:--tauri.localhost-m-p-{_ID}-7",
    f"PAL<{_ID}<7",
    f"pal\\{_ID.upper()}\\7",
    f"]Q1PAL|{_ID}|7\x03",
])
def test_kartka_palety_mimo_ukladu_klawiatury(kod):
    assert parse_code(kod) == (_ID, 7)


def test_dokladne_formy_bez_zmian():
    assert parse_code("PAL|Zam1|2") == ("Zam1", 2)
    assert parse_code("http://h/m/p/AbC123/12") == ("AbC123", 12)
