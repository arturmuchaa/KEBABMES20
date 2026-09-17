"""Uprawnienia panelu masowni — operator z PIN-em musi dosięgnąć swojego ekranu.

Czysta logika mapy uprawnień, bez bazy.
"""
from app.auth.permissions import can_access, permission_for_path


def operator(*dzialy):
    return {"kind": "operator", "role": "operator", "departments": list(dzialy)}


BIURO = {"kind": "office", "role": "office"}


def test_panel_masowni_nalezy_do_dzialu_masowanie():
    assert permission_for_path("/api/masownia/mieso") == "masowanie"
    assert permission_for_path("/api/masownia/wsady", "POST") == "masowanie"


def test_operator_masowni_wchodzi_na_swoj_panel():
    assert can_access(operator("masowanie"), permission_for_path("/api/masownia/mieso"))


def test_operator_rozbioru_NIE_wchodzi_na_panel_masowni():
    assert not can_access(operator("rozbior"), permission_for_path("/api/masownia/mieso"))


def test_panel_czyta_plan_dnia_masowania():
    # Bez tego kiosk nie ma czego pokazać w kolejce dnia.
    wymagane = permission_for_path("/api/mixing-orders", "GET")
    assert can_access(operator("masowanie"), wymagane)
    assert can_access(operator("produkcja"), wymagane)


def test_uklada_plan_dnia_tylko_biuro():
    # Zlecenia masowania powstają w biurze — kiosk zapisuje przez /api/masownia.
    for metoda in ("POST", "PUT", "PATCH", "DELETE"):
        wymagane = permission_for_path("/api/mixing-orders", metoda)
        assert wymagane == "office"
        assert not can_access(operator("masowanie"), wymagane)
        assert can_access(BIURO, wymagane)


def test_panel_czyta_receptury_zeby_odwazyc_przyprawy():
    wymagane = permission_for_path("/api/recipes", "GET")
    assert can_access(operator("masowanie"), wymagane)


def test_zmiana_receptury_zostaje_w_biurze():
    wymagane = permission_for_path("/api/recipes", "PUT")
    assert wymagane == "office"
    assert not can_access(operator("masowanie"), wymagane)


def test_biuro_ma_nadzbior_uprawnien_panelu():
    assert can_access(BIURO, permission_for_path("/api/masownia/wsady", "POST"))
