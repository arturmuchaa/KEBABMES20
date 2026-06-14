"""Mixing orders.

Every operation that touches meat_stock.kg_reserved, kg_available or
kg_used runs inside a transaction with SELECT ... FOR UPDATE row locks.
Every actual mass movement is recorded via :func:`create_stock_movement`.
"""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_execute_returning,
    cx_execute_rowcount,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.models.mixing import FinishMixingSessionDto, MixingOrderCreate
from app.services.recipes_service import calc_kg_output
from app.services.seasoned_meat_service import populate_lineage
from app.utils.batch_numbers import combined_batch_no
from app.utils.ids import cuid, next_dated_no, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


# ── Serialization helpers ─────────────────────────────────────────────

def build_mixing_order(o: Dict) -> Dict:
    """Transform a mixing_orders row into the camelCase DTO the frontend expects."""
    oid = o["id"]
    meat_lots = query_all(
        """
        SELECT mol.*, ms.lot_no AS meat_lot_no, ms.expiry_date,
               rb.internal_batch_no AS raw_batch_no
        FROM mixing_order_lots mol
        LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
        LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
        WHERE mol.order_id = %s
        """,
        (oid,),
    )

    recipe_id = o.get("recipe_id") or ""
    steps: list[dict] = []
    if recipe_id:
        ings = query_all(
            """
            SELECT ri.*, i.is_unlimited
            FROM recipe_ingredients ri
            LEFT JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = %s ORDER BY ri.id
            """,
            (recipe_id,),
        )
        confirmed_steps = o.get("confirmed_steps") or {}
        if isinstance(confirmed_steps, str):
            try:
                confirmed_steps = json.loads(confirmed_steps)
            except Exception:
                confirmed_steps = {}
        meat_kg_val = float(o.get("meat_kg") or 0)
        for idx, ing in enumerate(ings, start=1):
            qty_per = float(ing.get("qty_per_100kg") or 0)
            qty_required = (
                round(qty_per * meat_kg_val / 100, 3) if meat_kg_val > 0 else qty_per
            )
            step_key = str(idx)
            confirmed_qty = (
                confirmed_steps.get(step_key) if isinstance(confirmed_steps, dict) else None
            )
            steps.append(
                {
                    "stepNo": idx,
                    "ingredientId": ing.get("ingredient_id") or "",
                    "ingredientName": ing.get("ingredient_name") or "",
                    "unit": ing.get("unit") or "kg",
                    "qtyRequired": qty_required,
                    "qtyConfirmed": float(confirmed_qty) if confirmed_qty is not None else None,
                    "confirmed": confirmed_qty is not None,
                    "isUnlimited": bool(ing.get("is_unlimited")),
                }
            )

    sessions = query_all(
        "SELECT * FROM mixing_sessions WHERE order_id = %s ORDER BY started_at",
        (oid,),
    )

    meat_kg = float(o.get("meat_kg") or 0)
    kg_done = float(o.get("kg_done") or 0)
    kg_remaining = max(0.0, meat_kg - kg_done)

    return {
        "id": o["id"],
        "orderNo": o.get("order_no") or "",
        "recipeId": o.get("recipe_id") or "",
        "recipeName": o.get("recipe_name") or "",
        "productTypeId": o.get("product_type_id"),
        "productTypeName": o.get("product_type_name"),
        "meatKg": meat_kg,
        "kgDone": kg_done,
        "kgRemaining": kg_remaining,
        "kgInMachine": float(o.get("kg_in_machine") or 0),
        "plannedOutputKg": float(o.get("planned_output_kg") or 0),
        "machineId": o.get("machine_id"),
        "status": o.get("status") or "planned",
        "daySeq": int(o.get("day_seq") or 0),
        "notes": o.get("notes"),
        "createdAt": str(o.get("created_at") or ""),
        "startedAt": str(o["started_at"]) if o.get("started_at") else None,
        "completedAt": str(o["completed_at"]) if o.get("completed_at") else None,
        "meatLots": [
            {
                "meatLotId": lot.get("meat_stock_id") or lot.get("id") or "",
                "meatLotNo": lot.get("meat_lot_no") or lot.get("lot_no") or "",
                "rawBatchId": lot.get("raw_batch_id") or "",
                "rawBatchNo": lot.get("raw_batch_no") or "",
                "kgPlanned": float(lot.get("kg_planned") or lot.get("kg_allocated") or 0),
                "kgActual": float(lot.get("kg_actual") or 0),
                "expiryDate": str(lot["expiry_date"]) if lot.get("expiry_date") else "",
            }
            for lot in meat_lots
        ],
        "steps": steps,
        "sessions": [
            {
                "sessionId": s.get("id") or "",
                "machineId": s.get("machine_id"),
                "kgMeat": float(s.get("kg_meat") or 0),
                "kgOutput": float(s.get("kg_output") or 0),
                "startedAt": str(s.get("started_at") or ""),
                "completedAt": str(s.get("completed_at") or ""),
                "batchNo": s.get("batch_no"),
            }
            for s in sessions
        ],
    }


