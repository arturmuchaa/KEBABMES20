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
from app.utils.batch_numbers import combined_batch_no
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
