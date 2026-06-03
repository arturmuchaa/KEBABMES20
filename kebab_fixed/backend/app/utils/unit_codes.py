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


def pallet_line_key(product_type_id, recipe_id, weight) -> tuple:
    """Klucz grupujący pozycję: (produkt, receptura, waga zaokrąglona do 3 miejsc)."""
    return (
        (product_type_id or ""),
        (recipe_id or ""),
        round(float(weight or 0), 3),
    )


def validate_pack_to_pallet(unit, pallet_order_id, planned_by_key, packed_by_key):
    """Czysta walidacja pakowania sztuki do palety.

    unit: dict {status, order_id, product_type_id, recipe_id, weight_kg}
    pallet_order_id: id zamówienia palety
    planned_by_key: {pallet_line_key: planowana liczba szt}
    packed_by_key:  {pallet_line_key: już spakowane szt}
    Zwraca (ok: bool, reason: str, key | None).
    Partia (batch_no) NIE jest kryterium — różne partie dozwolone.
    """
    status = unit.get("status")
    if status != PRODUCED:
        if status == PACKED:
            return False, "Sztuka już spakowana", None
        return False, "Sztuka nie potwierdzona na produkcji", None

    if (unit.get("order_id") or "") != (pallet_order_id or ""):
        return False, "Sztuka z innego zamówienia", None

    key = pallet_line_key(
        unit.get("product_type_id"), unit.get("recipe_id"), unit.get("weight_kg"))
    if key not in planned_by_key:
        return False, "Inny produkt/waga niż na palecie", None

    if int(packed_by_key.get(key, 0)) >= int(planned_by_key[key]):
        return False, "Pozycja palety pełna", None

    return True, "", key
