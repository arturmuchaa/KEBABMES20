"""Kody pozycji magazynów słownikowych (przyprawy, tuleje i opakowania).

Kod to KRÓTKI, STAŁY uchwyt pozycji — nie klasyfikacja. Nie koduje kategorii
ani przeznaczenia, bo takiego kodu nikt nie utrzyma; ma tylko odróżnić
„METAL 60CM" od „KARTON 60CM" bez czytania całej nazwy.

Tuleje mają kod CZYTELNY (`TUL-M60`), bo ich nazwa i tak koduje materiał
i rozmiar — kod ją tylko skraca. Reszta dostaje prefiks i licznik, bo nie ma
czego skracać.
"""
import re
from typing import Optional

#: „METAL 65CM", „metal 65 cm", „Tuleja metal 65cm" → materiał M, rozmiar 65.
_TULEJA_RE = re.compile(
    r"(?:^|\s)(metal|karton)\w*\s*(\d{2,3})\s*cm\b", re.IGNORECASE)

PREFIKSY = {"tuleja": "TUL", "opakowanie": "OPA", "inne": "INN"}


def kod_tulei(name: str) -> Optional[str]:
    """`TUL-M65` / `TUL-K65` z nazwy tulei; None, gdy nazwa nie pasuje."""
    m = _TULEJA_RE.search(name or "")
    if not m:
        return None
    materialy = {"metal": "M", "karton": "K"}
    return f"TUL-{materialy[m.group(1).lower()]}{int(m.group(2))}"


def prefiks_opakowania(packaging_type: str) -> str:
    """Prefiks kodu wg rodzaju pozycji; nieznany rodzaj trafia do `INN`."""
    return PREFIKSY.get((packaging_type or "").strip().lower(), "INN")


def kod_z_licznika(prefiks: str, seq: int) -> str:
    return f"{prefiks}-{str(seq).zfill(3)}"


def normalizuj_kod(code: str) -> str:
    """Kod bez spacji i wielkimi literami — żeby „tul-m60" i „TUL-M60"
    nie były dwiema pozycjami."""
    return re.sub(r"\s+", "", (code or "")).upper()
