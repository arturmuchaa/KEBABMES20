"""ID and timestamp helpers."""
from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.db import cx_execute, cx_execute_returning, cx_query_one, transaction


def cuid() -> str:
    return uuid.uuid4().hex[:20]


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")


def next_seq(key: str) -> int:
    """Atomically increment a sequence counter. Creates it if missing."""
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE sequences SET value = value + 1 WHERE key = %s RETURNING value",
            (key,),
        )
        if row:
            return int(row["value"])
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO sequences (key, value) VALUES (%s, 1)
            ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
            RETURNING value
            """,
            (key,),
        )
        return int(row["value"]) if row else 1


_SLUG_FOLD = str.maketrans({"ł": "l", "Ł": "L", "ø": "o", "Ø": "O"})


def slugify_for_number(text: str) -> str:
    """ASCII slug safe for use inside a slash-delimited business number."""
    if not text:
        return "KLIENT"
    s = text.translate(_SLUG_FOLD)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").upper()
    return s or "KLIENT"


def _parse_iso_date(raw: str | None) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw))
    except ValueError:
        return None


def format_carton_no(seq: int) -> str:
    """Globalny numer kartonu (= paleta) — 6-cyfrowy z zerami wiodącymi.

    ``1 -> '000001'``. Powyżej miliona nie obcina (``1234567`` zostaje).
    """
    return f"{int(seq):06d}"


def format_dated_no(prefix: str, when, seq: int) -> str:
    """Pure formatter for a dated business number ``PREFIX/dd/mm/rr``.

    ``seq == 1`` (first of the day) yields the bare ``PREFIX/dd/mm/rr``;
    later same-day entries append ``/2``, ``/3`` etc. ``when`` may be a
    ``date`` or ``datetime``.
    """
    date_part = when.strftime("%d/%m/%y")
    base = f"{prefix}/{date_part}"
    return base if seq <= 1 else f"{base}/{seq}"


def next_dated_no(conn, prefix: str, date_raw: str | None = None) -> str:
    """Allocate next business number of the form PREFIX/dd/mm/rr.

    The first entry for a given prefix+date receives the bare PREFIX/dd/mm/rr.
    Subsequent same-day entries get /2, /3 etc. appended. A per-prefix/per-day
    sequences row is row-locked so concurrent calls cannot collide.
    """
    date = _parse_iso_date(date_raw) or datetime.now()
    date_part = date.strftime("%d/%m/%y")
    seq_key = f"dated_no:{prefix}:{date_part}"

    cx_execute(
        conn,
        "INSERT INTO sequences (key, value) VALUES (%s, 0) "
        "ON CONFLICT (key) DO NOTHING",
        (seq_key,),
    )
    row = cx_query_one(
        conn,
        "SELECT value FROM sequences WHERE key = %s FOR UPDATE",
        (seq_key,),
    )
    current = int(row["value"]) if row else 0
    new_val = current + 1
    cx_execute(
        conn,
        "UPDATE sequences SET value = %s WHERE key = %s",
        (new_val, seq_key),
    )
    return format_dated_no(prefix, date, new_val)
