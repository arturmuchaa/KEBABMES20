"""Finished goods: list, create, finish-day.

The ``finish_day`` operation is the MES's terminal step and MUST:
    * run inside a single transaction,
    * record every kg of packaging consumption,
    * emit ``stock_movements`` IN entries for every finished_goods row,
    * emit ``stock_movements`` OUT entries for the seasoned_meat consumed,
    * deduct seasoned_meat.kg_reserved + kg_available (and bump kg_used),
    * maintain write-time lineage (source_mixing_ids / seasoned / deboning).
"""
import json
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
from app.models.production import FinishDayDto, FinishDayEntry, FinishedGoodCreate
from app.utils.body import body_get
from app.utils.batch_numbers import kebab_batch_no, production_combined_batch_no
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


def _consume_seasoned_for_entry(
    conn,
    *,
    plan_id: str,
    plan_line_id: str,
    entry_qty: int,
    total_kg: float,
    seasoned_batch_nos: List[str],
) -> None:
    """Zdejmij seasoned_meat odpowiadające ``entry_qty`` sztuk z linii planu.

    Strategia:
        1. Spróbuj wczytać ``production_plan_lines.batch_allocation`` —
           tam plan zapamiętał kto-ile-kg ma dostarczyć. Skaluj proporcjonalnie
           ``entry_qty / line.qty`` (operator może domykać w kilku wpisach).
        2. Brak alokacji w planie → fallback: równy podział ``total_kg``
           pomiędzy ``seasoned_batch_nos``.

    Dla każdej partii:
        * lockuje wiersz ``FOR UPDATE``,
        * dekrementuje kg_reserved i kg_available, inkrementuje kg_used,
        * emituje ``stock_movements`` OUT (źródło: plan).

    Funkcja musi działać wewnątrz transakcji wywołującego.
    """
    if total_kg <= 0:
        return

    per_batch: Dict[str, Dict[str, Any]] = {}

    if plan_line_id:
        line = cx_query_one(
            conn,
            """
            SELECT batch_allocation, qty
            FROM production_plan_lines
            WHERE id = %s FOR UPDATE
            """,
            (plan_line_id,),
        )
        if line:
            ba = line.get("batch_allocation") or {}
            if isinstance(ba, str):
                try:
                    ba = json.loads(ba)
                except Exception:
                    ba = {}
            line_qty = max(1, int(line.get("qty") or 0))
            scale = entry_qty / line_qty if line_qty > 0 else 1.0
            if isinstance(ba, dict):
                for batch_no, alloc in ba.items():
                    if not isinstance(alloc, dict):
                        continue
                    bid = alloc.get("batch_id")
                    full_kg = float(alloc.get("kg") or 0)
                    take = round(full_kg * scale, 3)
                    if not bid or take <= 0:
                        continue
                    per_batch[bid] = {"kg": take, "batch_no": batch_no or ""}

    # Fallback: equal split when allocation missing
    if not per_batch and seasoned_batch_nos:
        share = round(total_kg / max(1, len(seasoned_batch_nos)), 3)
        for bno in seasoned_batch_nos:
            sm = cx_query_one(
                conn, "SELECT id FROM seasoned_meat WHERE batch_no=%s", (bno,)
            )
            if sm and sm.get("id"):
                per_batch[sm["id"]] = {"kg": share, "batch_no": bno}

    if not per_batch:
        logger.warning(
            "finish_day.seasoned_consume.no_target",
            extra={
                "plan_id": plan_id,
                "plan_line_id": plan_line_id,
                "total_kg": total_kg,
                "seasoned_batch_nos": seasoned_batch_nos,
            },
        )
        return

    # Lock all touched rows in deterministic order first to avoid deadlocks
    for bid in sorted(per_batch.keys()):
        cx_query_one(
            conn,
            "SELECT id FROM seasoned_meat WHERE id=%s FOR UPDATE",
            (bid,),
        )

    for bid, payload in per_batch.items():
        take = float(payload["kg"])
        if take <= 0:
            continue
        # Konsumpcja: zdejmij z kg_available, dodaj do kg_used.
        # kg_reserved NIE ruszamy tutaj — to robi `release_plan_reservations`
        # przy zamknięciu planu (finish_day kończy => zwalnia wszystkie
        # rezerwacje planu hurtowo, niezależnie czy linie zostały wyprodukowane).
        # Bez tego nie-wyprodukowane linie zostawały z kg_reserved na zawsze.
        cx_execute(
            conn,
            """
            UPDATE seasoned_meat
            SET kg_available = GREATEST(0, kg_available - %s),
                kg_used      = COALESCE(kg_used, 0) + %s
            WHERE id = %s
            """,
            (take, take, bid),
        )
        create_stock_movement(
            conn,
            product_type="seasoned",
            batch_id=bid,
            qty=take,
            movement_type="OUT",
            source_type="plan",
            source_id=plan_id,
        )


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


