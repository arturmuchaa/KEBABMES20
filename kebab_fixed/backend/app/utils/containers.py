"""Czysta logika nośników zwrotnych — pojemników E2 i palet (bez I/O, bez DB).

Jedyne źródło prawdy dla:
  * rodzajów rozliczanych nośników i ich etykiet na druku,
  * kalibrów pojemnika E2 (15 kg / 20 kg / niekalibrowany),
  * przeliczenia kg → liczba pojemników,
  * normalizacji NIP i nazwy (scalanie dostawcy i odbiorcy w jednego partnera),
  * formatu numeru dokumentu „WZ na POJEMNIKI".
"""
from __future__ import annotations

import math
import re
from typing import Optional

# Rodzaje rozliczanych nośników. Kolejność = kolejność wierszy na druku.
#
# KAŻDY rodzaj ma własne saldo — siatki E1 nie zwraca się europaletą, więc
# wrzucenie ich do wspólnego worka „palety inne" ukrywałoby, czego brakuje
# (decyzja zakładu 2026-07-30). „pallet_other" zostaje dla danych sprzed
# tego rozbicia i jako awaryjny kosz.
ASSET_TYPES = (
    "e2", "net_e1", "pallet_h1",
    "pallet_euro", "pallet_plastic", "pallet_wood", "pallet_other",
)

#: Pełne etykiety — idą na druk „WZ na POJEMNIKI" (styl zakładowego wzoru).
ASSET_LABELS = {
    "e2": "Ilość pojemników EURO2",
    "net_e1": "Ilość siatek E1",
    "pallet_h1": "Ilość palet H1",
    "pallet_euro": "Ilość europalet",
    "pallet_plastic": "Ilość palet plastikowych",
    "pallet_wood": "Ilość palet drewnianych",
    "pallet_other": "Ilość palet innych",
}

#: Krótkie etykiety — nagłówki tabel na ekranie i w zestawieniach.
ASSET_SHORT = {
    "e2": "Pojemniki E2",
    "net_e1": "Siatki E1",
    "pallet_h1": "Palety H1",
    "pallet_euro": "Europalety",
    "pallet_plastic": "Palety plastik",
    "pallet_wood": "Palety drewno",
    "pallet_other": "Palety inne",
}

#: Lista rozwijana „inne opakowania / palety" na przyjęciu i WZ. H1 i E2 mają
#: własne pola, więc tutaj ich nie ma.
OTHER_CARRIER_KINDS = [
    {"value": "net_e1", "label": "Siatka E1"},
    {"value": "pallet_plastic", "label": "Plastik"},
    {"value": "pallet_euro", "label": "Europaleta"},
    {"value": "pallet_wood", "label": "Paleta drewniana"},
]

# Dozwolone kalibry pojemnika. None = niekalibrowany (operator wpisuje sztuki
# ręcznie — dostawa nie ma jednolitego napełnienia).
CALIBERS = (15.0, 20.0, None)


def containers_for_kg(kg: float, container_kg: Optional[float]) -> Optional[int]:
    """Liczba pojemników E2 dla masy.

    ceil, NIE floor: niepełny pojemnik to nadal jeden fizyczny pojemnik.
    Do 2026-07-29 modal przyjęcia liczył floor, a wz_service ceil — przy
    saldzie ta niespójność gubiłaby jeden pojemnik na każdej niepełnej
    dostawie i saldo rozjeżdżałoby się od pierwszego dnia.

    Zwraca None, gdy kaliber nieznany (niekalibrowany) — wtedy liczbę
    pojemników podaje operator.
    """
    if container_kg is None or container_kg <= 0:
        return None
    if kg <= 0:
        return 0
    return math.ceil(kg / container_kg)


def prorate_containers(
    containers_total: Optional[int], kg_part: float, kg_total: float
) -> Optional[int]:
    """Podpowiedź liczby pojemników dla CZĘŚCI partii niekalibrowanej.

    Partia niekalibrowana ma tylko policzoną sumę pojemników na całości —
    przy wydaniu części masy skalujemy ją proporcjonalnie. Minimum 1, bo
    wydanie niezerowej masy zawsze zajmuje co najmniej jeden pojemnik.
    """
    if not containers_total or kg_total <= 0 or kg_part <= 0:
        return None
    return max(1, round(containers_total * kg_part / kg_total))


def normalize_nip(nip: Optional[str]) -> str:
    """NIP do porównań: same cyfry. '513-006-44-78' → '5130064478'."""
    return re.sub(r"\D", "", nip or "")


def normalize_name(name: Optional[str]) -> str:
    """Nazwa do porównań, gdy kontrahent nie ma NIP-u: małe litery,
    pojedyncze spacje, bez białych znaków na brzegach."""
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def format_container_doc_number(seq: int, year_month: str) -> str:
    """Numer dokumentu pojemnikowego: POJ/NN/MM/RR (wzorzec numeracji WZ).

    year_month = 'RRMM' (np. '2607').
    """
    yy, mm = year_month[:2], year_month[2:]
    return f"POJ/{seq}/{mm}/{yy}"
