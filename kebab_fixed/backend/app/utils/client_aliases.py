"""Nazwy tego samego klienta z kartoteki.

Hala 25.09.2026: karton ZAGROS 40×20 kg, dziś wyprodukowane 40×20 kg, a panel
„nie pasuje do tego kartonu". Kartoteka trzyma klienta pod DWIEMA nazwami:
`name` (pełna nazwa firmy, np. „OKAYTEKIN KG") i `display_name` (skrót, którym
posługuje się hala, np. „ZAGROS"). Sztuki z produkcji niosą jedną, zamówienie
drugą — a porównanie szło po napisie. Klient to tożsamość z kartoteki.
"""
from __future__ import annotations

from typing import Optional, Set

from app.db import query_all


def nazwy_klienta(client_id: Optional[str] = None, nazwa: Optional[str] = None) -> Set[str]:
    """Wszystkie nazwy klienta: po id i/lub po dowolnej z jego nazw."""
    out: Set[str] = set()
    if nazwa and nazwa.strip():
        out.add(nazwa.strip())
    rows = []
    if client_id:
        rows += query_all("SELECT name, display_name FROM clients WHERE id=%s", (client_id,))
    if nazwa and nazwa.strip():
        rows += query_all(
            "SELECT name, display_name FROM clients "
            "WHERE lower(trim(name)) = lower(trim(%s)) OR lower(trim(display_name)) = lower(trim(%s))",
            (nazwa, nazwa),
        )
    for r in rows:
        for n in (r.get("name"), r.get("display_name")):
            if n and n.strip():
                out.add(n.strip())
    return out