def create_finished_good(dto: FinishedGoodCreate) -> Dict:
    qty = int(dto.qty)
    kg_per_unit = float(dto.kg_per_unit)
    total_kg = round(qty * kg_per_unit, 3)
    produced_date = dto.produced_date or datetime.now().date().isoformat()
    if dto.batch_no:
        batch_no = dto.batch_no
    else:
        batch_no = _compute_kebab_batch_no(produced_date, dto.seasoned_batch_nos or [])

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
                dto.plan_no or "",
                dto.product_type_id or "",
                dto.product_type_name or "",
                dto.recipe_id or "",
                dto.recipe_name or "",
                dto.packaging_id or None,
                dto.packaging_name or None,
                dto.client_name or None,
                dto.client_order_no or None,
                qty,
                kg_per_unit,
                total_kg,
                qty,
                produced_date,
                dto.produced_by or [],
                dto.seasoned_batch_nos or [],
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

        if dto.packaging_id and qty > 0:
            _consume_packaging(conn, dto.packaging_id, qty, item["id"])

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
            created.extend(_process_finish_day_entry(conn, plan, entry, today) or [])

        # Zamknij wszystkie linie planu i sam plan.
        # Bez tego linie z qty_done > 0 zostają jako IN_PROGRESS i dashboard
        # nadal pokazuje "Na żywo" mimo że dzień jest zamknięty.
        cx_execute(
            conn,
            """
            UPDATE production_plan_lines
            SET line_status = 'DONE',
                progress_updated_at = COALESCE(progress_updated_at, now())
            WHERE plan_id = %s
              AND qty_done > 0
            """,
            (dto.plan_id,),
        )

        # Zwolnij wszystkie kg_reserved tego planu — niezależnie od tego
        # czy linie zostały faktycznie wyprodukowane. Bez tego nie-wykonane
        # linie blokowały kg_reserved na zawsze (plan.status='done' a
        # rezerwacja stała). Konsumpcja (kg_available / kg_used) odbyła się
        # już per-entry; tu zamykamy stronę rezerwacyjną.
        from app.services.production_plans_service import _restore_reservations
        _restore_reservations(conn, dto.plan_id)

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


def _compute_kebab_batch_no(produced_date: str, seasoned_batch_nos: List[str]) -> str:
    """Numer kebaba.

    * 1 partia wsadowa → 'ddmmrr <numer wsadu>' (np. '020626 344').
    * >1 partii (fizycznie zmieszane na PRODUKCJI w tych samych sztukach)
      → nowa partia łączona PPP{n}, numer 'ddmmrr PPP{n}'.
      (PP zostaje zarezerwowane dla łączenia w mieszalniku/beczce.)
    """
    if seasoned_batch_nos and len(seasoned_batch_nos) == 1:
        return kebab_batch_no(produced_date, seasoned_batch_nos[0])
    ppp = production_combined_batch_no(next_seq("ppp_seq"))
    return kebab_batch_no(produced_date, ppp)


def entry_batch_portions(qty, batch_allocation) -> List[Dict[str, Any]]:
    """Rozbij wpis zamknięcia dnia na porcje per partia wsadowa wg
    ``batch_allocation`` (sztuki na partię ustawione w planowaniu).

    Zwraca ``[{"batch_no", "qty"}]`` gdy alokacja dzieli się czysto na sztuki
    (suma ``pieces`` == qty) — wtedy każda partia dostaje osobny wiersz
    finished_goods, więc każda sztuka ma poprawną partię. W innym wypadku ``[]``
    (sygnał: tryb łączony — jedna partia / PP gdy fizycznie zmieszane).
    Spójne z `finished_units` i HDI, które też rozbijają per `batch_allocation`.
    """
    qty = int(qty or 0)
    ba = batch_allocation if isinstance(batch_allocation, dict) else {}
    portions: List[Dict[str, Any]] = []
    total = 0
    for bno, alloc in ba.items():
        if not isinstance(alloc, dict):
            continue
        pieces = int(alloc.get("pieces") or 0)
        if pieces <= 0:
            continue
        total += pieces
        portions.append({"batch_no": bno, "qty": pieces})
    if portions and total == qty:
        return portions
    return []


