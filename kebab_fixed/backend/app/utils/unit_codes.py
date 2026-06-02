"""Czysta logika kodów sztuk (bez DB/IO).

Token QR sztuki: 'U|<unit_id>' (analogicznie do 'PAL|<order>|<no>' palet).
Statusy sztuki: planned → produced → packed → shipped.
"""
from __future__ import annotations

from typing import Optional

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
