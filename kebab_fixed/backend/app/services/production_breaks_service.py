"""Przerwy zmiany produkcyjnej — zapisywane, nie tylko pokazywane.

Do 27.08.2026 przerwa żyła wyłącznie w stanie ekranu HMI: odświeżenie kiosku
kasowało ją razem z blokadą zapisu sztuk, która na niej stoi. Teraz źródłem
prawdy jest serwer, a ekran trzyma kopię tylko po to, żeby zareagować
natychmiast.

Czas przerw jest potrzebny dwa razy: odejmuje się go od roboczogodzin przy
uczeniu tempa i dolicza do prognozowanej godziny zakończenia.
"""
from typing import Any, Dict, List

from app.db import cx_execute_rowcount, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def start_break(plan_id: str) -> Dict[str, Any]:
    """Zacznij przerwę. Druga przy trwającej pierwszej nic nie robi —
    podwójne dotknięcie liczyłoby czas przerwy dwa razy."""
    with transaction() as conn:
        trwa = cx_query_one(
            conn,
            "SELECT id FROM production_breaks WHERE plan_id=%s AND ended_at IS NULL "
            "ORDER BY started_at DESC LIMIT 1",
            (plan_id,),
        )
        if trwa:
            return {"ok": True, "breakId": trwa["id"], "alreadyOpen": True}
        bid = cuid()
        cx_execute_rowcount(
            conn,
            "INSERT INTO production_breaks (id, plan_id, started_at) VALUES (%s,%s, now())",
            (bid, plan_id),
        )
    logger.info("production.break_started", extra={"plan_id": plan_id})
    return {"ok": True, "breakId": bid}


def end_break(plan_id: str) -> Dict[str, Any]:
    """Domknij trwającą przerwę. Brak takiej to nie błąd — ekran mógł ją
    domknąć wcześniej, a operator kliknął drugi raz."""
    with transaction() as conn:
        ile = cx_execute_rowcount(
            conn,
            "UPDATE production_breaks SET ended_at = now() "
            "WHERE plan_id=%s AND ended_at IS NULL",
            (plan_id,),
        )
    if ile:
        logger.info("production.break_ended", extra={"plan_id": plan_id})
    return {"ok": True, "ended": int(ile)}


def list_breaks(plan_id: str) -> List[Dict[str, Any]]:
    rows = query_all(
        "SELECT id, started_at, ended_at FROM production_breaks "
        "WHERE plan_id=%s ORDER BY started_at",
        (plan_id,),
    )
    return [
        {
            "id": r["id"],
            "startedAt": r["started_at"].isoformat() if r["started_at"] else None,
            "endedAt": r["ended_at"].isoformat() if r["ended_at"] else None,
        }
        for r in rows
    ]
