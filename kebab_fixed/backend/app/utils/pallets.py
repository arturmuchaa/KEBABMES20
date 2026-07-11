"""Palety ważenia zbiorczego ubocznych (grzbiety/kości) — helper współdzielony
między wz_service (odczyt stanu) i batch_byproducts_service (zapis wagi)."""
from __future__ import annotations

from typing import Any, List, Optional


def pallet_containers(pallets: Optional[List[Any]]) -> int:
    """Suma pojemników z palet ważenia zbiorczego (kreator HMI)."""
    total = 0
    for pal in pallets or []:
        try:
            total += int((pal or {}).get("containers") or 0)
        except (TypeError, ValueError):
            continue
    return total