# ── Queries ────────────────────────────────────────────────────────────

def list_mixing_orders(status: str | None) -> List[Dict]:
    """Czysty odczyt — żadnych mutacji na ścieżce GET.

    Auto-close osieroconych zleceń (in_progress bez aktywnej blokady
    maszyny) wydzielony do :func:`cleanup_stale_in_progress` — wywoływane
    z admin-endpointu lub systemd-timera, nie z handlerów odczytu.
    """
    sql = "SELECT * FROM mixing_orders"
    params: list = []
    if status:
        sql += " WHERE status = %s"
        params.append(status)
    # Kolejność planu dnia (day_seq 1→n) przed resztą; operator jedzie po kolei
    sql += (" ORDER BY CASE WHEN COALESCE(day_seq,0) > 0 THEN day_seq "
            "ELSE 999999 END, created_at DESC")
    orders = query_all(sql, params or None)
    return [build_mixing_order(o) for o in orders]


def cleanup_stale_in_progress() -> Dict[str, Any]:
    """Zamknij in_progress zlecenia, których blokada maszyny wygasła
    i które są FAKTYCZNIE wykonane (kg_done >= meat_kg).

    UWAGA: in_progress bez blokady to także legalny stan „do wznowienia"
    (operator wrzucił część, np. 600 z 3000 kg, i wróci po kolejny wsad) —
    takich zleceń NIE wolno zamykać jako done, bo plan znika z paneli,
    a pozostałe kg nigdy nie zostają wymieszane.

    Bezpieczne do uruchomienia z cron/systemd-timera oraz z admin-endpointu.
    Zwraca licznik zamkniętych zleceń.
    """
    with transaction() as conn:
        rowcount = cx_execute_rowcount(
            conn,
            """
            UPDATE mixing_orders
            SET status = 'done', completed_at = NOW()
            WHERE status = 'in_progress'
              AND COALESCE(kg_done, 0) >= COALESCE(meat_kg, 0) - 0.1
              AND id NOT IN (
                  SELECT order_id FROM machine_locks WHERE expires_at > NOW()
              )
            """,
        )
    if rowcount:
        logger.info("mixing.cleanup.closed_stale", extra={"count": rowcount})
    return {"closed": int(rowcount or 0)}


def get_mixing_order(order_id: str) -> Dict:
    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (order_id,))
    if not order:
        raise HTTPException(404, "Zlecenie masowania nie znalezione")
    return build_mixing_order(order)


# ── Create ─────────────────────────────────────────────────────────────

