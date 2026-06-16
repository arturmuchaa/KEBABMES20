"""Czysta logika wygasania sesji (idle timeout, przesuwany).

Wzorzec jak `lockout.py`: bez I/O, łatwe do testowania. Wywołujący (auth_service)
ustawia `expires_at` przy tworzeniu sesji i odświeża je przy każdym użyciu
(sliding expiration), a `is_expired` decyduje o odrzuceniu martwego tokenu.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

# Idle timeout sesji. Sesja aktywnie używana jest odświeżana (sliding), więc
# limit dotyczy bezczynności — token porzucony/wykradziony wygasa po tym czasie.
SESSION_TTL_HOURS = 12


def next_expiry(now: datetime) -> datetime:
    """Nowy moment wygaśnięcia liczony od `now`. Przekazuj datetime aware."""
    return now + timedelta(hours=SESSION_TTL_HOURS)


def is_expired(expires_at: Optional[datetime], now: datetime) -> bool:
    """True jeśli sesja wygasła. NULL (legacy, sprzed wdrożenia) = nie wygasła."""
    if expires_at is None:
        return False
    return expires_at < now
