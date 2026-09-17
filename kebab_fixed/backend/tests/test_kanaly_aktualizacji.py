"""Każdy kiosk hali musi mieć KOMPLET tras swojego kanału aktualizacji.

POWÓD ISTNIENIA: 17.09.2026 build instalatora masowni przeszedł, a publikacja
na kanał padła na 405 — bo trasy kanału `masowanie` w backendzie nie było
wcale. Zielony build przy niedziałającej publikacji to kiosk, który cicho
stoi na starej wersji, więc brak kanału ma wychodzić TUTAJ, a nie na runnerze
Windows po kwadransie kompilacji Rusta.

Kanały biorą się z workflowów wydań (`.github/workflows/tauri-*.yml`) — dopisanie
nowego kiosku bez trasy zapala ten test.
"""
import re
from pathlib import Path

import pytest

from app.main import app

WORKFLOWS = Path(__file__).resolve().parents[3] / ".github" / "workflows"

#: Kanał główny (aplikacja biurowa) publikuje pod /api/admin/desktop-updates/publish
#: — bez segmentu kanału, bo był pierwszy. Nie dotyczy kiosków hali.
BEZ_SEGMENTU = {"tauri-build"}


def _kanaly_z_workflowow() -> set[str]:
    kanaly = set()
    for plik in WORKFLOWS.glob("tauri-*.yml"):
        if plik.stem in BEZ_SEGMENTU:
            continue
        tresc = plik.read_text(encoding="utf-8")
        for m in re.finditer(r"/api/admin/desktop-updates/([a-z0-9\-]+)/publish", tresc):
            kanaly.add(m.group(1))
    return kanaly


def _sciezki() -> set[str]:
    return {getattr(r, "path", "") for r in app.routes}


def _metody(sciezka: str) -> set[str]:
    for r in app.routes:
        if getattr(r, "path", "") == sciezka:
            return set(getattr(r, "methods", set()) or set())
    return set()


def test_workflowy_w_ogole_wskazuja_jakies_kanaly():
    # Gdyby regex przestał łapać, reszta testów przechodziłaby pusta.
    assert _kanaly_z_workflowow(), "nie znalazłem żadnego kanału w .github/workflows/tauri-*.yml"


@pytest.mark.parametrize("kanal", sorted(_kanaly_z_workflowow()))
def test_kanal_przyjmuje_publikacje_instalatora(kanal):
    sciezka = f"/api/admin/desktop-updates/{kanal}/publish"
    assert sciezka in _sciezki(), f"kanał {kanal} nie ma trasy publikacji — publikacja padnie na 405"
    assert "POST" in _metody(sciezka)


@pytest.mark.parametrize("kanal", sorted(_kanaly_z_workflowow()))
def test_kanal_wystawia_manifest_dla_updatera(kanal):
    # Bez manifestu kiosk nigdy nie dowie się o nowej wersji.
    assert f"/api/desktop-updates/{kanal}/latest.json" in _sciezki()


def test_kanal_masowania_jest_osobny_od_produkcji():
    # Wspólny katalog meta oznaczałby, że masownia pobiera instalator produkcji.
    from app.routes import desktop_updates_masowanie as m
    from app.routes import desktop_updates_produkcja as p

    assert m._UPDATES_DIR != p._UPDATES_DIR
    assert m._UPDATES_DIR.name == "masowanie"
