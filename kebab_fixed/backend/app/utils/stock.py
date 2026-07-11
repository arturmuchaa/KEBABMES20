"""Stock movement helper.

Every stock mutation in the system MUST go through
:func:`create_stock_movement` so that the ``stock_movements`` table
remains the authoritative audit log.
"""
from __future__ import annotations

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

VALID_MOVEMENT_TYPES = ("IN", "OUT", "TRANSFORM", "ADJUST", "CANCEL")


def create_stock_movement(
    conn,
    product_type: str,
    batch_id: str,
    qty: float,
    movement_type: str,
    source_type: str,
    source_id: str,
) -> None:
    """Insert a stock movement record inside an existing transaction.

    ``qty`` must be positive. OUT movements are stored as negative.
    For OUT movements on meat_stock this function validates that
    ``kg_available`` cannot go below zero before writing the row.
    """
    if movement_type not in VALID_MOVEMENT_TYPES:
        raise HTTPException(400, f"Nieprawidłowy typ ruchu: {movement_type}")

    if qty == 0:
        return

    if movement_type == "OUT":
        abs_qty = abs(float(qty))
        if product_type == "meat" and batch_id:
            stock = cx_query_one(
                conn,
                "SELECT kg_available, lot_no FROM meat_stock WHERE id = %s FOR UPDATE",
                (batch_id,),
            )
            if stock is not None:
                kg_available = float(stock.get("kg_available") or 0)
                if abs_qty > kg_available + 0.01:
                    raise HTTPException(
                        400,
                        f"Ruch OUT {abs_qty} kg przekracza kg_available "
                        f"{kg_available} kg dla partii {stock.get('lot_no') or batch_id}",
                    )
        stored_qty = -abs_qty
    else:
        stored_qty = abs(float(qty))

    cx_execute(
        conn,
        """
        INSERT INTO stock_movements
            (id, product_type, batch_id, qty, movement_type,
             source_type, source_id, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            cuid(),
            product_type,
            batch_id,
            stored_qty,
            movement_type,
            source_type,
            source_id,
            now_iso(),
        ),
    )
    logger.info(
        "stock.movement",
        extra={
            "product_type": product_type,
            "batch_id": batch_id,
            "qty": stored_qty,
            "movement_type": movement_type,
            "source_type": source_type,
            "source_id": source_id,
        },
    )
