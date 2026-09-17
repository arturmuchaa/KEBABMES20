"""Każdy kiosk hali musi mieć KOMPLET tras swojego kanału aktualizacji.

POWÓD ISTNIENIA: 17.09.2026 build instalatora masowni przeszedł, a publikacja
na kanał padła na 405 — bo trasy kanału `masowanie` w backendzie nie było
wcale. Zielony build przy niedziałającej publikacji to kiosk, który cicho
stoi na starej wersji, więc brak kanału ma wychodzić TUTAJ, a nie na runnerze
Windows po kwadransie kompilacji Rusta.

Kanały biorą się z workflowów wydań (`.github/workflows/tauri-*.yml`), a trasy
czytamy ze ŹRÓDEŁ `app/routes/`, nie z żywego obiektu `app`. Pierwsza wersja
tego testu introspekcjonowała `app.routes` i przeszła lokalnie, a w CI
wywróciła się na WSZYSTKICH kanałach — zestaw tras zależał od środowiska.
Skan źródeł odpowiada na to samo pytanie i daje tę samą odpowiedź wszędzie.
"""
import re
from pathlib import Path

import pytest

KORZEN = Path(__file__).resolve().parents[3]
WORKFLOWS = KORZEN / ".github" / "workflows"
ROUTES = Path(__file__).resolve().parents[1] / "app" / "routes"

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


def _zrodla_tras() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in ROUTES.glob("*.py"))


KANALY = sorted(_kanaly_z_workflowow())


def test_workflowy_w_ogole_wskazuja_jakies_kanaly():
    # Gdyby regex przestał łapać, reszta testów przechodziłaby pusta.
    assert KANALY, "nie znalazłem żadnego kanału w .github/workflows/tauri-*.yml"


@pytest.mark.parametrize("kanal", KANALY)
def test_kanal_przyjmuje_publikacje_instalatora(kanal):
    sciezka = f"/api/admin/desktop-updates/{kanal}/publish"
    wzor = re.compile(
        r"@router\.post\(\s*[\"']" + re.escape(sciezka) + r"[\"']", re.MULTILINE
    )
    assert wzor.search(_zrodla_tras()), (
        f"kanał {kanal} nie ma POST {sciezka} w app/routes/ — publikacja padnie na 405"
    )


@pytest.mark.parametrize("kanal", KANALY)
def test_kanal_wystawia_manifest_dla_updatera(kanal):
    # Bez manifestu kiosk nigdy nie dowie się o nowej wersji.
    sciezka = f"/api/desktop-updates/{kanal}/latest.json"
    assert f'"{sciezka}"' in _zrodla_tras() or f"'{sciezka}'" in _zrodla_tras(), (
        f"kanał {kanal} nie wystawia manifestu {sciezka}"
    )


def test_straznik_lapie_kanal_bez_trasy():
    # Test testu: gdyby wzorzec przestał cokolwiek weryfikować, powyższe
    # przechodziłyby dla dowolnej nazwy kanału.
    wzor = re.compile(
        r"@router\.post\(\s*[\"']/api/admin/desktop-updates/nieistniejacy/publish[\"']"
    )
    assert not wzor.search(_zrodla_tras())


def test_kanal_masowania_ma_osobny_katalog_meta():
    # Wspólny katalog oznaczałby, że masownia pobiera instalator produkcji.
    masownia = (ROUTES / "desktop_updates_masowanie.py").read_text(encoding="utf-8")
    produkcja = (ROUTES / "desktop_updates_produkcja.py").read_text(encoding="utf-8")
    assert 'desktop_updates_dir / "masowanie"' in masownia
    assert 'desktop_updates_dir / "produkcja"' in produkcja