def create_mixing_order(dto: MixingOrderCreate) -> Dict:
    if not dto.recipe_id:
        raise HTTPException(400, "recipe_id wymagane")
    if not dto.meat_lots:
        raise HTTPException(
            400,
            "Zlecenie masowania wymaga co najmniej jednej partii mięsa. "
            "Wybierz partie z rozbioru przed utworzeniem zlecenia.",
        )

    oid = cuid()

    with transaction() as conn:
        # Numer zlecenia masowania = MAS/dd/mm/rr (wspólny helper, jak produkcja PP).
        order_no = next_dated_no(conn, "MAS")
        recipe = cx_query_one(
            conn, "SELECT * FROM recipes WHERE id=%s", (dto.recipe_id,)
        )
        if not recipe:
            raise HTTPException(404, "Receptura nie znaleziona")

        product_type = None
        if dto.product_type_id:
            product_type = cx_query_one(
                conn,
                "SELECT * FROM product_types WHERE id=%s",
                (dto.product_type_id,),
            )

        planned_output_kg = calc_kg_output(dto.recipe_id, dto.meat_kg)

        cx_execute(
            conn,
            """
            INSERT INTO mixing_orders
                (id, order_no, recipe_id, recipe_name,
                 product_type_id, product_type_name,
                 meat_kg, planned_output_kg, kg_done, machine_id,
                 status, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,0,NULL,'planned',%s,%s)
            """,
            (
                oid,
                order_no,
                recipe["id"],
                recipe["name"],
                dto.product_type_id or None,
                product_type["name"] if product_type else None,
                dto.meat_kg,
                planned_output_kg,
                dto.notes or None,
                now_iso(),
            ),
        )

        # Lock lots deterministically to avoid deadlocks
        for lot_dto in sorted(dto.meat_lots, key=lambda x: x.meat_lot_id):
            locked = cx_query_one(
                conn,
                "SELECT * FROM meat_stock WHERE id=%s FOR UPDATE",
                (lot_dto.meat_lot_id,),
            )
            if not locked:
                raise HTTPException(
                    400, f"Partia mięsa nie znaleziona: {lot_dto.meat_lot_id}"
                )

            available = float(locked.get("kg_available") or 0)
            reserved = float(locked.get("kg_reserved") or 0)
            free = available - reserved
            if free < lot_dto.kg_planned - 0.1:
                raise HTTPException(
                    400,
                    f"Niewystarczające kg w partii {locked.get('lot_no','?')}: "
                    f"wolne {free:.2f} kg (dostępne {available:.2f} - "
                    f"zarezerwowane {reserved:.2f}), wymagane {lot_dto.kg_planned:.2f} kg.",
                )

            cx_execute(
                conn,
                """
                INSERT INTO mixing_order_lots
                    (id, order_id, meat_stock_id, kg_planned, kg_actual)
                VALUES (%s,%s,%s,%s,0)
                """,
                (cuid(), oid, lot_dto.meat_lot_id, lot_dto.kg_planned),
            )
            rowcount = cx_execute_rowcount(
                conn,
                """
                UPDATE meat_stock
                SET kg_reserved = kg_reserved + %s
                WHERE id = %s
                """,
                (lot_dto.kg_planned, lot_dto.meat_lot_id),
            )
            if rowcount == 0:
                raise HTTPException(
                    409,
                    f"Race condition: brak kg w partii {lot_dto.meat_lot_id} "
                    f"(update failed)",
                )

        order = cx_query_one(
            conn, "SELECT * FROM mixing_orders WHERE id=%s", (oid,)
        )
    assert order is not None
    logger.info(
        "mixing.order.created",
        extra={
            "order_id": oid,
            "order_no": order_no,
            "meat_kg": dto.meat_kg,
            "lots": len(dto.meat_lots),
        },
    )
    return build_mixing_order(order)


# ── Status transitions ─────────────────────────────────────────────────

def confirm_mixing_order(order_id: str) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE mixing_orders SET status='confirmed'
            WHERE id=%s AND status='planned' RETURNING *
            """,
            (order_id,),
        )
    if not row:
        raise HTTPException(404, "Zlecenie nie znalezione lub już potwierdzone")
    logger.info("mixing.order.confirmed", extra={"order_id": order_id})
    return build_mixing_order(row)


def start_mixing_order(order_id: str, body: Dict[str, Any]) -> Dict:
    machine_id = body.get("machineId") or body.get("machine_id")
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE mixing_orders
            SET status='in_progress', started_at=%s, machine_id=%s
            WHERE id=%s AND status IN ('planned','confirmed','in_progress')
            RETURNING *
            """,
            (now_iso(), machine_id, order_id),
        )
        if not row:
            existing = cx_query_one(
                conn, "SELECT status FROM mixing_orders WHERE id=%s", (order_id,))
            if existing:
                raise HTTPException(
                    409,
                    f"Zlecenie ma status '{existing['status']}' — nie można rozpocząć "
                    "(zamknięte lub anulowane).")
            raise HTTPException(404, "Zlecenie nie znalezione")
    logger.info(
        "mixing.order.started",
        extra={"order_id": order_id, "machine_id": machine_id},
    )
    return build_mixing_order(row)


def allocate_to_machine(order_id: str, body: Dict[str, Any]) -> Dict:
    machine_id = body.get("machine_id") or body.get("machineId")
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_orders SET machine_id=%s WHERE id=%s RETURNING *",
            (machine_id, order_id),
        )
    if not row:
        raise HTTPException(404, "Zlecenie nie znalezione")
    return build_mixing_order(row)


