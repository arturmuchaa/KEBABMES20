"""Czysta logika numeracji partii (bez I/O, bez DB).

Jedyne źródło prawdy dla formatów numerów partii w całym systemie:

  * przyjęcie / rozbiór / mieszanie pojedyncze → goły numer, np. "344"
  * mieszanie/produkcja łączona              → "PP{n}", np. "PP1"
  * kebab                                    → "ddmmrr <numer wsadu>",
                                               np. "020626 344" / "020626 PP1"
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional, Union

_BARE_NO_RE = re.compile(r"^\d+$")


def parse_reception_no(raw: Optional[str]) -> Optional[int]:
    """Waliduje ręcznie wpisany numer partii na przyjęciu.

    Zwraca int gdy podano poprawny goły numer (>= 1), ``None`` gdy puste
    (auto-numerowanie), albo rzuca ``ValueError`` gdy format zły.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if not _BARE_NO_RE.match(s):
        raise ValueError("Numer partii musi być liczbą, np. 344")
    val = int(s)
    if val < 1:
        raise ValueError("Numer partii musi być >= 1")
    return val


def format_reception_no(seq: int) -> str:
    """Numer partii przyjęcia = goły numer sekwencji."""
    return str(seq)


def combined_batch_no(n: int) -> str:
    """Numer partii łączonej (kilka partii zmieszanych fizycznie)."""
    return f"PP{n}"


def is_combined(batch_no: Optional[str]) -> bool:
    """Czy dany numer to partia łączona (prefiks PP)."""
    return bool(batch_no) and batch_no.startswith("PP")


def _ddmmrr(produced_date: Union[str, date, datetime]) -> str:
    if isinstance(produced_date, str):
        d = datetime.strptime(produced_date[:10], "%Y-%m-%d").date()
    elif isinstance(produced_date, datetime):
        d = produced_date.date()
    else:
        d = produced_date
    return d.strftime("%d%m%y")


def kebab_batch_no(produced_date: Union[str, date, datetime], batch_no: str) -> str:
    """Numer kebaba = 'ddmmrr <numer wsadu>' (np. '020626 344')."""
    return f"{_ddmmrr(produced_date)} {batch_no}"
