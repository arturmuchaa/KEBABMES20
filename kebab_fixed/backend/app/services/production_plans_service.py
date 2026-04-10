"""Production plans.

All kg reservations on seasoned_meat happen inside a single transaction
with FOR UPDATE row locks on every touched seasoned_meat row, so a
concurrent plan cannot double-book the same lot.
"""
import json
from datetime import datetime
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
from app.models.production import PlanLineCreate, ProductionPlanCreate
from app.utils.ids import cuid, next_seq, now_iso

logger = get_logger(__name__)


def _lock_seasoned_batches(conn, batch_ids: List[str]) -> Dict[str, Dict]:
    """Row-lock every requested seasoned_meat in a deterministic order."""
    locked: Dict[str, Dict] = {}
    for bid in sorted({b for b in batch_ids if b}):
        row = cx_query_one(
            conn,
            "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE",
            (bid,),
        )
        if not row:
            raise HTTPException(404, f"Partia zamarynowana nie znaleziona: {bid}")
        locked[bid] = row
    return locked


def _compute_allocation(
    conn, line: PlanLineCreate, line_kg: float, locked: Dict[str, Dict]
) -> tuple[list[str], dict, str | None, str]:
    all_batch_ids = (
        list(line.seasoned_batch_ids)
        if line.seasoned_batch_ids
        else ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
    )
    all_batch_nos: list[str] = []
    allocation: dict[str, dict] = {}
    primary_batch_id: str | None = all_batch_ids[0] if all_batch_ids else None
    primary_batch_no = ""

    if primary_batch_id:
        sb_row = locked.get(primary_batch_id) or cx_query_one(
            conn,
            "SELECT batch_no FROM seasoned_meat WHERE id=%s",
            (primary_batch_id,),
        )
        if sb_row:
            primary_batch_no = sb_row.get("batch_no") or ""

    if all_batch_ids:
        remaining_qty = line.qty
        for bid in all_batch_ids:
            if remaining_qty <= 0:
                break
            sb_row = locked.get(bid) or cx_query_one(
                conn,
                "SELECT batch_no, kg_available FROM seasoned_meat WHERE id=%s",
                (bid,),
            )
            if not sb_row:
                continue
            b_no = sb_row["batch_no"]
            kg_av = float(sb_row.get("kg_available") or 0)
            if line.kg_per_unit > 0:
                pcs_from_batch = int(min(remaining_qty, kg_av // line.kg_per_unit))
            else:
                pcs_from_batch = remaining_qty
            pcs_from_batch = max(0, min(pcs_from_batch, remaining_qty))
            if pcs_from_batch > 0 or b_no not in allocation:
                all_batch_nos.append(b_no)
                allocation[b_no] = {
                    "pieces": pcs_from_batch,
                    "kg": round(pcs_from_batch * line.kg_per_unit, 3),
                    "batch_id": bid,
                }
                remaining_qty -= pcs_from_batch
    return all_batch_nos, allocation, primary_batch_id, primary_batch_no


def _apply_reservations(conn, allocation: dict) -> None:
    for _, alloc in allocation.items():
        bid = alloc.get("batch_id")
        kg = float(alloc.get("kg") or 0)
        if not bid or kg <= 0:
            continue
        res = cx_execute(
            conn,
            """
            UPDATE seasoned_meat
            SET kg_available = kg_available - %s,
                kg_used = kg_used + %s
            WHERE id=%s AND kg_available >= %s
            """,
            (kg, kg, bid, kg),
        )
        # Verify the row was updated — if not, concurrent modification stole kg
        row = cx_query_one(
            conn,
            "SELECT kg_available FROM seasoned_meat WHERE id=%s",
            (bid,),
        )
        if row is None or float(row.get("kg_available") or 0) < -0.001:
            raise HTTPException(
                409,
                f"Konflikt rezerwacji — nie udało się zabezpieczyć kg na partii {bid}",
            )


def _restore_reservations(conn, plan_id: str) -> None:
    old_lines = cx_query_all(
        conn, "SELECT * FROM production_plan_lines WHERE plan_id=%s", (plan_id,)
    )
    touched_ids: set[str] = set()
    for old in old_lines:
        ba = old.get("batch_allocation") or {}
        if isinstance(ba, str):
            try:
                ba = json.loads(ba)
            except Exception:
                ba = {}
        if isinstance(ba, dict):
            for alloc in ba.values():
                if isinstance(alloc, dict) and alloc.get("batch_id"):
                    touched_ids.add(alloc["batch_id"])
    # Lock all touched rows in deterministic order first
    for bid in sorted(touched_ids):
        cx_query_one(
            conn, "SELECT id FROM seasoned_meat WHERE id=%s FOR UPDATE", (bid,)
        )
    for old in old_lines:
        ba = old.get("batch_allocation") or {}
        if isinstance(ba, str):
            try:
                ba = json.loads(ba)
            except Exception:
                ba = {}
        for _, alloc in (ba.items() if isinstance(ba, dict) else []):
            if not isinstance(alloc, dict):
                continue
            bid = alloc.get("batch_id")
            kg_back = float(alloc.get("kg") or 0)
            if bid and kg_back > 0:
                cx_execute(
                    conn,
                    """
                    UPDATE seasoned_meat
                    SET kg_available = kg_available + %s,
                        kg_used = GREATEST(0, kg_used - %s)
                    WHERE id=%s
                    """,
                    (kg_back, kg_back, bid),
                )


def list_plans() -> List[Dict]:
    plans = query_all("SELECT * FROM production_plans ORDER BY created_at DESC")
    for p in plans:
        p["lines"] = query_all(
            "SELECT * FROM production_plan_lines WHERE plan_id = %s", (p["id"],)
        )
    return plans


def _insert_line(
    conn,
    plan_id: str,
    line: PlanLineCreate,
    line_kg: float,
    recipe_name: str,
    product_type_name: str,
    packaging_name: str,
    primary_batch_id: str | None,
    primary_batch_no: str,
    all_batch_nos: list[str],
    allocation: dict,
) -> None:
    cx_execute(
        conn,
        """
        INSERT INTO production_plan_lines
            (id, plan_id, qty, kg_per_unit, total_kg,
             product_type_id, product_type_name, recipe_id, recipe_name,
             packaging_id, packaging_name, seasoned_batch_id, seasoned_batch_no,
             seasoned_batch_nos, batch_allocation,
             client_order_id, client_order_no, client_name, kg_assigned, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)
        """,
        (
            cuid(),
            plan_id,
            line.qty,
            line.kg_per_unit,
            line_kg,
            line.product_type_id or None,
            product_type_name or None,
            line.recipe_id,
            recipe_name,
            line.packaging_id or None,
            packaging_name or None,
            primary_batch_id,
            primary_batch_no or None,
            all_batch_nos,
            json.dumps(allocation),
            line.client_order_id or None,
            line.client_order_no or None,
            line.client_name or None,
            line_kg if primary_batch_id else 0,
            "assigned" if primary_batch_id else "pending",
        ),
    )


def _resolve_line_names(conn, line: PlanLineCreate) -> tuple[str, str, str]:
    recipe_name = line.recipe_name
    product_type_name = line.product_type_name
    packaging_name = line.packaging_name
    if not recipe_name and line.recipe_id:
        r = cx_query_one(
            conn,
            "SELECT name, product_type_name FROM recipes WHERE id=%s",
            (line.recipe_id,),
        )
        if r:
            recipe_name = r["name"] or ""
            if not product_type_name:
                product_type_name = r.get("product_type_name") or ""
    if not packaging_name and line.packaging_id:
        pkg = cx_query_one(
            conn, "SELECT name FROM packaging WHERE id=%s", (line.packaging_id,)
        )
        if pkg:
            packaging_name = pkg["name"] or ""
    return recipe_name, product_type_name, packaging_name


def create_plan(dto: ProductionPlanCreate) -> Dict:
    if not dto.plan_date:
        raise HTTPException(400, "Brak daty planu (planDate)")
    valid_lines = [
        l for l in dto.lines if l.recipe_id and l.qty > 0 and l.kg_per_unit > 0
    ]
    if not valid_lines:
        raise HTTPException(400, "Brak poprawnych pozycji")

    seq = next_seq("production_plan_seq")
    year = datetime.now().year
    total_kg = sum(l.qty * l.kg_per_unit for l in valid_lines)
    total_units = sum(l.qty for l in valid_lines)

    with transaction() as conn:
        # Lock every seasoned_meat row required by the plan up-front,
        # in deterministic order, to avoid deadlocks between concurrent
        # plan creates.
        all_ids = {
            bid
            for line in valid_lines
            for bid in (
                line.seasoned_batch_ids
                or ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
            )
            if bid
        }
        locked = _lock_seasoned_batches(conn, sorted(all_ids))

        plan = cx_execute_returning(
            conn,
            """
            INSERT INTO production_plans
                (id, plan_no, plan_date, total_kg, total_units,
                 status, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,'draft',%s,%s)
            RETURNING *
            """,
            (
                cuid(),
                f"PP-{year}-{str(seq).zfill(3)}",
                dto.plan_date,
                round(total_kg, 3),
                total_units,
                dto.notes or None,
                now_iso(),
            ),
        )
        assert plan is not None

        for line in valid_lines:
            line_kg = round(line.qty * line.kg_per_unit, 3)
            recipe_name, product_type_name, packaging_name = _resolve_line_names(
                conn, line
            )
            nos, allocation, primary_id, primary_no = _compute_allocation(
                conn, line, line_kg, locked
            )
            _insert_line(
                conn,
                plan["id"],
                line,
                line_kg,
                recipe_name,
                product_type_name,
                packaging_name,
                primary_id,
                primary_no,
                nos,
                allocation,
            )
            _apply_reservations(conn, allocation)

        plan["lines"] = cx_query_all(
            conn,
            "SELECT * FROM production_plan_lines WHERE plan_id = %s",
            (plan["id"],),
        )
    logger.info("plan.created", extra={"plan_id": plan["id"], "total_kg": total_kg})
    return plan


def update_plan(plan_id: str, dto: ProductionPlanCreate) -> Dict:
    valid_lines = [
        l for l in dto.lines if l.recipe_id and l.qty > 0 and l.kg_per_unit > 0
    ]
    total_kg = sum(l.qty * l.kg_per_unit for l in valid_lines)
    total_units = sum(l.qty for l in valid_lines)

    with transaction() as conn:
        plan = cx_query_one(
            conn, "SELECT * FROM production_plans WHERE id=%s FOR UPDATE", (plan_id,)
        )
        if not plan:
            raise HTTPException(404, "Plan nie znaleziony")
        if plan["status"] != "draft":
            raise HTTPException(400, "Można edytować tylko plan w statusie Szkic")

        _restore_reservations(conn, plan_id)
        cx_execute(
            conn, "DELETE FROM production_plan_lines WHERE plan_id=%s", (plan_id,)
        )

        cx_execute(
            conn,
            """
            UPDATE production_plans
            SET plan_date=%s, total_kg=%s, total_units=%s, notes=%s
            WHERE id=%s
            """,
            (dto.plan_date, round(total_kg, 3), total_units, dto.notes or None, plan_id),
        )

        new_ids = {
            bid
            for line in valid_lines
            for bid in (
                line.seasoned_batch_ids
                or ([line.seasoned_batch_id] if line.seasoned_batch_id else [])
            )
            if bid
        }
        locked = _lock_seasoned_batches(conn, sorted(new_ids))

        for line in valid_lines:
            line_kg = round(line.qty * line.kg_per_unit, 3)
            recipe_name, product_type_name, packaging_name = _resolve_line_names(
                conn, line
            )
            nos, allocation, primary_id, primary_no = _compute_allocation(
                conn, line, line_kg, locked
            )
            _insert_line(
                conn,
                plan_id,
                line,
                line_kg,
                recipe_name,
                product_type_name,
                packaging_name,
                primary_id,
                primary_no,
                nos,
                allocation,
            )
            _apply_reservations(conn, allocation)

        updated = cx_query_one(
            conn, "SELECT * FROM production_plans WHERE id=%s", (plan_id,)
        )
        assert updated is not None
        updated["lines"] = cx_query_all(
            conn,
            "SELECT * FROM production_plan_lines WHERE plan_id=%s",
            (plan_id,),
        )
    logger.info("plan.updated", extra={"plan_id": plan_id})
    return updated


def update_plan_status(plan_id: str, status: str) -> Dict[str, bool]:
    with transaction() as conn:
        if status == "active":
            lines = cx_query_all(
                conn,
                "SELECT * FROM production_plan_lines WHERE plan_id = %s",
                (plan_id,),
            )
            errors = []
            for line in lines:
                total_kg = float(line.get("total_kg") or 0)
                if total_kg <= 0:
                    continue
                ba = line.get("batch_allocation") or {}
                if isinstance(ba, str):
                    try:
                        ba = json.loads(ba)
                    except Exception:
                        ba = {}
                allocated_kg = (
                    sum(float(v.get("kg", 0) or 0) for v in ba.values())
                    if isinstance(ba, dict)
                    else 0
                )
                if allocated_kg < total_kg - 0.1:
                    name = (
                        line.get("recipe_name")
                        or line.get("product_type_name")
                        or "pozycja"
                    )
                    shortfall = round(total_kg - allocated_kg, 3)
                    errors.append(f'"{name}" brakuje {shortfall} kg mięsa')
            if errors:
                raise HTTPException(
                    400,
                    "Niewystarczająca ilość mięsa — dostosuj plan przed aktywacją:\n"
                    + "; ".join(errors),
                )
        cx_execute(
            conn,
            "UPDATE production_plans SET status=%s WHERE id=%s",
            (status, plan_id),
        )
    logger.info("plan.status_updated", extra={"plan_id": plan_id, "status": status})
    return {"ok": True}