def confirm_mixing_step(order_id: str, body: Dict[str, Any]) -> Dict:
    step_no = body.get("stepNo") or body.get("step_no") or 1
    qty_conf = body.get("qtyConfirmed") or body.get("qty_confirmed") or 0
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE mixing_orders
            SET confirmed_steps = COALESCE(confirmed_steps, '{}'::jsonb)
                || jsonb_build_object(%s::text, %s::numeric)
            WHERE id=%s RETURNING *
            """,
            (str(step_no), qty_conf, order_id),
        )
    if not row:
        raise HTTPException(404, "Zlecenie nie znalezione")
    return build_mixing_order(row)


def auto_approve_mixing(order_id: str) -> Dict:
    """Zamknij zlecenie (tablet po pełnym wymieszaniu / biuro wymusza).

    Przy zamknięciu CZĘŚCIOWEGO zlecenia (kg_done < meat_kg) niewykorzystane
    rezerwacje mięsa muszą wrócić do puli — pozostała rezerwacja per lot to
    aktualne mixing_order_lots.kg_planned (maleje przy każdej sesji).
    Bez tego kg_reserved na meat_stock wisiało na zawsze.
    """
    with transaction() as conn:
        lots = cx_query_all(
            conn,
            """SELECT meat_stock_id, kg_planned FROM mixing_order_lots
               WHERE order_id=%s AND COALESCE(kg_planned,0) > 0
               ORDER BY meat_stock_id FOR UPDATE""",
            (order_id,),
        )
        for ms_id in sorted({l["meat_stock_id"] for l in lots if l.get("meat_stock_id")}):
            cx_query_one(conn, "SELECT id FROM meat_stock WHERE id=%s FOR UPDATE", (ms_id,))
        for lot in lots:
            leftover = float(lot.get("kg_planned") or 0)
            if leftover <= 0 or not lot.get("meat_stock_id"):
                continue
            cx_execute(
                conn,
                "UPDATE meat_stock SET kg_reserved = GREATEST(0, kg_reserved - %s) WHERE id=%s",
                (leftover, lot["meat_stock_id"]),
            )
        cx_execute(
            conn,
            "UPDATE mixing_order_lots SET kg_planned=0 WHERE order_id=%s",
            (order_id,),
        )
        row = cx_execute_returning(
            conn,
            """
            UPDATE mixing_orders
            SET status='done', completed_at=%s, kg_in_machine=0
            WHERE id=%s
            RETURNING *
            """,
            (now_iso(), order_id),
        )
    if not row:
        raise HTTPException(404, "Zlecenie nie znalezione")
    logger.info("mixing.order.auto_approved", extra={"order_id": order_id})
    return build_mixing_order(row)


# ── Finish session (stock movements + lineage + ingredient deduction) ─

def finish_mixing_session(order_id: str, dto: FinishMixingSessionDto) -> Dict:
    """End a mixing session: produce seasoned_meat + record stock movements.

    All writes — meat_stock row updates, stock_movements, seasoned_meat
    upsert, ingredient deductions, mixing_orders update — happen inside
    one transaction. FOR UPDATE locks cover every meat_stock row that
    will be mutated.
    """
    kg_meat = float(dto.kg_actual)
    batch_no = dto.batch_no or ""
    lot_allocations = [
        {"meatLotId": a.meat_lot_id, "kg": float(a.kg)} for a in dto.lot_allocations
    ]

    if kg_meat <= 0:
        raise HTTPException(400, "kg_actual musi być > 0")

    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT * FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zlecenie nie znalezione")

        meat_kg = float(order.get("meat_kg") or 0)
        kg_done = float(order.get("kg_done") or 0) + kg_meat
        kg_output = calc_kg_output(order.get("recipe_id"), kg_meat)
        # Pełne kg_done → zlecenie zakończone; mniejsze → wciąż w trakcie.
        # Poprzednia wersja miała zamienione gałęzie i status='done' nigdy nie
        # trafiał do bazy z tej funkcji — zamknięcie szło tylko przez sweep
        # w list_mixing_orders / auto_approve_mixing.
        new_status = "done" if kg_done >= meat_kg - 0.1 else "in_progress"

        if not batch_no:
            # Numer partii (goły vs PP) liczymy z partii FAKTYCZNIE zużytych w
            # TEJ sesji (lot_allocations), a NIE z wszystkich lotów zlecenia.
            # Inaczej: zlecenie obejmujące 2 partie (np. 3000 kg z dwóch)
            # dałoby PP nawet gdy operator wrzucił do maszyny tylko jedną
            # partię (800 kg). PP powstaje tylko gdy w jednym wsadzie fizycznie
            # zmieszano >1 partię. Fallback (brak alokacji) → loty zlecenia z kg.
            consumed_ids = [
                a["meatLotId"]
                for a in lot_allocations
                if a.get("meatLotId") and float(a.get("kg") or 0) > 0
            ]
            if consumed_ids:
                raw_seqs = cx_query_all(
                    conn,
                    """
                    SELECT DISTINCT rb.internal_batch_seq
                    FROM meat_stock ms
                    JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                    WHERE ms.id = ANY(%s) AND rb.internal_batch_seq IS NOT NULL
                    """,
                    (consumed_ids,),
                )
            else:
                raw_seqs = cx_query_all(
                    conn,
                    """
                    SELECT DISTINCT rb.internal_batch_seq
                    FROM mixing_order_lots mol
                    LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                    LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                    WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
                      AND mol.kg_planned > 0
                    """,
                    (order_id,),
                )
            seqs = [r["internal_batch_seq"] for r in raw_seqs if r.get("internal_batch_seq")]
            if len(seqs) == 1:
                batch_no = str(seqs[0])
            else:
                batch_no = combined_batch_no(next_seq("pp_seq"))

        machine_id = order.get("machine_id")

        cx_execute(
            conn,
            """
            INSERT INTO mixing_sessions
                (id, order_id, machine_id, kg_meat, kg_output,
                 batch_no, started_at, completed_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                cuid(),
                order_id,
                machine_id,
                kg_meat,
                kg_output,
                batch_no,
                str(order.get("started_at") or now_iso()),
                now_iso(),
            ),
        )

        expiry = (datetime.utcnow() + timedelta(days=5)).date().isoformat()
        # Rodzaj surowca partii przyprawionej = rodzaj lotów wsadu (w beczce
        # nie mieszamy surowców). Komponenty kebaba wybierają po rodzaju.
        mat_row = cx_query_one(
            conn,
            """
            SELECT ms.material_type_id, ms.material_name
            FROM mixing_order_lots mol
            JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            WHERE mol.order_id = %s
              AND COALESCE(ms.material_type_id,'') <> ''
            LIMIT 1
            """,
            (order_id,),
        )
        if not mat_row and lot_allocations:
            # Zlecenie z planu dnia: loty dopiero w lot_allocations tej sesji
            first_ms = (lot_allocations[0] or {}).get("meatLotId") or \
                       (lot_allocations[0] or {}).get("meat_lot_id")
            if first_ms:
                mat_row = cx_query_one(
                    conn,
                    "SELECT material_type_id, material_name FROM meat_stock WHERE id=%s",
                    (first_ms,),
                )
        mat_id = (mat_row or {}).get("material_type_id") or "mat-cwiartka"
        mat_name = (mat_row or {}).get("material_name") or "Ćwiartka z kurczaka"
        cx_execute(
            conn,
            """
            INSERT INTO seasoned_meat
                (id, batch_no, recipe_id, recipe_name, mixing_order_no,
                 kg_produced, kg_available, kg_used, machine_id,
                 expiry_date, status, material_type_id, material_name, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,'available',%s,%s,%s)
            ON CONFLICT (batch_no) DO UPDATE
            SET kg_produced  = seasoned_meat.kg_produced  + EXCLUDED.kg_produced,
                kg_available = seasoned_meat.kg_available + EXCLUDED.kg_available
            """,
            (
                cuid(),
                batch_no,
                order.get("recipe_id", ""),
                order.get("recipe_name", ""),
                order.get("order_no", ""),
                kg_output,
                kg_output,
                machine_id,
                expiry,
                mat_id,
                mat_name,
                now_iso(),
            ),
        )

        populate_lineage(conn, batch_no, order_id)

        # Ingredient deduction (FIFO), non-blocking on shortages
        recipe_ingredients = cx_query_all(
            conn,
            """
            SELECT ri.ingredient_id, ri.qty_per_100kg, i.unit, i.is_unlimited, i.name
            FROM recipe_ingredients ri
            JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = %s
            """,
            (order.get("recipe_id"),),
        )
        for ing in recipe_ingredients:
            if ing.get("is_unlimited"):
                continue
            qty_needed = round(
                float(ing.get("qty_per_100kg") or 0) / 100.0 * kg_meat, 4
            )
            if qty_needed <= 0:
                continue
            batches = cx_query_all(
                conn,
                """
                SELECT id, qty_available
                FROM ingredient_stock
                WHERE ingredient_id = %s AND qty_available > 0
                ORDER BY created_at ASC
                FOR UPDATE
                """,
                (ing["ingredient_id"],),
            )
            remaining = qty_needed
            for batch in batches:
                if remaining <= 0:
                    break
                avail = float(batch.get("qty_available") or 0)
                deduct = round(min(avail, remaining), 4)
                if deduct <= 0:
                    continue
                cx_execute(
                    conn,
                    "UPDATE ingredient_stock SET qty_available = qty_available - %s "
                    "WHERE id = %s",
                    (deduct, batch["id"]),
                )
                # Per-batch OUT movement — pozwala śledzić wstecznie który
                # batch składnika zasilił którą partię seasoned_meat.
                create_stock_movement(
                    conn,
                    product_type="ingredient",
                    batch_id=batch["id"],
                    qty=deduct,
                    movement_type="OUT",
                    source_type="mixing",
                    source_id=order_id,
                )
                remaining = round(remaining - deduct, 4)
            if remaining > 0.001:
                logger.warning(
                    "mixing.ingredient.shortage",
                    extra={
                        "ingredient_id": ing.get("ingredient_id"),
                        "ingredient_name": ing.get("name"),
                        "recipe_id": order.get("recipe_id"),
                        "order_id": order_id,
                        "required": qty_needed,
                        "missing": remaining,
                        "unit": ing.get("unit") or "",
                    },
                )

        # Session allocations
        if lot_allocations:
            session_allocs: List[Tuple[str, float]] = [
                (
                    a.get("meatLotId") or a.get("meat_lot_id"),
                    float(a.get("kg") or a.get("kg_used") or 0),
                )
                for a in lot_allocations
            ]
        else:
            lots_fb = cx_query_all(
                conn,
                "SELECT meat_stock_id, kg_planned FROM mixing_order_lots WHERE order_id=%s",
                (order_id,),
            )
            total_planned = sum(float(lt.get("kg_planned") or 0) for lt in lots_fb) or 1
            ratio = kg_meat / total_planned if meat_kg > 0 else 0
            session_allocs = [
                (
                    lt["meat_stock_id"],
                    round(float(lt.get("kg_planned") or 0) * ratio, 3),
                )
                for lt in lots_fb
            ]

        # Lock every meat_stock row we will mutate (deterministic order)
        for ms_id in sorted({ms for ms, _ in session_allocs if ms}):
            cx_query_one(
                conn,
                "SELECT id FROM meat_stock WHERE id=%s FOR UPDATE",
                (ms_id,),
            )

        # OUT movements on meat_stock
        for meat_stock_id, kg_used_session in session_allocs:
            if not meat_stock_id or kg_used_session <= 0:
                continue
            create_stock_movement(
                conn,
                product_type="meat",
                batch_id=meat_stock_id,
                qty=kg_used_session,
                movement_type="OUT",
                source_type="mixing",
                source_id=order_id,
            )
            cx_execute(
                conn,
                """
                UPDATE meat_stock
                SET kg_reserved  = GREATEST(0, kg_reserved  - %s),
                    kg_available = GREATEST(0, kg_available - %s),
                    kg_used      = kg_used + %s
                WHERE id = %s
                """,
                (kg_used_session, kg_used_session, kg_used_session, meat_stock_id),
            )

        # Update mixing_order_lots to reflect consumption
        if lot_allocations:
            for alloc in lot_allocations:
                lot_id = alloc.get("meatLotId") or alloc.get("meat_lot_id")
                kg_used = float(alloc.get("kg") or alloc.get("kg_used") or 0)
                if lot_id and kg_used > 0:
                    rowcount = cx_execute_rowcount(
                        conn,
                        """
                        UPDATE mixing_order_lots
                        SET kg_planned = GREATEST(0, kg_planned - %s),
                            kg_actual  = COALESCE(kg_actual, 0) + %s
                        WHERE order_id = %s AND meat_stock_id = %s
                        """,
                        (kg_used, kg_used, order_id, lot_id),
                    )
                    if rowcount == 0:
                        # Zlecenie z planu dnia — loty wybrane dopiero przy
                        # maszynie; dopisz wiersz, żeby lineage/trace widziały
                        # źródło mięsa (mixing_order_lots = krawędź łańcucha)
                        cx_execute(
                            conn,
                            """
                            INSERT INTO mixing_order_lots
                                (id, order_id, meat_stock_id, kg_planned, kg_actual)
                            VALUES (%s,%s,%s,0,%s)
                            """,
                            (cuid(), order_id, lot_id, kg_used),
                        )
        else:
            if kg_meat > 0 and meat_kg > 0:
                ratio = kg_meat / meat_kg
                lots = cx_query_all(
                    conn,
                    "SELECT * FROM mixing_order_lots WHERE order_id=%s",
                    (order_id,),
                )
                for lot in lots:
                    reduce_by = round(float(lot.get("kg_planned") or 0) * ratio, 3)
                    cx_execute(
                        conn,
                        """
                        UPDATE mixing_order_lots
                        SET kg_planned = GREATEST(0, kg_planned - %s),
                            kg_actual  = COALESCE(kg_actual, 0) + %s
                        WHERE id = %s
                        """,
                        (reduce_by, reduce_by, lot["id"]),
                    )

        # IN movement for the seasoned_meat produced
        sm_row = cx_query_one(
            conn, "SELECT id FROM seasoned_meat WHERE batch_no=%s", (batch_no,)
        )
        sm_id = sm_row["id"] if sm_row else batch_no
        create_stock_movement(
            conn,
            product_type="seasoned",
            batch_id=sm_id,
            qty=kg_output,
            movement_type="IN",
            source_type="mixing",
            source_id=order_id,
        )

        completed_at = now_iso() if new_status == "done" else None
        kg_in_machine_val = kg_meat if new_status != "done" else 0
        updated = cx_execute_returning(
            conn,
            """
            UPDATE mixing_orders
            SET kg_done=%s, status=%s, completed_at=%s,
                machine_id=NULL, confirmed_steps='{}'::jsonb,
                kg_in_machine=%s
            WHERE id=%s
            RETURNING *
            """,
            (kg_done, new_status, completed_at, kg_in_machine_val, order_id),
        )

    logger.info(
        "mixing.session.finished",
        extra={
            "order_id": order_id,
            "batch_no": batch_no,
            "kg_meat": kg_meat,
            "kg_output": kg_output,
            "status": new_status,
        },
    )
    return build_mixing_order(updated)


