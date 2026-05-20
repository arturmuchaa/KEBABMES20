from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_query_one,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.models.packaging import PackagingReceive
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def list_packaging() -> List[Dict]:
    return query_all("SELECT * FROM packaging WHERE kg_available > 0 ORDER BY name")


def list_all_packaging() -> List[Dict]:
    return query_all("SELECT * FROM packaging ORDER BY created_at DESC")


def receive_packaging(dto: PackagingReceive) -> Dict:
    with transaction() as conn:
        existing = cx_query_one(
            conn,
            "SELECT * FROM packaging WHERE LOWER(name) = LOWER(%s) FOR UPDATE",
            (dto.name,),
        )
        if existing:
            cx_execute(
                conn,
                """
                UPDATE packaging
                SET kg_available = kg_available + %s,
                    kg_initial = kg_initial + %s
                WHERE id = %s
                """,
                (dto.qty, dto.qty, existing["id"]),
            )
            if float(dto.qty or 0) > 0:
                create_stock_movement(
                    conn,
                    product_type="packaging",
                    batch_id=existing["id"],
                    qty=float(dto.qty),
                    movement_type="IN",
                    source_type="supplier",
                    source_id=dto.supplier_id or existing["id"],
                )
            row = cx_query_one(
                conn, "SELECT * FROM packaging WHERE id = %s", (existing["id"],)
            )
            logger.info(
                "packaging.received",
                extra={"packaging_id": existing["id"], "qty": dto.qty, "mode": "topup"},
            )
            return row  # type: ignore[return-value]
        seq = next_seq("packaging_seq")
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO packaging
                (id, code, name, type, unit, kg_initial, kg_available, kg_used,
                 supplier_id, expiry_date, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                f"PAK-{str(seq).zfill(3)}",
                dto.name,
                dto.type,
                dto.unit,
                dto.qty,
                dto.qty,
                dto.supplier_id or None,
                dto.expiry_date or None,
                dto.notes,
                now_iso(),
            ),
        )
        if float(dto.qty or 0) > 0:
            create_stock_movement(
                conn,
                product_type="packaging",
                batch_id=row["id"],
                qty=float(dto.qty),
                movement_type="IN",
                source_type="supplier",
                source_id=dto.supplier_id or row["id"],
            )
    logger.info(
        "packaging.received",
        extra={"packaging_id": row["id"], "qty": dto.qty, "mode": "new"},
    )
    return row


def use_packaging(packaging_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    qty = float(body.get("qty", 0) or 0)
    if qty <= 0:
        raise HTTPException(400, "Ilość musi być większa od zera")
    with transaction() as conn:
        pkg = cx_query_one(
            conn,
            "SELECT kg_available FROM packaging WHERE id=%s FOR UPDATE",
            (packaging_id,),
        )
        if not pkg:
            raise HTTPException(404, "Opakowanie nie znalezione")
        if float(pkg["kg_available"] or 0) + 0.01 < qty:
            raise HTTPException(
                400,
                f"Niewystarczająca ilość opakowań: dostępne "
                f"{float(pkg['kg_available'])}, wymagane {qty}",
            )
        cx_execute(
            conn,
            """
            UPDATE packaging
            SET kg_available = kg_available - %s,
                kg_used = kg_used + %s
            WHERE id = %s
            """,
            (qty, qty, packaging_id),
        )
        # Manualne zużycie (poza finish_day) też musi mieć ślad audytu.
        create_stock_movement(
            conn,
            product_type="packaging",
            batch_id=packaging_id,
            qty=qty,
            movement_type="OUT",
            source_type="manual",
            source_id=packaging_id,
        )
    logger.info("packaging.used", extra={"packaging_id": packaging_id, "qty": qty})
    return {"ok": True}
