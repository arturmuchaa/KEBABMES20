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
ASSET_TYPES = ("e2", "pallet_h1", "pallet_other")

ASSET_LABELS = {
    "e2": "Ilość pojemników EURO2",
    "pallet_h1": "Ilość palet H1",
    "pallet_other": "Ilość palet innych",
}

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
