"""Trasy rozrachunków MUSZĄ być zarejestrowane w aplikacji.

Recenzja 24.09.2026 złapała, że `main.py` ma listę modułów ZASZYTĄ NA SZTYWNO
— `rozrachunki` w niej nie było, więc cały moduł zwracał 404. Ekran pokazywał
wtedy „Nikt nie ma włączonego rozliczenia": wyglądało na brak konfiguracji,
a było awarią.

Testy tras wołały funkcje modułu WPROST (`route.karta("c1")`), więc nie
dotykały rejestracji. Ten test patrzy na `app.routes` — czyli na to, co
naprawdę obsłuży żądanie.
"""
from __future__ import annotations

from app.main import app


def _sciezki() -> set:
    return {getattr(r, "path", "") for r in app.routes}


def test_lista_rozrachunkow_jest_dostepna_po_http():
    assert "/api/rozrachunki" in _sciezki()


def test_karta_kontrahenta_jest_dostepna_po_http():
    assert "/api/rozrachunki/{client_id}" in _sciezki()


def test_zapisy_sa_dostepne_po_http():
    for p in ("/api/rozrachunki/{client_id}/otwarcie",
              "/api/rozrachunki/{client_id}/faktura",
              "/api/rozrachunki/{client_id}/wplata",
              "/api/rozrachunki/dostawa/{order_id}"):
        assert p in _sciezki(), p


def test_ustawienie_rozliczenia_klienta_jest_dostepne_po_http():
    assert "/api/clients/{client_id}/rozliczenie" in _sciezki()