def cancel_mixing_order(order_id: str) -> Dict:
    with transaction() as conn:
        order = cx_query_one(
            conn,
            "SELECT status FROM mixing_orders WHERE id=%s FOR UPDATE",
            (order_id,),
        )
        if not order:
            raise HTTPException(404, "Zlecenie nie znalezione")
        if order["status"] == "in_progress":
            raise HTTPException(
                400,
                "Nie można anulować zlecenia w trakcie aktywnej sesji. "
                "Zakończ sesję na tablecie, a następnie anuluj.",
            )
        if order["status"] not in ("planned", "confirmed"):
            raise HTTPException(
                400,
                f"Nie można anulować zlecenia o statusie '{order['status']}'.",
            )

        lots = cx_query_all(
            conn,
            """
            SELECT meat_stock_id, kg_planned FROM mixing_order_lots
            WHERE order_id = %s ORDER BY meat_stock_id FOR UPDATE
            """,
            (order_id,),
        )
        for ms_id in sorted(
            {lot["meat_stock_id"] for lot in lots if lot.get("meat_stock_id")}
        ):
            cx_query_one(
                conn,
                "SELECT id FROM meat_stock WHERE id=%s FOR UPDATE",
                (ms_id,),
            )
        for lot in lots:
            kg_planned = float(lot.get("kg_planned") or 0)
            if kg_planned <= 0:
                continue
            rowcount = cx_execute_rowcount(
                conn,
                """
                UPDATE meat_stock
                SET kg_reserved = GREATEST(0, kg_reserved - %s)
                WHERE id = %s
                """,
                (kg_planned, lot.get("meat_stock_id")),
            )
            if rowcount == 0:
                raise HTTPException(
                    500,
                    f"Nie można przywrócić kg dla partii "
                    f"{lot.get('meat_stock_id')} (update failed)",
                )

        # Wyzeruj kg_planned lotów — rezerwacja oddana wyżej; bez tego
        # stare wartości udają żywe rezerwacje w raportach/audytach.
        cx_execute(
            conn,
            "UPDATE mixing_order_lots SET kg_planned=0 WHERE order_id=%s",
            (order_id,),
        )
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_orders SET status='cancelled' WHERE id=%s RETURNING *",
            (order_id,),
        )
    if not row:
        raise HTTPException(404, "Zlecenie nie znalezione")
    logger.info("mixing.order.cancelled", extra={"order_id": order_id})
    return build_mixing_order(row)


