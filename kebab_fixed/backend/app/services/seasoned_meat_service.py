"""Seasoned meat: traceability + from-order creation."""
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.services.recipes_service import calc_kg_output
from app.utils.batch_numbers import combined_batch_no, scrap_pool_batch_no
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def list_all_seasoned() -> List[Dict]:
    return list_all_seasoned_with_reservations()


def list_seasoned() -> Dict[str, List[Dict]]:
    """Zwraca tylko partie z wolnymi kg (kg_available - kg_reserved > 0).

    Po zatwierdzeniu planu produkcji kg lecą do kg_reserved (nie do kg_used),
    więc partia nadal istnieje fizycznie, ale nie powinna być widoczna jako
    "do zaplanowania". Dodatkowo wystawiamy kg_free i kg_reserved żeby
    frontend mógł pokazać statystyki rezerwacji.
    """
    rows = query_all(
        """
        SELECT *,
               (kg_available - COALESCE(kg_reserved, 0)) AS kg_free
        FROM seasoned_meat
        WHERE (kg_available - COALESCE(kg_reserved, 0)) > 0
          AND status != 'depleted'
        ORDER BY expiry_date ASC, batch_no ASC
        """
    )
    return {"data": rows}


def list_all_seasoned_with_reservations() -> List[Dict]:
    """Pełna lista (włącznie z w 100% zarezerwowanymi) — dla widoku 'wszystkie'.

    Używana w office/magazyn/mieso-przyp żeby pokazać też partie które są
    zarezerwowane (oznaczone badge'em "zarezerwowane").
    """
    return query_all(
        """
        SELECT *,
               (kg_available - COALESCE(kg_reserved, 0)) AS kg_free
        FROM seasoned_meat
        ORDER BY created_at DESC
        """
    )


def _reconcile_row(
    conn,
    row: Dict[str, Any],
    target_kg: float,
    reason: str = "",
    close: bool = False,
) -> float:
    """Rdzeń korekty jednej partii przyprawionej — współdzielony przez
    `reconcile_seasoned_batch` (pojedyncza partia) i `reconcile_production_day`
    (grupa partii jednego dnia produkcji). Zakłada, że `row` jest już pobrany
    z `FOR UPDATE` w bieżącej transakcji `conn`. Zwraca zastosowaną deltę
    (target - stara dostępna waga); 0.0 gdy brak zmiany i `close=False`.

    kg_produced jest WYLICZONE z receptury (mięso × %), więc realna waga
    zawsze różni się o 1–3 kg (dozowanie, chłonność wody, wagi). Ustawia
    REALNĄ dostępną wagę: teoria zaniżona (np. 119, a fizycznie 120) → podnieś,
    resztka po produkcji (za dużo) → zamknij (``close``) do 0. Różnica idzie
    ruchem magazynowym (IN gdy +, OUT gdy −; product_type 'seasoned', source
    'reconcile') — udokumentowany ślad dla kosztu i dokumentów weterynaryjnych.
    kg_produced podąża za korektą (produced = used + available + reserved).
    Koszt/kg liczy się z receptury, więc korekta go nie rusza — patrz
    cost_service.

    Blokady: partia zamknięta; waga < kg zarezerwowanych pod plan (najpierw
    zwolnij plan); waga ujemna.
    """
    seasoned_id = row["id"]
    if (row.get("status") or "") == "closed":
        raise HTTPException(400, "Partia jest już zamknięta")

    old_avail = float(row.get("kg_available") or 0)
    reserved = float(row.get("kg_reserved") or 0)
    target = 0.0 if close else round(float(target_kg or 0), 3)
    if target < 0:
        raise HTTPException(400, "Waga nie może być ujemna")
    if target + 0.001 < reserved:
        raise HTTPException(
            400,
            f"W partii jest {reserved:.1f} kg zarezerwowane pod plan — nie "
            f"można zejść poniżej. Najpierw zwolnij/usuń pozycję planu.",
        )

    delta = round(target - old_avail, 3)
    if abs(delta) < 0.001 and not close:
        return 0.0

    new_produced = round(float(row.get("kg_produced") or 0) + delta, 3)
    new_status = "closed" if close else (row.get("status") or "available")
    cx_execute(
        conn,
        """
        UPDATE seasoned_meat
        SET kg_available=%s, kg_produced=%s, status=%s,
            reconciled_at=%s, reconcile_reason=%s
        WHERE id=%s
        """,
        (target, new_produced, new_status, now_iso(), (reason or None), seasoned_id),
    )
    if delta > 0.001:
        create_stock_movement(
            conn, product_type="seasoned", batch_id=seasoned_id,
            qty=delta, movement_type="IN",
            source_type="reconcile", source_id=seasoned_id,
        )
    elif delta < -0.001:
        create_stock_movement(
            conn, product_type="seasoned", batch_id=seasoned_id,
            qty=-delta, movement_type="OUT",
            source_type="reconcile", source_id=seasoned_id,
        )
    return delta


