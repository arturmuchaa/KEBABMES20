"""Deboning: raw_batch → meat_stock.

Safety guarantees:
  * Single transaction for: raw_batches row lock → raw_batches update →
    meat_stock upsert → stock_movements IN entry.
  * SELECT ... FOR UPDATE on the raw_batches row before deduction
    prevents two concurrent entries from overdrawing the batch.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_all,
    cx_query_one,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.utils.body import body_get
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def _map_deboning_entry(row: Dict) -> Dict:
    if not row:
        return row
    kg_taken = float(row.get("kg_quarter") or 0)
    kg_meat = float(row.get("kg_meat") or 0)
    yield_pct = (kg_meat / kg_taken * 100) if kg_taken > 0 else 0
    return {
        "id": row["id"],
        "sessionId": row.get("session_id", ""),
        "sessionDate": str(row.get("session_date") or ""),
        "sessionNo": row.get("session_no", ""),
        "rawBatchId": row.get("raw_batch_id", ""),
        "rawBatchNo": row.get("raw_batch_no", ""),
        "workerId": row.get("worker_id", ""),
        "workerName": row.get("worker_name", ""),
        "kgTaken": kg_taken,
        "kgMeat": kg_meat,
        "kgBacks": float(row.get("kg_backs") or 0),
        "kgBones": float(row.get("kg_bones") or 0),
        "kgRemainder": float(row.get("kg_remainder") or 0),
        "yieldPct": round(yield_pct, 2),
        "meatLotNo": row.get("meat_lot_no"),
        "createdAt": str(row.get("created_at") or ""),
    }


def list_deboning_entries(session_id: str | None) -> List[Dict]:
    if session_id:
        rows = query_all(
            "SELECT * FROM deboning_entries WHERE session_id=%s ORDER BY created_at DESC",
            (session_id,),
        )
    else:
        rows = query_all("SELECT * FROM deboning_entries ORDER BY created_at DESC")
    return [_map_deboning_entry(r) for r in rows]


def list_deboning_sessions() -> Dict[str, List[Dict]]:
    rows = query_all("SELECT * FROM deboning_entries ORDER BY created_at DESC")
    return {"data": [_map_deboning_entry(r) for r in rows]}


def deboning_trace(batch_id: str) -> Dict[str, List[Dict]]:
    entries = query_all(
        "SELECT * FROM deboning_entries WHERE raw_batch_id=%s ORDER BY created_at DESC",
        (batch_id,),
    )
    return {"data": [_map_deboning_entry(e) for e in entries]}


def create_deboning_entry(body: Dict[str, Any]) -> Dict:
    raw_batch_id = body_get(body, "raw_batch_id")
    worker_id = body_get(body, "worker_id")
    worker_name = body_get(body, "worker_name")
    kg_taken = float(body_get(body, "kg_taken") or body_get(body, "kg_quarter") or 0)
    kg_meat = float(body_get(body, "kg_meat") or 0)
    session_id = body_get(body, "session_id")

    if kg_taken <= 0:
        raise HTTPException(400, "Ilość pobranej ćwiartki musi być > 0")
    if kg_meat <= 0:
        raise HTTPException(400, "Ilość mięsa musi być > 0")
    if kg_meat > kg_taken:
        raise HTTPException(
            400,
            f"Mięso ({kg_meat} kg) nie może przekraczać pobranej "
            f"ćwiartki ({kg_taken} kg)",
        )
    yield_pct_val = (kg_meat / kg_taken) * 100
    if yield_pct_val > 95:
        raise HTTPException(
            400, f"Wydajność {round(yield_pct_val,1)}% jest nierealna — sprawdź dane"
        )
    if yield_pct_val < 30:
        raise HTTPException(
            400,
            f"Wydajność {round(yield_pct_val,1)}% jest bardzo niska — sprawdź dane",
        )

    seq = next_seq("deboning_seq")
    entry_id = cuid()
    session_no = f"RZB-{str(seq).zfill(3)}"

    with transaction() as conn:
        # Row lock the raw batch so two concurrent deboning entries
        # cannot each pass the availability check on the same batch.
        batch = cx_query_one(
            conn,
            "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE",
            (raw_batch_id,),
        )
        if not batch:
            batch = cx_query_one(
                conn,
                "SELECT * FROM raw_batches WHERE internal_batch_no=%s FOR UPDATE",
                (raw_batch_id,),
            )
        if not batch:
            raise HTTPException(
                404, f"Partia nie znaleziona (raw_batch_id={raw_batch_id!r})"
            )
        if batch.get("status") != "active":
            raise HTTPException(
                400,
                f"Partia {batch.get('internal_batch_no')} ma status "
                f"{batch.get('status')} — rozbiór niemożliwy",
            )

        kg_available = float(batch.get("kg_available") or batch.get("kg_received") or 0)
        if kg_taken > kg_available + 0.01:
            raise HTTPException(
                400,
                f"Nie można pobrać {kg_taken} kg — dostępne tylko "
                f"{round(kg_available, 2)} kg w partii "
                f"{batch.get('internal_batch_no', '')}",
            )

        if worker_id and not worker_name:
            worker = cx_query_one(
                conn, "SELECT name FROM workers WHERE id=%s", (worker_id,)
            )
            if worker:
                worker_name = worker["name"]

        kg_remainder = max(0, kg_taken - kg_meat)
        yield_pct = round(yield_pct_val, 2)
        meat_lot_no = f"M{batch['internal_batch_seq']}"

        entry = cx_execute_returning(
            conn,
            """
            INSERT INTO deboning_entries
                (id, raw_batch_id, raw_batch_no, session_id, session_no,
                 kg_quarter, kg_meat, kg_remainder, yield_pct,
                 worker_id, worker_name, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                entry_id,
                batch["id"],
                batch["internal_batch_no"],
                session_id,
                session_no,
                kg_taken,
                kg_meat,
                kg_remainder,
                yield_pct,
                worker_id,
                worker_name,
                now_iso(),
            ),
        )

        cx_execute(
            conn,
            """
            UPDATE raw_batches
            SET kg_available = GREATEST(0, COALESCE(kg_available, kg_received) - %s)
            WHERE id = %s
            """,
            (kg_taken, batch["id"]),
        )

        # Compute meat_stock expiry
        recv = batch.get("received_date")
        if recv:
            try:
                exp = (
                    datetime.fromisoformat(str(recv)) + timedelta(days=7)
                ).date().isoformat()
            except Exception:
                exp = batch.get("expiry_date")
        else:
            exp = batch.get("expiry_date")

        meat_stock_id = cuid()
        cx_execute(
            conn,
            """
            INSERT INTO meat_stock
                (id, lot_no, deboning_session_id, session_no,
                 raw_batch_id, raw_batch_no, kg_initial, kg_available,
                 production_date, expiry_date, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_DATE,%s,'AVAILABLE',%s)
            ON CONFLICT (lot_no) DO UPDATE
            SET kg_initial  = meat_stock.kg_initial  + EXCLUDED.kg_initial,
                kg_available = meat_stock.kg_available + EXCLUDED.kg_available
            """,
            (
                meat_stock_id,
                meat_lot_no,
                entry_id,
                session_no,
                batch["id"],
                batch["internal_batch_no"],
                kg_meat,
                kg_meat,
                exp,
                now_iso(),
            ),
        )

        # Re-fetch the real meat_stock id (in case of ON CONFLICT)
        ms_row = cx_query_one(
            conn, "SELECT id FROM meat_stock WHERE lot_no=%s", (meat_lot_no,)
        )
        real_ms_id = ms_row["id"] if ms_row else meat_stock_id

        create_stock_movement(
            conn,
            product_type="meat",
            batch_id=real_ms_id,
            qty=kg_meat,
            movement_type="IN",
            source_type="deboning",
            source_id=entry_id,
        )

    logger.info(
        "deboning.entry.created",
        extra={
            "entry_id": entry_id,
            "raw_batch_id": batch["id"],
            "kg_taken": kg_taken,
            "kg_meat": kg_meat,
            "yield_pct": yield_pct,
        },
    )
    return _map_deboning_entry(entry)  # type: ignore[arg-type]


