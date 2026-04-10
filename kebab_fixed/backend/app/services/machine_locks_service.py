"""Machine locks (prevents two mixing orders on one mixer)."""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_execute_rowcount,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def list_locks() -> List[Dict]:
    return query_all(
        "SELECT * FROM machine_locks WHERE expires_at > NOW() ORDER BY machine_id"
    )


def lock_machine(body: Dict[str, Any]) -> Dict:
    machine_id = body.get("machine_id")
    minutes = int(body.get("minutes", 60) or 60)
    with transaction() as conn:
        cx_execute(
            conn, "DELETE FROM machine_locks WHERE machine_id=%s", (machine_id,)
        )
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO machine_locks
                (id, machine_id, order_id, order_no, locked_at, expires_at)
            VALUES (%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                machine_id,
                body.get("order_id", ""),
                body.get("order_no", ""),
                now_iso(),
                (datetime.utcnow() + timedelta(minutes=minutes)).isoformat() + "Z",
            ),
        )
    assert row is not None
    logger.info(
        "machine_lock.created",
        extra={"machine_id": machine_id, "minutes": minutes},
    )
    return row


def is_locked(machine_id: int) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM machine_locks WHERE machine_id=%s AND expires_at > NOW()",
        (machine_id,),
    )
    return {"locked": row is not None, "lock": row}


def unlock_machine(machine_id: int) -> Dict[str, bool]:
    with transaction() as conn:
        cx_execute_rowcount(
            conn, "DELETE FROM machine_locks WHERE machine_id=%s", (machine_id,)
        )
    logger.info("machine_lock.released", extra={"machine_id": machine_id})
    return {"ok": True}