def reconcile_seasoned_batch(
    seasoned_id: str,
    target_kg: float,
    reason: str = "",
    close: bool = False,
) -> Dict[str, Any]:
    """Ręczna korekta/zamknięcie POJEDYNCZEJ partii przyprawionej — wrapper
    nad `_reconcile_row` dla API `/seasoned-meat/{id}/reconcile`. Logika
    opisana w `_reconcile_row`."""
    with transaction() as conn:
        b = cx_query_one(
            conn, "SELECT * FROM seasoned_meat WHERE id=%s FOR UPDATE", (seasoned_id,)
        )
        if not b:
            raise HTTPException(404, "Partia przyprawiona nie znaleziona")

        delta = _reconcile_row(conn, b, target_kg, reason, close)
        if delta == 0.0 and not close:
            raise HTTPException(400, "Brak zmiany wagi — podaj inną wartość.")

        row = cx_query_one(
            conn,
            "SELECT *, (kg_available - COALESCE(kg_reserved,0)) AS kg_free "
            "FROM seasoned_meat WHERE id=%s",
            (seasoned_id,),
            )

        row = cx_query_one(
            conn,
            "SELECT *, (kg_available - COALESCE(kg_reserved,0)) AS kg_free "
            "FROM seasoned_meat WHERE id=%s",
            (seasoned_id,),
        )
    logger.info(
        "seasoned.reconciled",
        extra={
            "seasoned_id": seasoned_id, "delta": delta,
            "close": close, "reason": reason or "",
        },
    )
    return row


def populate_lineage(conn, batch_no: str, order_id: str) -> None:
    """Forward + backward lineage links for a seasoned_meat row.

    Must run inside an open transaction so the mutations are atomic with
    the caller's INSERT/UPDATE on seasoned_meat.
    """
    lots = cx_query_all(
        conn,
        """
        SELECT mol.meat_stock_id, ms.deboning_session_id, ms.raw_batch_id
        FROM   mixing_order_lots mol
        LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
        WHERE  mol.order_id = %s
        """,
        (order_id,),
    )
    if not lots:
        logger.warning(
            "seasoned.lineage.no_lots",
            extra={"order_id": order_id, "batch_no": batch_no},
        )

    deboning_ids = list({lt["deboning_session_id"] for lt in lots if lt.get("deboning_session_id")})
    if deboning_ids:
        cx_execute(
            conn,
            """
            UPDATE seasoned_meat
            SET source_deboning_ids = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(source_deboning_ids, '{}') || %s::text[]
                ))
            )
            WHERE batch_no = %s
            """,
            (deboning_ids, batch_no),
        )
    else:
        logger.warning(
            "seasoned.lineage.no_deboning_ids",
            extra={"batch_no": batch_no, "order_id": order_id},
        )

    cx_execute(
        conn,
        """
        UPDATE mixing_orders
        SET source_seasoned_batch_ids = (
            SELECT ARRAY(SELECT DISTINCT unnest(
                COALESCE(source_seasoned_batch_ids, '{}') || ARRAY[%s]
            ))
        )
        WHERE id = %s
        """,
        (batch_no, order_id),
    )


