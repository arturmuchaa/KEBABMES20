"""Finished goods: list, create, finish-day.

The ``finish_day`` operation is the MES's terminal step and MUST:
    * run inside a single transaction,
    * record every kg of packaging consumption,
    * emit ``stock_movements`` IN entries for every finished_goods row,
    * maintain write-time lineage (source_mixing_ids / seasoned / deboning).
"""
from datetime import datetime
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_execute_rowcount,
    cx_query_all,
    cx_query_one,
    query_all,
    transaction,
)
from app.logging_config import get_logger
from app.models.production import FinishDayDto, FinishDayEntry
from app.utils.body import body_get
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────

def _resolve_lineage(conn, seasoned_batch_nos: List[str]) -> Dict[str, List[str]]:
    """Walk seasoned_meat → mixing_orders → lots → meat_stock → raw_batches.

    Returns a dict of ID lists suitable for the finished_goods lineage columns.
    """
    mixing_order_ids: List[str] = []
    seasoned_meat_ids: List[str] = []
    deboning_entry_ids: List[str] = []
    raw_batch_ids: List[str] = []
    supplier_ids: List[str] = []

    for bno in seasoned_batch_nos or []:
        sm = cx_query_one(
            conn, "SELECT * FROM seasoned_meat WHERE batch_no=%s", (bno,)
        )
        if not sm:
            continue
        if sm["id"] not in seasoned_meat_ids:
            seasoned_meat_ids.append(sm["id"])

        for did in sm.get("source_deboning_ids") or []:
            if did and did not in deboning_entry_ids:
                deboning_entry_ids.append(did)

        mo = cx_query_one(
            conn,
            "SELECT * FROM mixing_orders WHERE order_no=%s",
            (sm.get("mixing_order_no"),),
        )
        if mo and mo["id"] not in mixing_order_ids:
            mixing_order_ids.append(mo["id"])
            lots = cx_query_all(
                conn,
                """
                SELECT mol.meat_stock_id, ms.raw_batch_id, ms.deboning_session_id
                FROM mixing_order_lots mol
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                WHERE mol.order_id = %s
                """,
                (mo["id"],),
            )
            for lot in lots:
                if (
                    lot.get("deboning_session_id")
                    and lot["deboning_session_id"] not in deboning_entry_ids
                ):
                    deboning_entry_ids.append(lot["deboning_session_id"])
                if (
                    lot.get("raw_batch_id")
                    and lot["raw_batch_id"] not in raw_batch_ids
                ):
                    raw_batch_ids.append(lot["raw_batch_id"])
                    rb = cx_query_one(
                        conn,
                        "SELECT supplier_id FROM raw_batches WHERE id=%s",
                        (lot["raw_batch_id"],),
                    )
                    if (
                        rb
                        and rb.get("supplier_id")
                        and rb["supplier_id"] not in supplier_ids
                    ):
                        supplier_ids.append(rb["supplier_id"])

    return {
        "mixing_order_ids": mixing_order_ids,
        "seasoned_meat_ids": seasoned_meat_ids,
        "deboning_entry_ids": deboning_entry_ids,
        "raw_batch_ids": raw_batch_ids,
        "supplier_ids": supplier_ids,
    }


def _consume_packaging(conn, packaging_id: str, qty: int, source_id: str) -> None:
    """Deduct packaging atomically with FOR UPDATE + >= guard."""
    if not packaging_id or qty <= 0:
        return
    pkg = cx_query_one(
        conn, "SELECT * FROM packaging WHERE id=%s FOR UPDATE", (packaging_id,)
    )
    if not pkg:
        raise HTTPException(
            404, f"Opakowanie nie znalezione: {packaging_id}"
        )
    kg_available = float(pkg.get("kg_available") or 0)
    if kg_available < qty - 0.01:
        raise HTTPException(
            400,
            f"Niewystarczająca ilość opakowania '{pkg.get('name','?')}': "
            f"dostępne {kg_available}, wymagane {qty}",
        )
    rowcount = cx_execute_rowcount(
        conn,
        """
        UPDATE packaging
        SET kg_available = kg_available - %s,
            kg_used = COALESCE(kg_used, 0) + %s
        WHERE id = %s AND kg_available >= %s
        """,
        (qty, qty, packaging_id, qty),
    )
    if rowcount == 0:
        raise HTTPException(
            409,
            f"Race condition na opakowaniu {packaging_id} (update failed)",
        )
    create_stock_movement(
        conn,
        product_type="packaging",
        batch_id=packaging_id,
        qty=float(qty),
        movement_type="OUT",
        source_type="finished_goods",
        source_id=source_id,
    )


# ── Queries ────────────────────────────────────────────────────────────

def list_finished() -> List[Dict]:
    items = query_all("SELECT * FROM finished_goods ORDER BY created_at DESC")
    for item in items:
        item["sub_entries"] = query_all(
            "SELECT * FROM finished_goods_sessions WHERE goods_id = %s ORDER BY added_at",
            (item["id"],),
        )
    return items


