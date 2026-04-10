from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute_returning, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.models.raw_batches import RawBatchCreate
from app.utils.body import body_get
from app.utils.ids import cuid, next_seq, now_iso

logger = get_logger(__name__)


def next_batch_number() -> Dict[str, Any]:
    row = query_one("SELECT value FROM sequences WHERE key='batch_seq'")
    next_val = (int(row["value"]) if row else 171) + 1
    return {
        "nextNo": f"R{next_val}",
        "seq": next_val,
        "suggestedBatchNo": f"R{next_val}",
        "suggestedSeq": next_val,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }


def list_all_batches() -> List[Dict]:
    return query_all("SELECT * FROM raw_batches ORDER BY internal_batch_seq ASC")


def list_batches(active_only: bool, limit: int) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 1000))
    sql = "SELECT * FROM raw_batches"
    params: list = []
    if active_only:
        sql += " WHERE status = 'active'"
    sql += " ORDER BY internal_batch_seq ASC LIMIT %s"
    params.append(limit)
    return {"data": query_all(sql, params), "total": None}


def create_batch(dto: RawBatchCreate) -> Dict:
    seq = next_seq("batch_seq")
    with transaction() as conn:
        sup = cx_query_one(
            conn, "SELECT * FROM suppliers WHERE id = %s", (dto.supplier_id,)
        )
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO raw_batches
            (id, internal_batch_no, internal_batch_seq, supplier_id, supplier_name,
             supplier_batch_no, slaughter_date, received_date, kg_received,
             kg_available, price_per_kg, expiry_date, status, notes,
             invoice_no, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                f"R{seq}",
                seq,
                dto.supplier_id,
                sup["name"] if sup else "",
                dto.supplier_batch_no,
                dto.slaughter_date or None,
                dto.received_date or None,
                dto.kg_received,
                dto.kg_received,
                dto.price_per_kg,
                dto.expiry_date or None,
                dto.notes,
                dto.invoice_no or None,
                now_iso(),
            ),
        )
    logger.info(
        "raw_batch.created",
        extra={
            "batch_id": row["id"],
            "internal_batch_no": row["internal_batch_no"],
            "kg_received": dto.kg_received,
            "supplier_id": dto.supplier_id,
        },
    )
    return row


def batch_history(batch_id: str) -> List[Dict]:
    return query_all(
        "SELECT * FROM raw_batch_history WHERE batch_id=%s ORDER BY created_at DESC",
        (batch_id,),
    )


def cancel_batch(batch_id: str) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE raw_batches SET status='cancelled' WHERE id=%s RETURNING *",
            (batch_id,),
        )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    logger.info("raw_batch.cancelled", extra={"batch_id": batch_id})
    return row


def update_batch(batch_id: str, body: Dict[str, Any]) -> Dict:
    with transaction() as conn:
        used = cx_query_one(
            conn,
            "SELECT COUNT(*) AS cnt FROM deboning_entries WHERE raw_batch_id=%s",
            (batch_id,),
        )
        if used and int(used["cnt"]) > 0:
            raise HTTPException(
                409, "Partia jest już używana w rozbiorze — edycja niemożliwa"
            )
        kg_received = body_get(body, "kg_received", 0)
        row = cx_execute_returning(
            conn,
            """
            UPDATE raw_batches
            SET supplier_batch_no=%s, slaughter_date=%s, received_date=%s,
                kg_received=%s, kg_available=%s, price_per_kg=%s,
                expiry_date=%s, notes=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                body_get(body, "supplier_batch_no"),
                body_get(body, "slaughter_date") or None,
                body_get(body, "received_date") or None,
                kg_received,
                kg_received,
                body_get(body, "price_per_kg", 0),
                body_get(body, "expiry_date") or None,
                body.get("notes"),
                batch_id,
            ),
        )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    logger.info("raw_batch.updated", extra={"batch_id": batch_id})
    return row


def list_meat_stock() -> Dict[str, Any]:
    return {
        "data": query_all(
            """
            SELECT m.*,
                   (m.kg_available - COALESCE(m.kg_reserved, 0)) AS kg_free,
                   b.internal_batch_no, b.supplier_name,
                   b.slaughter_date as batch_slaughter_date
            FROM meat_stock m
            LEFT JOIN raw_batches b ON b.id = m.raw_batch_id
            WHERE (m.kg_available - COALESCE(m.kg_reserved, 0)) > 0
            ORDER BY m.expiry_date ASC, m.lot_no ASC
            """
        )
    }
