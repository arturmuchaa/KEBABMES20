"""Foliowanie — kilogramy zafoliowane przez konkretną osobę w danym dniu.

Przy linii stoi ~10 osób układających kebaby i 2 foliowczyków. Pracy
foliowczyka nie da się policzyć licznikiem sztuk — foliuje to, co zrobiła cała
linia — więc zapisujemy mu kilogramy wprost, raz na dzień (albo wcześniej, gdy
kończy zmianę przed resztą).

Zapis jest IDEMPOTENTNY per (dzień, pracownik): ponowne wpisanie nadpisuje.
Poprawka ma być poprawką, a nie drugim wpisem doliczanym do płacy.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, query_all, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def split_evenly(kg_total: float, ile_osob: int) -> List[float]:
    """Podział kilogramów dnia po równo.

    Reszta z zaokrąglenia idzie do PIERWSZEJ osoby, żeby suma części zgadzała
    się co do kilograma z całością. Bez tego 1000 kg na trzech dawało 999,99
    i biuro szukałoby brakującego kilograma.
    """
    if ile_osob <= 0:
        return []
    total = round(float(kg_total or 0), 2)
    czesc = round(total / ile_osob, 2)
    czesci = [czesc] * ile_osob
    czesci[0] = round(total - czesc * (ile_osob - 1), 2)
    return czesci


def save_wrapping(work_date: str, entries: List[Dict[str, Any]], by: str = "") -> Dict[str, Any]:
    """Zapisz kilogramy foliowania dnia. Wpis z 0 kg usuwa poprzedni."""
    if not work_date:
        raise HTTPException(400, "Brak dnia produkcyjnego")
    czyste: List[Dict[str, Any]] = []
    for e in entries or []:
        wid = str(e.get("workerId") or e.get("worker_id") or "")
        kg = float(e.get("kg") or 0)
        if not wid:
            raise HTTPException(400, "Wpis foliowania bez pracownika")
        if kg < 0:
            raise HTTPException(400, "Kilogramy foliowania nie mogą być ujemne")
        czyste.append({"id": wid, "name": str(e.get("workerName") or e.get("worker_name") or ""), "kg": kg})

    with transaction() as conn:
        for e in czyste:
            # Nadpisanie zamiast dopisania — najpierw kasujemy poprzedni wpis
            # tej osoby na ten dzień, potem wstawiamy nowy (o ile > 0).
            cx_execute(
                conn,
                "DELETE FROM production_wrapping WHERE work_date=%s AND worker_id=%s",
                (work_date, e["id"]),
            )
            if e["kg"] > 0:
                cx_execute(
                    conn,
                    """
                    INSERT INTO production_wrapping
                        (id, work_date, worker_id, worker_name, kg, created_at, created_by)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (cuid(), work_date, e["id"], e["name"], e["kg"], now_iso(), by or ""),
                )
    logger.info("wrapping.saved", extra={"work_date": work_date, "entries": len(czyste)})
    return {"ok": True, "entries": len(czyste)}


def day_wrapping(work_date: str) -> List[Dict[str, Any]]:
    """Kto ile zafoliował danego dnia."""
    return [
        {
            "workerId": r["worker_id"],
            "workerName": r.get("worker_name") or "",
            "kg": float(r["kg"] or 0),
            "by": r.get("created_by") or "",
        }
        for r in query_all(
            "SELECT worker_id, worker_name, kg, created_by FROM production_wrapping "
            "WHERE work_date=%s ORDER BY worker_name",
            (work_date,),
        )
    ]