def create_finished_good(body: Dict[str, Any]) -> Dict:
    seq = next_seq("finished_goods_seq")
    default_batch_no = f"P{seq}"
    qty = int(body_get(body, "qty", 0) or 0)
    kg_per_unit = float(body_get(body, "kg_per_unit", 0) or 0)
    total_kg = round(qty * kg_per_unit, 3)
    batch_no = body_get(body, "batch_no", default_batch_no) or default_batch_no

    with transaction() as conn:
        item = cx_execute_returning(
            conn,
            """
            INSERT INTO finished_goods
                (id, batch_no, plan_no, product_type_id, product_type_name,
                 recipe_id, recipe_name, packaging_id, packaging_name,
                 client_name, client_order_no, qty, kg_per_unit, total_kg,
                 qty_available, qty_shipped, produced_date, produced_by,
                 seasoned_batch_nos, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                batch_no,
                body_get(body, "plan_no", "") or "",
                body_get(body, "product_type_id", "") or "",
                body_get(body, "product_type_name", "") or "",
                body_get(body, "recipe_id", "") or "",
                body_get(body, "recipe_name", "") or "",
                body_get(body, "packaging_id") or None,
                body_get(body, "packaging_name") or None,
                body_get(body, "client_name") or None,
                body_get(body, "client_order_no") or None,
                qty,
                kg_per_unit,
                total_kg,
                qty,
                body_get(body, "produced_date", datetime.now().date().isoformat())
                or datetime.now().date().isoformat(),
                body_get(body, "produced_by", []) or [],
                body_get(body, "seasoned_batch_nos", []) or [],
                now_iso(),
            ),
        )
        assert item is not None

        # Every IN on finished_goods is logged
        if total_kg > 0:
            create_stock_movement(
                conn,
                product_type="finished_goods",
                batch_id=item["id"],
                qty=total_kg,
                movement_type="IN",
                source_type="manual",
                source_id=item["id"],
            )

        packaging_id = body_get(body, "packaging_id")
        if packaging_id and qty > 0:
            _consume_packaging(conn, packaging_id, qty, item["id"])

    logger.info(
        "finished_goods.created",
        extra={"id": item["id"], "batch_no": item["batch_no"], "qty": qty},
    )
    return item


def finish_day(dto: FinishDayDto) -> Dict[str, Any]:
    """Close a production day: create (or increment) finished_goods rows.

    * One transaction for the whole plan.
    * Full lineage (mixing/seasoned/deboning) resolved at write time.
    * Packaging consumption deducted atomically with FOR UPDATE.
    * Every qty/kg mutation emits a stock_movement record.
    * Plan status flipped to 'done' at the end.
    """
    if not dto.plan_id:
        raise HTTPException(400, "planId wymagane")

    today = datetime.now().date().isoformat()
    created: List[Dict] = []

    with transaction() as conn:
        plan = cx_query_one(
            conn,
            "SELECT * FROM production_plans WHERE id = %s FOR UPDATE",
            (dto.plan_id,),
        )
        if not plan:
            raise HTTPException(404, "Plan nie znaleziony")
        if plan.get("status") == "done":
            raise HTTPException(400, "Plan już zamknięty")

        for entry in dto.entries:
            created.append(_process_finish_day_entry(conn, plan, entry, today))

        cx_execute(
            conn,
            "UPDATE production_plans SET status='done' WHERE id=%s",
            (dto.plan_id,),
        )

    logger.info(
        "finished_goods.finish_day",
        extra={
            "plan_id": dto.plan_id,
            "plan_no": plan.get("plan_no"),
            "rows": len([c for c in created if c]),
        },
    )
    return {"created": len([c for c in created if c]), "items": [c for c in created if c]}


def _process_finish_day_entry(
    conn, plan: Dict, entry: FinishDayEntry, today: str
) -> Dict | None:
    if entry.qty <= 0:
        return None
    total_kg = round(entry.qty * entry.kg_per_unit, 3)

    if not entry.seasoned_batch_nos:
        logger.warning(
            "finish_day.missing_seasoned",
            extra={
                "plan_line_id": entry.plan_line_id,
                "recipe_id": entry.recipe_id,
                "qty": entry.qty,
            },
        )

    lineage = _resolve_lineage(conn, entry.seasoned_batch_nos or [])
    src_mixing = lineage["mixing_order_ids"]
    src_seasoned = lineage["seasoned_meat_ids"]
    src_deboning = lineage["deboning_entry_ids"]

    existing = cx_query_one(
        conn,
        """
        SELECT * FROM finished_goods
        WHERE produced_date = %s
          AND recipe_id = %s
          AND COALESCE(packaging_id,'') = %s
          AND COALESCE(client_name,'') = %s
          AND kg_per_unit = %s
        FOR UPDATE
        """,
        (
            today,
            entry.recipe_id,
            entry.packaging_id or "",
            entry.client_name or "",
            entry.kg_per_unit,
        ),
    )

    if existing:
        cx_execute(
            conn,
            """
            UPDATE finished_goods
            SET qty = qty + %s,
                total_kg = total_kg + %s,
                qty_available = qty_available + %s,
                produced_by = array_cat(COALESCE(produced_by,'{}'::text[]), %s::text[]),
                seasoned_batch_nos = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(seasoned_batch_nos,'{}'::text[]) || %s::text[]
                    ))
                ),
                source_mixing_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_mixing_ids,'{}'::text[]) || %s::text[]
                    ))
                ),
                source_seasoned_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_seasoned_ids,'{}'::text[]) || %s::text[]
                    ))
                ),
                source_deboning_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_deboning_ids,'{}'::text[]) || %s::text[]
                    ))
                )
            WHERE id = %s
            """,
            (
                entry.qty,
                total_kg,
                entry.qty,
                entry.worker_names,
                entry.seasoned_batch_nos,
                src_mixing,
                src_seasoned,
                src_deboning,
                existing["id"],
            ),
        )
        cx_execute(
            conn,
            """
            INSERT INTO finished_goods_sessions
                (id, goods_id, plan_line_id, qty, total_kg,
                 seasoned_batch_nos, worker_names, added_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                cuid(),
                existing["id"],
                entry.plan_line_id,
                entry.qty,
                total_kg,
                entry.seasoned_batch_nos,
                entry.worker_names,
                now_iso(),
            ),
        )
        item_id = existing["id"]
    else:
        seq = next_seq("finished_goods_seq")
        batch_no = f"PP{seq}"
        # Try to use P{raw_seq} when the whole row descends from a single
        # physical raw batch.
        if entry.seasoned_batch_nos and len(entry.seasoned_batch_nos) == 1:
            sm_row = cx_query_one(
                conn,
                "SELECT mixing_order_no FROM seasoned_meat WHERE batch_no=%s",
                (entry.seasoned_batch_nos[0],),
            )
            if sm_row and sm_row.get("mixing_order_no"):
                mo_row = cx_query_one(
                    conn,
                    "SELECT id FROM mixing_orders WHERE order_no=%s",
                    (sm_row["mixing_order_no"],),
                )
                if mo_row:
                    raw_seqs = cx_query_all(
                        conn,
                        """
                        SELECT DISTINCT rb.internal_batch_seq
                        FROM mixing_order_lots mol
                        LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                        LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                        WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
                        """,
                        (mo_row["id"],),
                    )
                    sids = [
                        r["internal_batch_seq"]
                        for r in raw_seqs
                        if r.get("internal_batch_seq")
                    ]
                    if len(sids) == 1:
                        batch_no = f"P{sids[0]}"

        item = cx_execute_returning(
            conn,
            """
            INSERT INTO finished_goods
                (id, batch_no, plan_no, product_type_id, product_type_name,
                 recipe_id, recipe_name, packaging_id, packaging_name,
                 client_name, client_order_no, qty, kg_per_unit, total_kg,
                 qty_available, qty_shipped, produced_date, produced_by,
                 seasoned_batch_nos, source_production_id,
                 source_mixing_ids, source_seasoned_ids, source_deboning_ids,
                 created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (
                cuid(),
                batch_no,
                plan["plan_no"],
                entry.product_type_id,
                entry.product_type_name,
                entry.recipe_id,
                entry.recipe_name,
                entry.packaging_id or None,
                entry.packaging_name or None,
                entry.client_name or None,
                entry.client_order_no or None,
                entry.qty,
                entry.kg_per_unit,
                total_kg,
                entry.qty,
                today,
                entry.worker_names,
                entry.seasoned_batch_nos,
                plan["id"],
                src_mixing,
                src_seasoned,
                src_deboning,
                now_iso(),
            ),
        )
        assert item is not None
        item_id = item["id"]

        cx_execute(
            conn,
            """
            INSERT INTO finished_goods_sessions
                (id, goods_id, plan_line_id, qty, total_kg,
                 seasoned_batch_nos, worker_names, added_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                cuid(),
                item_id,
                entry.plan_line_id,
                entry.qty,
                total_kg,
                entry.seasoned_batch_nos,
                entry.worker_names,
                now_iso(),
            ),
        )

    # Audit trail: IN movement for each entry (supports deltas)
    if total_kg > 0:
        create_stock_movement(
            conn,
            product_type="finished_goods",
            batch_id=item_id,
            qty=total_kg,
            movement_type="IN",
            source_type="plan",
            source_id=plan["id"],
        )

    if entry.packaging_id and entry.qty > 0:
        _consume_packaging(conn, entry.packaging_id, entry.qty, item_id)

    return cx_query_one(
        conn, "SELECT * FROM finished_goods WHERE id=%s", (item_id,)
    )
