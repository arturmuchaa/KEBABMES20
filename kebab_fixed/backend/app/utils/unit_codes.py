"""Czysta logika kodów sztuk (bez DB/IO).

Token QR sztuki: 'U|<unit_id>' (analogicznie do 'PAL|<order>|<no>' palet).
Statusy sztuki: planned → produced → packed → shipped.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

PLANNED = "planned"
PRODUCED = "produced"
PACKED = "packed"
SHIPPED = "shipped"

_PREFIX = "U|"


def unit_qr(unit_id: str) -> str:
    """Token QR dla sztuki."""
    return f"{_PREFIX}{unit_id}"


def parse_unit_qr(code: Optional[str]) -> Optional[str]:
    """Wyciąga unit_id z tokenu 'U|<id>'. Zwraca None gdy to nie token sztuki."""
    if not code:
        return None
    s = code.strip()
    if not s.startswith(_PREFIX):
        return None
    unit_id = s[len(_PREFIX):]
    return unit_id or None


def next_produced_status(current: str) -> str:
    """Przejście przy skanie produkcyjnym. Tylko z 'planned'.

    Skan sztuki już 'produced'/'packed'/'shipped' to DUBEL → ValueError.
    """
    if current == PLANNED:
        return PRODUCED
    raise ValueError("Sztuka już zeskanowana na produkcji")


def best_before(produced_date: str, shelf_life_days: int) -> str:
    """Termin przydatności = data produkcji + dni. Pusta data → ''."""
    if not produced_date:
        return ""
    d = datetime.strptime(produced_date[:10], "%Y-%m-%d").date()
    return (d + timedelta(days=int(shelf_life_days or 0))).isoformat()


def validate_pack(unit: Dict, carton: Dict) -> Tuple[bool, str]:
    """Walidacja sztuki do kartonu. Zwraca (ok, powód_błędu)."""
    if unit.get("status") != PRODUCED:
        if unit.get("status") == PACKED:
            return False, "Sztuka już spakowana"
        return False, "Sztuka nie potwierdzona na produkcji"
    if unit.get("carton_id"):
        return False, "Sztuka już spakowana"
    if int(carton.get("packed_qty") or 0) >= int(carton.get("target_qty") or 0):
        return False, "Karton pełny"
    if (unit.get("product_type_id") or "") != (carton.get("product_type_id") or ""):
        return False, "Inny produkt niż w kartonie"
    if (unit.get("recipe_id") or "") != (carton.get("recipe_id") or ""):
        return False, "Inna receptura niż w kartonie"
    if abs(float(unit.get("weight_kg") or 0) - float(carton.get("target_weight_kg") or 0)) > 0.001:
        return False, f"Inna waga: {float(unit.get('weight_kg') or 0):g} kg, karton wymaga {float(carton.get('target_weight_kg') or 0):g} kg"
    carton_client = (carton.get("client_name") or "")
    if carton_client and carton_client != "STAN" and (unit.get("client_name") or "") != carton_client:
        return False, "Inny klient niż w kartonie"
    return True, ""
