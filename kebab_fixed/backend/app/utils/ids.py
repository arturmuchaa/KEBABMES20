"""ID and timestamp helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.db import cx_execute_returning, transaction


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
        # Seed if missing
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