def update_deboning_entry(entry_id: str, body: Dict[str, Any]) -> Dict:
    with transaction() as conn:
        existing = cx_query_one(
            conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,)
        )
        if not existing:
            raise HTTPException(404, "Wpis rozbioru nie znaleziony")
        kg_taken = float(
            body_get(body, "kg_taken")
            or body_get(body, "kg_quarter")
            or existing.get("kg_quarter")
            or 0
        )
        kg_meat = float(body_get(body, "kg_meat") or existing.get("kg_meat") or 0)
        kg_backs = float(body_get(body, "kg_backs") or existing.get("kg_backs") or 0)
        kg_bones = float(body_get(body, "kg_bones") or existing.get("kg_bones") or 0)
        if kg_meat > kg_taken:
            raise HTTPException(400, "kg mięsa nie może przekraczać pobranej ćwiartki")
        kg_remainder = max(0, kg_taken - kg_meat)
        yield_pct = round((kg_meat / kg_taken * 100) if kg_taken > 0 else 0, 2)

        row = cx_execute_returning(
            conn,
            """
            UPDATE deboning_entries
            SET kg_quarter=%s, kg_meat=%s, kg_backs=%s, kg_bones=%s,
                kg_remainder=%s, yield_pct=%s
            WHERE id=%s
            RETURNING *
            """,
            (kg_taken, kg_meat, kg_backs, kg_bones, kg_remainder, yield_pct, entry_id),
        )
    if not row:
        raise HTTPException(404, "Wpis rozbioru nie znaleziony")
    logger.info("deboning.entry.updated", extra={"entry_id": entry_id})
    return _map_deboning_entry(row)
