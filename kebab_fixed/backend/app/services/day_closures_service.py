"""Day closures — biuro zamyka dzień osobno dla rozbior/masownia/produkcja.

Klient frontu sprawdza listę zamknięć dla dzisiejszej daty: gdy sekcja
jest zamknięta to dashboard pokazuje status "zakończony", inaczej "live"
jeśli była aktywność w ciągu dnia.
"""
import datetime as dt
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)

ALLOWED_SECTIONS = {"rozbior", "masownia", "produkcja"}


def _today() -> str:
    return dt.date.today().isoformat()


def list_for_date(date_str: str) -> List[Dict]:
    return query_all(
        "SELECT * FROM day_closures WHERE closure_date = %s ORDER BY closed_at",
        (date_str,),
    )


def list_today() -> List[Dict]:
    return list_for_date(_today())


def close_section(section: str, notes: str = "", closed_by: str = "", date_str: str = "") -> Dict:
    if section not in ALLOWED_SECTIONS:
        raise HTTPException(400, f"Nieznana sekcja: {section}")
    target = (date_str or _today()).strip()
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO day_closures (id, closure_date, section, closed_by, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (closure_date, section)
            DO UPDATE SET closed_at = now(), closed_by = EXCLUDED.closed_by, notes = EXCLUDED.notes
            RETURNING *
            """,
            (cuid(), target, section, closed_by, notes),
        )
    logger.info(
        "day_closure.closed",
        extra={"section": section, "date": target, "by": closed_by},
    )
    return row  # type: ignore[return-value]


def reopen_section(section: str, date_str: str = "") -> Dict:
    if section not in ALLOWED_SECTIONS:
        raise HTTPException(400, f"Nieznana sekcja: {section}")
    target = (date_str or _today()).strip()
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "DELETE FROM day_closures WHERE closure_date=%s AND section=%s RETURNING *",
            (target, section),
        )
    if not row:
        raise HTTPException(404, "Brak zamknięcia dla tej sekcji w tym dniu")
    logger.info("day_closure.reopened", extra={"section": section, "date": target})
    return {"ok": True, "section": section, "date": target}