# ── Plan dnia masowania (kolejka 1→n, edycja na żywo z biura) ──────────
# Biuro planuje dzień jednym zaleceniem: kilka receptur z kolejnością
# (np. 1. Gold 2000 kg, 2. Gold2 2000, 3. Beyaz 3000). Operator widzi
# CAŁY plan na panelu i jedzie po kolei. Plan można edytować w ciągu dnia
# — ale tylko pozycje jeszcze w kolejce (planned/confirmed); to, co już
# w masownicy (in_progress) lub gotowe (done), jest nietykalne.

def validate_day_plan_item(item: Dict[str, Any], is_untouchable: bool) -> None:
    """Waliduje pojedynczą pozycję planu dnia.

    Partie mięsa są OBOWIĄZKOWE dla pozycji edytowalnych (nowa/w kolejce):
    suma kgPlanned partii musi równać się meatKg (tolerancja 0.5 kg).
    Pozycje nietykalne (in_progress/done) pomijają sprawdzanie partii —
    ich loty są już zarezerwowane i nie wolno ich ruszać.
    """
    if is_untouchable:
        return
    recipe_id = str(item.get("recipeId") or item.get("recipe_id") or "")
    meat_kg = float(item.get("meatKg") or item.get("meat_kg") or 0)
    if not recipe_id:
        raise HTTPException(400, "Receptura wymagana dla pozycji planu")
    if meat_kg <= 0:
        raise HTTPException(400, "Kg mięsa musi być > 0")
    lots = item.get("meatLots") or item.get("meat_lots") or []
    if not lots:
        raise HTTPException(
            400,
            "Każda pozycja planu wymaga przypisanych partii mięsa "
            "(partie obowiązkowe przy planowaniu).",
        )
    total = sum(
        float(l.get("kgPlanned") or l.get("kg_planned") or 0) for l in lots
    )
    if abs(total - meat_kg) > 0.5:
        raise HTTPException(
            400,
            f"Suma partii ({total:.2f} kg) ≠ kg pozycji ({meat_kg:.2f} kg).",
        )