def seasoned_from_order(order_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    kg_meat_raw = float(body.get("kg_produced") or 0)
    with transaction() as conn:
        order = cx_query_one(
            conn, "SELECT * FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,)
        )
        if not order:
            raise HTTPException(404, "Zlecenie masowania nie znalezione")

        # Spójnie z finish_mixing_session: numer partii (goły vs PP) liczymy
        # tylko z lotów REALNIE powiązanych ze zleceniem — faktycznie zużytych
        # (kg_actual > 0) lub wciąż zaplanowanych (kg_planned > 0). Wykluczamy
        # fantomowe loty 0/0 kg, które dawałyby fałszywe PP mimo jednej partii.
        raw_seqs = cx_query_all(
            conn,
            """
            SELECT DISTINCT rb.internal_batch_seq
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
            WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
              AND (COALESCE(mol.kg_actual, 0) > 0 OR COALESCE(mol.kg_planned, 0) > 0)
            """,
            (order_id,),
        )
        seqs = [r["internal_batch_seq"] for r in raw_seqs if r.get("internal_batch_seq")]
        if len(seqs) == 1:
            batch_no = str(seqs[0])
        else:
            batch_no = combined_batch_no(next_seq("pp_seq"))

        kg = calc_kg_output(order.get("recipe_id"), kg_meat_raw)
        expiry = (datetime.utcnow() + timedelta(days=5)).date().isoformat()

        cx_execute(
            conn,
            """
            INSERT INTO seasoned_meat
                (id, batch_no, recipe_id, recipe_name, mixing_order_no,
                 kg_produced, kg_available, kg_used, machine_id,
                 expiry_date, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,'available',%s)
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
                kg,
                kg,
                order.get("machine_id"),
                expiry,
                now_iso(),
            ),
        )

        populate_lineage(conn, batch_no, order_id)

        sm_row = cx_query_one(
            conn, "SELECT id FROM seasoned_meat WHERE batch_no=%s", (batch_no,)
        )
        sm_id = sm_row["id"] if sm_row else batch_no

        create_stock_movement(
            conn,
            product_type="seasoned",
            batch_id=sm_id,
            qty=kg,
            movement_type="IN",
            source_type="mixing",
            source_id=order_id,
        )

        row = cx_query_one(
            conn, "SELECT * FROM seasoned_meat WHERE batch_no=%s", (batch_no,)
        )
    assert row is not None
    logger.info(
        "seasoned.created_from_order",
        extra={"batch_no": batch_no, "order_id": order_id, "kg": kg},
    )
    return {"id": row["id"], "batchNo": row["batch_no"], "kgProduced": kg}


def seasoned_trace(batch_id: str) -> Dict[str, Any]:
    from app.services.deboning_service import _map_deboning_entry

    batch = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (batch_id,))
    if not batch:
        raise HTTPException(404, "Partia nie znaleziona")

    mixing_order = None
    if batch.get("mixing_order_no"):
        mixing_order = query_one(
            "SELECT * FROM mixing_orders WHERE order_no=%s",
            (batch["mixing_order_no"],),
        )

    meat_lots_detail: List[Dict] = []
    if mixing_order:
        lots = query_all(
            """
            SELECT mol.*, ms.lot_no, ms.raw_batch_id, ms.raw_batch_no,
                   ms.expiry_date, ms.deboning_session_id
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            WHERE mol.order_id = %s
            """,
            (mixing_order["id"],),
        )
        for lot in lots:
            rb = (
                query_one(
                    "SELECT * FROM raw_batches WHERE id=%s",
                    (lot.get("raw_batch_id"),),
                )
                if lot.get("raw_batch_id")
                else None
            )
            sup = (
                query_one(
                    "SELECT * FROM suppliers WHERE id=%s", (rb["supplier_id"],)
                )
                if rb and rb.get("supplier_id")
                else None
            )
            deb = (
                query_one(
                    "SELECT * FROM deboning_entries WHERE id=%s",
                    (lot.get("deboning_session_id"),),
                )
                if lot.get("deboning_session_id")
                else None
            )
            meat_lots_detail.append(
                {
                    "meatStockId": lot.get("meat_stock_id") or "",
                    "meatLotNo": lot.get("lot_no") or "",
                    "kgPlanned": float(lot.get("kg_planned") or 0),
                    "kgActual": float(lot.get("kg_actual") or 0),
                    "expiryDate": str(lot.get("expiry_date") or ""),
                    "rawBatch": rb,
                    "supplier": sup,
                    "deboningEntry": _map_deboning_entry(deb) if deb else None,
                }
            )

    if not meat_lots_detail and batch.get("source_deboning_ids"):
        for deb_id in batch.get("source_deboning_ids") or []:
            if not deb_id:
                continue
            deb = query_one(
                "SELECT * FROM deboning_entries WHERE id=%s", (deb_id,)
            )
            if not deb:
                continue
            rb = (
                query_one(
                    "SELECT * FROM raw_batches WHERE id=%s",
                    (deb.get("raw_batch_id"),),
                )
                if deb.get("raw_batch_id")
                else None
            )
            sup = (
                query_one(
                    "SELECT * FROM suppliers WHERE id=%s", (rb["supplier_id"],)
                )
                if rb and rb.get("supplier_id")
                else None
            )
            ms = query_one(
                "SELECT * FROM meat_stock WHERE deboning_session_id=%s LIMIT 1",
                (deb_id,),
            )
            meat_lots_detail.append(
                {
                    "meatStockId": ms["id"] if ms else "",
                    "meatLotNo": ms.get("lot_no")
                    if ms
                    else (deb.get("raw_batch_no") or ""),
                    "kgPlanned": float(deb.get("kg_meat") or 0),
                    "kgActual": float(deb.get("kg_meat") or 0),
                    "expiryDate": str(ms.get("expiry_date") or "") if ms else "",
                    "rawBatch": rb,
                    "supplier": sup,
                    "deboningEntry": _map_deboning_entry(deb),
                }
            )

    if not meat_lots_detail:
        # Goły numer partii (np. "344") == internal_batch_seq surowca.
        mp_match = re.match(r"^(\d+)$", batch.get("batch_no") or "")
        if mp_match:
            raw_seq = int(mp_match.group(1))
            rb = query_one(
                "SELECT * FROM raw_batches WHERE internal_batch_seq=%s", (raw_seq,)
            )
            if rb:
                sup = (
                    query_one(
                        "SELECT * FROM suppliers WHERE id=%s", (rb["supplier_id"],)
                    )
                    if rb.get("supplier_id")
                    else None
                )
                ms = query_one(
                    "SELECT * FROM meat_stock WHERE raw_batch_id=%s "
                    "ORDER BY created_at LIMIT 1",
                    (rb["id"],),
                )
                deb = query_one(
                    "SELECT * FROM deboning_entries WHERE raw_batch_id=%s "
                    "AND COALESCE(status, 'complete') = 'complete' "
                    "ORDER BY created_at LIMIT 1",
                    (rb["id"],),
                )
                meat_lots_detail.append(
                    {
                        "meatStockId": ms["id"] if ms else "",
                        "meatLotNo": ms.get("lot_no") if ms else "",
                        "kgPlanned": float(batch.get("kg_produced") or 0),
                        "kgActual": float(batch.get("kg_produced") or 0),
                        "expiryDate": str(ms.get("expiry_date") or "") if ms else "",
                        "rawBatch": rb,
                        "supplier": sup,
                        "deboningEntry": _map_deboning_entry(deb) if deb else None,
                    }
                )

    total_raw_kg = sum(l["kgPlanned"] for l in meat_lots_detail)
    total_meat_kg = float(batch.get("kg_produced") or 0)

    return {
        "seasoned": {
            "id": batch["id"],
            "batchNo": batch.get("batch_no") or "",
            "recipeName": batch.get("recipe_name") or "",
            "mixingOrderNo": batch.get("mixing_order_no") or "",
            "kgProduced": float(batch.get("kg_produced") or 0),
            "kgAvailable": float(batch.get("kg_available") or 0),
            "expiryDate": str(batch.get("expiry_date") or ""),
            "status": batch.get("status") or "",
            "sourceDeboning": batch.get("source_deboning_ids") or [],
        },
        "mixingOrder": mixing_order,
        "meatLots": meat_lots_detail,
        "summary": {
            "totalRawKg": round(total_raw_kg, 3),
            "totalMeatKg": round(total_meat_kg, 3),
            "meatLotCount": len(meat_lots_detail),
        },
    }


def split_seasoned_sessions(sessions, kg_used_total):
    """Czysta korekta: zlane sesje jednej partii (batch_no) → grupy
    per (recipe_id, dzień). Zużyte kg przypisane FEFO (najstarszy dzień
    pierwszy). Zwraca listę dict-ów posortowaną FEFO:
    {recipe_id, recipe_name, production_day, kg_produced, kg_used, kg_available}.

    sessions: [{recipe_id, recipe_name, day('YYYY-MM-DD'), kg_output}].
    """
    groups: dict = {}
    for s in sessions:
        key = (s["recipe_id"], s["day"])
        g = groups.setdefault(key, {
            "recipe_id": s["recipe_id"],
            "recipe_name": s["recipe_name"],
            "production_day": s["day"],
            "kg_produced": 0.0,
        })
        g["kg_produced"] += float(s["kg_output"] or 0)

    ordered = sorted(groups.values(), key=lambda g: (g["production_day"], g["recipe_id"]))
    remaining = float(kg_used_total or 0)
    for g in ordered:
        take = min(remaining, g["kg_produced"])
        g["kg_used"] = round(take, 3)
        g["kg_available"] = round(g["kg_produced"] - take, 3)
        g["kg_produced"] = round(g["kg_produced"], 3)
        remaining -= take
    return ordered


def reconcile_production_day(
    recipe_id: str,
    production_day: str,
    actual_kg: float,
    reason: str = "",
) -> Dict[str, Any]:
    """Zbiorcza korekta teoria↔fizyka dla WSZYSTKICH żywych partii jednej
    receptury z jednego dnia produkcji ("zamknięcie dnia"). Reużywa
    `_reconcile_row` per partia — patrz jej docstring dla mechaniki korekty
    pojedynczego wiersza.

    Różnica (`actual_kg` minus suma teoretycznych `kg_available`) trafia na
    partie w kolejności FEFO (`expiry_date`, potem `created_at` — najstarsza
    pierwsza): dodatnia w całości na najstarszą, ujemna rozkłada się po
    partiach, ile każda może oddać bez zejścia poniżej WŁASNEJ rezerwacji.
    Wstępna walidacja (`actual_kg >= suma rezerwacji`) gwarantuje matematycznie,
    że pętla rozłoży całą ujemną deltę bez wyjątków w trakcie.

    Brak żywych partii w grupie:
      * actual_kg > 0  → tworzy nową partię 'SC{n}' (pula ścinków z dnia,
        wchodzi do FEFO jak każda inna).
      * actual_kg == 0 → no-op.
    """
    actual_kg = round(float(actual_kg or 0), 3)
    if actual_kg < 0:
        raise HTTPException(400, "Waga nie może być ujemna")

    with transaction() as conn:
        rows = cx_query_all(
            conn,
            """
            SELECT * FROM seasoned_meat
            WHERE recipe_id = %s AND production_day = %s AND status != 'closed'
            ORDER BY expiry_date ASC NULLS LAST, created_at ASC
            FOR UPDATE
            """,
            (recipe_id, production_day),
        )

        theoretical = round(sum(float(r.get("kg_available") or 0) for r in rows), 3)
        reserved_total = round(sum(float(r.get("kg_reserved") or 0) for r in rows), 3)

        if actual_kg + 0.001 < reserved_total:
            raise HTTPException(
                400,
                f"W partiach tego dnia jest {reserved_total:.1f} kg zarezerwowane "
                f"pod plan — nie można zejść poniżej. Najpierw zwolnij/usuń "
                f"pozycje planu.",
            )

        if not rows:
            if actual_kg < 0.001:
                return {
                    "theoreticalKg": 0.0, "actualKg": 0.0,
                    "delta": 0.0, "affectedBatches": [],
                }
            recipe = cx_query_one(conn, "SELECT name FROM recipes WHERE id=%s", (recipe_id,))
            recipe_name = (recipe or {}).get("name", "")
            new_id = cuid()
            batch_no = scrap_pool_batch_no(next_seq("sc_seq"))
            expiry = (
                datetime.fromisoformat(production_day) + timedelta(days=5)
            ).date().isoformat()
            cx_execute(
                conn,
                """
                INSERT INTO seasoned_meat
                    (id, batch_no, recipe_id, recipe_name, kg_produced,
                     kg_available, kg_used, status, production_day, expiry_date,
                     reconciled_at, reconcile_reason, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,0,'available',%s,%s,%s,%s,%s)
                """,
                (new_id, batch_no, recipe_id, recipe_name, actual_kg,
                 actual_kg, production_day, expiry, now_iso(),
                 (reason or None), now_iso()),
            )
            create_stock_movement(
                conn, product_type="seasoned", batch_id=new_id,
                qty=actual_kg, movement_type="IN",
                source_type="reconcile", source_id=new_id,
            )
            logger.info(
                "seasoned.production_day_scrap_pool_created",
                extra={
                    "recipe_id": recipe_id, "production_day": production_day,
                    "batch_no": batch_no, "kg": actual_kg,
                },
            )
            return {
                "theoreticalKg": 0.0, "actualKg": actual_kg,
                "delta": actual_kg,
                "affectedBatches": [{"id": new_id, "batchNo": batch_no, "deltaApplied": actual_kg}],
            }

        delta = round(actual_kg - theoretical, 3)
        if abs(delta) < 0.001:
            raise HTTPException(400, "Brak zmiany wagi — podaj inną wartość.")

        affected: List[Dict[str, Any]] = []
        remaining = delta
        for row in rows:
            row_avail = float(row.get("kg_available") or 0)
            row_reserved = float(row.get("kg_reserved") or 0)
            if remaining >= 0:
                apply = remaining
            else:
                max_giveable = row_avail - row_reserved
                apply = max(remaining, -max_giveable)
            if abs(apply) < 0.0005:
                continue
            target = round(row_avail + apply, 3)
            applied = _reconcile_row(conn, row, target, reason)
            affected.append({
                "id": row["id"], "batchNo": row["batch_no"], "deltaApplied": applied,
            })
            remaining = round(remaining - apply, 3)
            if abs(remaining) < 0.0005:
                break

        logger.info(
            "seasoned.production_day_reconciled",
            extra={
                "recipe_id": recipe_id, "production_day": production_day,
                "theoretical_kg": theoretical, "actual_kg": actual_kg,
                "delta": delta, "reason": reason or "",
                "affected_count": len(affected),
            },
        )
        return {
            "theoreticalKg": theoretical,
            "actualKg": actual_kg,
            "delta": delta,
            "affectedBatches": affected,
        }


def _group_production_day_rows(rows: List[Dict[str, Any]], production_day: str) -> List[Dict[str, Any]]:
    """Czyste grupowanie wierszy seasoned_meat (dowolnego statusu) po
    recipe_id, dla widoku 'Zamknięcie dnia'. theoreticalKg sumuje TYLKO
    wiersze status != 'closed' (0, gdy wszystkie zamknięte — poprawny stan
    przy domykaniu dnia, nie błąd)."""
    groups: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        key = r["recipe_id"]
        g = groups.setdefault(key, {
            "recipeId": r["recipe_id"],
            "recipeName": r["recipe_name"],
            "productionDay": production_day,
            "theoreticalKg": 0.0,
            "batchCount": 0,
            "lastReconciledAt": None,
            "lastReconcileReason": None,
        })
        g["batchCount"] += 1
        if (r.get("status") or "") != "closed":
            g["theoreticalKg"] += float(r.get("kg_available") or 0)
        ra = r.get("reconciled_at")
        if ra and (g["lastReconciledAt"] is None or str(ra) > str(g["lastReconciledAt"])):
            g["lastReconciledAt"] = ra
            g["lastReconcileReason"] = r.get("reconcile_reason")
    for g in groups.values():
        g["theoreticalKg"] = round(g["theoreticalKg"], 3)
    return sorted(groups.values(), key=lambda g: g["recipeName"])


def list_production_days(production_day: str) -> List[Dict[str, Any]]:
    """DB wrapper nad `_group_production_day_rows` — patrz jej docstring."""
    rows = query_all(
        "SELECT recipe_id, recipe_name, status, kg_available, reconciled_at, reconcile_reason "
        "FROM seasoned_meat WHERE production_day = %s",
        (production_day,),
    )
    return _group_production_day_rows(rows, production_day)


def list_day_reconciliation_history(limit: int = 100) -> List[Dict[str, Any]]:
    """Historia korekt 'Zamknięcia dnia' i pojedynczych partii — czytana
    wprost z istniejącego rejestru `stock_movements` (source_type='reconcile'),
    bez żadnej nowej tabeli audytowej."""
    rows = query_all(
        """
        SELECT sm.qty, sm.movement_type, sm.created_at,
               s.batch_no, s.recipe_name, s.production_day, s.reconcile_reason
        FROM stock_movements sm
        JOIN seasoned_meat s ON s.id = sm.batch_id
        WHERE sm.source_type = 'reconcile' AND sm.product_type = 'seasoned'
        ORDER BY sm.created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    return [
        {
            "batchNo": r["batch_no"],
            "recipeName": r["recipe_name"],
            "productionDay": str(r["production_day"]),
            "movementType": r["movement_type"],
            # qty jest wartością bezwzględną — kierunek niesie movementType
            # (OUT jest w stock_movements zapisany jako ujemny, IN dodatni).
            "qty": abs(float(r["qty"])),
            "reason": r["reconcile_reason"] or "",
            "createdAt": str(r["created_at"]),
        }
        for r in rows
    ]