def _upsert_goods_row(conn, plan, entry, today, batch_no, qty, total_kg,
                      seasoned_batch_nos, lineage) -> str:
    """Utwórz lub zinkrementuj jeden wiersz finished_goods dla danej partii
    kebaba (+ sesja + ruch IN). Zwraca id wiersza."""
    src_mixing = lineage["mixing_order_ids"]
    src_seasoned = lineage["seasoned_meat_ids"]
    src_deboning = lineage["deboning_entry_ids"]

    existing = cx_query_one(
        conn,
        """
        SELECT * FROM finished_goods
        WHERE produced_date = %s
          AND batch_no = %s
          AND recipe_id = %s
          AND COALESCE(packaging_id,'') = %s
          AND COALESCE(client_name,'') = %s
          AND kg_per_unit = %s
        FOR UPDATE
        """,
        (today, batch_no, entry.recipe_id, entry.packaging_id or "",
         entry.client_name or "", entry.kg_per_unit),
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
                        COALESCE(seasoned_batch_nos,'{}'::text[]) || %s::text[]))),
                source_mixing_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_mixing_ids,'{}'::text[]) || %s::text[]))),
                source_seasoned_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_seasoned_ids,'{}'::text[]) || %s::text[]))),
                source_deboning_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_deboning_ids,'{}'::text[]) || %s::text[])))
            WHERE id = %s
            """,
            (qty, total_kg, qty, entry.worker_names, seasoned_batch_nos,
             src_mixing, src_seasoned, src_deboning, existing["id"]),
        )
        item_id = existing["id"]
    else:
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
            (cuid(), batch_no, plan["plan_no"], entry.product_type_id,
             entry.product_type_name, entry.recipe_id, entry.recipe_name,
             entry.packaging_id or None, entry.packaging_name or None,
             entry.client_name or None, entry.client_order_no or None,
             qty, entry.kg_per_unit, total_kg, qty, today, entry.worker_names,
             seasoned_batch_nos, plan["id"], src_mixing, src_seasoned,
             src_deboning, now_iso()),
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
        (cuid(), item_id, entry.plan_line_id, qty, total_kg,
         seasoned_batch_nos, entry.worker_names, now_iso()),
    )

    if total_kg > 0:
        create_stock_movement(
            conn, product_type="finished_goods", batch_id=item_id,
            qty=total_kg, movement_type="IN", source_type="plan",
            source_id=plan["id"],
        )
    return item_id


def _process_finish_day_entry(
    conn, plan: Dict, entry: FinishDayEntry, today: str
) -> List[Dict]:
    """Zapis wpisu zamknięcia dnia.

    Gdy linia ma rozbicie partii (`batch_allocation`) dzielące się czysto na
    sztuki → OSOBNY wiersz finished_goods per partia (każda sztuka ma poprawną
    partię, spójnie z `finished_units`/HDI). W innym wypadku jeden wiersz
    (partia, a przy fizycznym zmieszaniu — PP). Konsumpcja mięsa i opakowań
    odbywa się RAZ na cały wpis (rozbicie kg per partia w `_consume_seasoned`).
    """
    if entry.qty <= 0:
        return []
    if not entry.seasoned_batch_nos:
        logger.warning(
            "finish_day.missing_seasoned",
            extra={"plan_line_id": entry.plan_line_id,
                   "recipe_id": entry.recipe_id, "qty": entry.qty},
        )

    # Rozbicie partii z linii planu (sztuki per partia).
    allocation: Dict[str, Any] = {}
    if entry.plan_line_id:
        ln = cx_query_one(
            conn, "SELECT batch_allocation FROM production_plan_lines WHERE id=%s",
            (entry.plan_line_id,))
        if ln:
            ba = ln.get("batch_allocation") or {}
            if isinstance(ba, str):
                try:
                    ba = json.loads(ba)
                except Exception:
                    ba = {}
            allocation = ba if isinstance(ba, dict) else {}

    portions = entry_batch_portions(entry.qty, allocation)
    item_ids: List[str] = []

    if portions:
        # Osobny wiersz per partia — każda sztuka dostaje swój numer partii.
        for p in portions:
            raw = p["batch_no"]
            pqty = int(p["qty"])
            pkg_kg = round(pqty * entry.kg_per_unit, 3)
            bno = kebab_batch_no(today, raw)
            lineage = _resolve_lineage(conn, [raw])
            item_ids.append(_upsert_goods_row(
                conn, plan, entry, today, bno, pqty, pkg_kg, [raw], lineage))
    else:
        # Tryb łączony: jedna partia (lub PP gdy fizycznie zmieszane).
        total_kg = round(entry.qty * entry.kg_per_unit, 3)
        bno = _compute_kebab_batch_no(today, entry.seasoned_batch_nos or [])
        lineage = _resolve_lineage(conn, entry.seasoned_batch_nos or [])
        item_ids.append(_upsert_goods_row(
            conn, plan, entry, today, bno, entry.qty, total_kg,
            entry.seasoned_batch_nos or [], lineage))

    # Konsumpcja seasoned_meat — RAZ na cały wpis (split per partia w środku).
    # Domyka łańcuch audytu — patrz CLAUDE.md "TRACEABILITY MUST WORK BOTH WAYS".
    total_kg = round(entry.qty * entry.kg_per_unit, 3)
    if total_kg > 0:
        _consume_seasoned_for_entry(
            conn, plan_id=plan["id"], plan_line_id=entry.plan_line_id,
            entry_qty=entry.qty, total_kg=total_kg,
            seasoned_batch_nos=entry.seasoned_batch_nos or [],
        )

    # Opakowania — RAZ na cały wpis.
    if entry.packaging_id and entry.qty > 0 and item_ids:
        _consume_packaging(conn, entry.packaging_id, entry.qty, item_ids[0])

    # Twardy link sztuka → wyrób gotowy (raz, gdy wszystkie wyroby tej linii już są).
    if entry.plan_line_id:
        from app.services.finished_units_service import link_units_for_plan_line

        link_units_for_plan_line(conn, entry.plan_line_id)

    return [cx_query_one(conn, "SELECT * FROM finished_goods WHERE id=%s", (iid,))
            for iid in item_ids]
