"""Trasy rozliczeń MUSZĄ być zarejestrowane w aplikacji (wzór: rozrachunki).

Patrzymy na schemat OpenAPI — publiczny kontrakt, nie wnętrze routera.
"""
from __future__ import annotations

from app.auth.permissions import permission_for_path
from app.main import app


def _sciezki() -> set:
    return set(app.openapi()["paths"])


def test_trasy_rozliczen_sa_dostepne_po_http():
    for p in ("/api/rozliczenia", "/api/rozliczenia/ustawienia",
              "/api/rozliczenia/klient/{client_id}",
              "/api/rozliczenia/klient/{client_id}/faktury",
              "/api/rozliczenia/klient/{client_id}/wplaty",
              "/api/rozliczenia/dokumenty/{dokument_id}",
              "/api/rozliczenia/na-wz/{wz_id}",
              "/api/rozliczenia/klient/{client_id}/zestawienie/pdf",
              "/api/rozliczenia/klient/{client_id}/historia/pdf"):
        assert p in _sciezki(), p


def test_rozliczenia_wymagaja_uprawnienia_biura():
    assert permission_for_path("/api/rozliczenia") == "office"
    assert permission_for_path("/api/rozliczenia/klient/c1/faktury", "POST") == "office"
