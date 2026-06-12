"""Production sessions (daily open/close wrappers for deboning + production)."""
import datetime as dt
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import (
    cx_execute_returning,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _prod_date() -> str:
    """Business day: before 04:00 the previous calendar day counts."""
    now = dt.datetime.now()
    if now.hour < 4:
        return (now.date() - dt.timedelta(days=1)).isoformat()
    return now.date().isoformat()


def _map(row: Optional[Dict]) -> Optional[Dict]:
    if not row:
        return None
    return {
        "id": row["id"],
        "sessionDate": str(row["session_date"]) if row.get("session_date") else "",
        "processType": row.get("process_type", "deboning"),
        "status": row.get("status", "open"),
        "startedAt": row.get("started_at", "") or "",
        "endedAt": row.get("ended_at"),
        "approvedBy": row.get("approved_by"),
        "approvedAt": row.get("approved_at"),
        "notes": row.get("notes"),
        "createdAt": row.get("created_at", "") or "",
    }


def list_sessions(process_type: str) -> List[Dict]:
    rows = query_all(
        "SELECT * FROM production_sessions WHERE process_type=%s "
        "ORDER BY created_at DESC",
        (process_type,),
    )
    return [_map(r) for r in rows]  # type: ignore[list-item]


def get_active_session(process_type: str) -> Optional[Dict]:
    """Sesja DZISIEJSZEGO dnia roboczego, jeszcze nie zatwierdzona przez biuro.

    Zwraca status 'open' (operator pracuje) lub 'closed' (operator zakończył,
    biuro musi potwierdzić). Pomija 'approved' (dzień zamknięty).

    Tylko bieżąca data biznesowa — sesje z poprzednich dni NIE są "aktywne"
    (jeden dzień = jedna sesja; zaległe niezatwierdzone widać w list_pending,
    a dashboard pokazuje je jako zaległość do potwierdzenia, nie jako LIVE).
    """
    row = query_one(
        "SELECT * FROM production_sessions "
        "WHERE process_type=%s AND session_date=%s AND status IN ('open','closed') "
        "ORDER BY created_at DESC LIMIT 1",
        (process_type, _prod_date()),
    )
    return _map(row)


def list_pending() -> List[Dict]:
    """Sesje wymagające potwierdzenia biura (wszystkie procesy).

    Osierocone sesje 'open' z poprzednich dni (operator zapomniał zakończyć)
    są przy odczycie automatycznie domykane (status='closed'), żeby trafiły
    do tej listy zamiast wisieć wiecznie jako "Na żywo".
    """
    today = _prod_date()
    with transaction() as conn:
        from app.db import cx_execute
        cx_execute(
            conn,
            "UPDATE production_sessions "
            "SET status='closed', ended_at=COALESCE(ended_at, %s) "
            "WHERE status='open' AND session_date < %s",
            (now_iso(), today),
        )
    rows = query_all(
        "SELECT * FROM production_sessions WHERE status='closed' "
        "ORDER BY session_date DESC, created_at DESC",
    )
    return [_map(r) for r in rows]  # type: ignore[list-item]


def get_session_by_id(session_id: str) -> Dict:
    row = query_one(
        "SELECT * FROM production_sessions WHERE id=%s", (session_id,)
    )
    if not row:
        raise HTTPException(404, "Sesja nie znaleziona")
    mapped = _map(row)
    assert mapped is not None
    return mapped


def start_session(body: Dict[str, Any]) -> Dict:
    prod_date = _prod_date()
    process_type = body.get("processType", body.get("process_type", "deboning"))
    with transaction() as conn:
        existing = cx_query_one(
            conn,
            "SELECT * FROM production_sessions "
            "WHERE process_type=%s AND session_date=%s AND status='open' "
            "FOR UPDATE",
            (process_type, prod_date),
        )
        if existing:
            mapped = _map(existing)
            assert mapped is not None
            return mapped
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO production_sessions
                (id, session_date, process_type, status, started_at, created_at)
            VALUES (%s,%s,%s,'open',%s,%s)
            RETURNING *
            """,
            (cuid(), prod_date, process_type, now_iso(), now_iso()),
        )
    assert row is not None
    logger.info(
        "production_session.started",
        extra={"id": row["id"], "process_type": process_type, "date": prod_date},
    )
    mapped = _map(row)
    assert mapped is not None
    return mapped


def close_session(session_id: str, body: Dict[str, Any]) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE production_sessions
            SET status='closed', ended_at=%s, notes=%s
            WHERE id=%s AND status='open'
            RETURNING *
            """,
            (now_iso(), body.get("notes"), session_id),
        )
    if not row:
        raise HTTPException(404, "Sesja nie znaleziona lub już zamknięta")
    logger.info("production_session.closed", extra={"id": session_id})
    mapped = _map(row)
    assert mapped is not None
    return mapped


def approve_session(session_id: str, body: Dict[str, Any]) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE production_sessions
            SET status='approved', approved_by=%s, approved_at=%s
            WHERE id=%s
            RETURNING *
            """,
            (body.get("approvedBy", "office"), now_iso(), session_id),
        )
    if not row:
        raise HTTPException(404, "Sesja nie znaleziona")
    logger.info("production_session.approved", extra={"id": session_id})
    mapped = _map(row)
    assert mapped is not None
    return mapped
