"""Czysta logika blokady kont po błędnych próbach logowania."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Tuple

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15


def register_failure(
    current_attempts: int, now: datetime
) -> Tuple[int, Optional[datetime]]:
    """Zwraca (nowa_liczba_prob, locked_until|None) po nieudanej probie.

    Wywołuj tylko dla nieudanej próby na NIEzablokowanym koncie (sprawdź wcześniej
    is_locked). Przekazuj datetime z timezone (aware), spójnie w całym kodzie.
    """
    attempts = current_attempts + 1
    if attempts >= MAX_ATTEMPTS:
        return attempts, now + timedelta(minutes=LOCK_MINUTES)
    return attempts, None


def is_locked(locked_until: Optional[datetime], now: datetime) -> bool:
    return locked_until is not None and locked_until > now