def get_day_plan() -> Dict[str, Any]:
    rows = query_all(
        "SELECT * FROM mixing_orders "
        "WHERE created_at::date = CURRENT_DATE AND status <> 'cancelled' "
        "ORDER BY CASE WHEN COALESCE(day_seq,0) > 0 THEN day_seq "
        "ELSE 999999 END, created_at",
    )
    items = [build_mixing_order(o) for o in rows]
    # rev = podpis planu; panel operatora wykrywa zmianę → baner "plan zmieniony"
    sig = "|".join(
        f"{i['id']}:{i['daySeq']}:{i['recipeId']}:{i['meatKg']}:{i['status']}"
        for i in items
    )
    rev = hashlib.md5(sig.encode()).hexdigest()[:12]
    return {"items": items, "rev": rev}


def save_day_plan(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Upsert dzisiejszej kolejki masowania.

    * pozycja z id w kolejce (planned/confirmed) → aktualizacja receptury/kg/kolejności
    * pozycja z id w masownicy/gotowa → tylko kolejność (reszta nietykalna)
    * pozycja bez id → nowe zlecenie 'confirmed' (bez lotów — operator
      wybiera partie mięsa przy maszynie)
    * pozycja w kolejce usunięta z planu → anulowanie (zwolnienie rezerwacji)
    """
    to_cancel: List[str] = []
    with transaction() as conn:
        today = cx_query_all(
            conn,
            "SELECT id, status FROM mixing_orders "
            "WHERE created_at::date = CURRENT_DATE AND status <> 'cancelled' "
            "FOR UPDATE",
        )
        editable = {r["id"] for r in today if r["status"] in ("planned", "confirmed")}
        untouchable = {r["id"] for r in today if r["status"] in ("in_progress", "done")}
        sent: set = set()

        for idx, it in enumerate(items):
            seq = int(it.get("seq") or it.get("daySeq") or (idx + 1))
            oid = str(it.get("id") or "")
            recipe_id = str(it.get("recipeId") or it.get("recipe_id") or "")
            meat_kg = float(it.get("meatKg") or it.get("meat_kg") or 0)

            if oid and oid in untouchable:
                cx_execute(
                    conn, "UPDATE mixing_orders SET day_seq=%s WHERE id=%s",
                    (seq, oid),
                )
                sent.add(oid)
                continue

            if oid and oid in editable:
                recipe = cx_query_one(
                    conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,)
                ) if recipe_id else None
                if not recipe:
                    raise HTTPException(400, "Receptura wymagana dla pozycji planu")
                if meat_kg <= 0:
                    raise HTTPException(400, "Kg mięsa musi być > 0")
                cx_execute(
                    conn,
                    """
                    UPDATE mixing_orders
                    SET day_seq=%s, recipe_id=%s, recipe_name=%s, meat_kg=%s,
                        planned_output_kg=%s
                    WHERE id=%s AND status IN ('planned','confirmed')
                    """,
                    (seq, recipe["id"], recipe["name"], meat_kg,
                     calc_kg_output(recipe["id"], meat_kg), oid),
                )
                sent.add(oid)
                continue

            # Nowa pozycja planu
            recipe = cx_query_one(
                conn, "SELECT * FROM recipes WHERE id=%s", (recipe_id,)
            )
            if not recipe:
                raise HTTPException(400, "Receptura nie znaleziona")
            if meat_kg <= 0:
                raise HTTPException(400, "Kg mięsa musi być > 0")
            order_no = next_dated_no(conn, "MAS")
            cx_execute(
                conn,
                """
                INSERT INTO mixing_orders
                    (id, order_no, recipe_id, recipe_name, meat_kg,
                     planned_output_kg, kg_done, machine_id, status,
                     day_seq, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,0,NULL,'confirmed',%s,%s)
                """,
                (cuid(), order_no, recipe["id"], recipe["name"], meat_kg,
                 calc_kg_output(recipe["id"], meat_kg), seq, now_iso()),
            )

        to_cancel = sorted(editable - sent)

    # Anulowanie POZA transakcją planu — cancel_mixing_order zwalnia
    # rezerwacje lotów we własnej transakcji
    for oid in to_cancel:
        try:
            cancel_mixing_order(oid)
        except HTTPException:
            pass  # np. wyścig ze startem na panelu — pozycja zostaje

    logger.info("mixing.day_plan.saved", extra={"items_count": len(items)})
    return get_day_plan()
