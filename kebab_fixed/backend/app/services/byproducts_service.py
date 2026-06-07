"""Produkty uboczne rozbioru (ABP) — loty kości/grzbietów/inne + utylizacja.

Domyka identyfikowalność „każdego kg": część niemięsna ćwiartki (remainder)
przestaje być dead-endem — staje się śledzonym lotem z przeznaczeniem
(utylizacja / kat. 3 wg Reg. (WE) 1069/2009). Bilans: kg_meat + Σ(loty ABP)
= kg_quarter.
"""
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

KIND_LABELS = {"bones": "Kości", "backs": "Grzbiety", "other": "Inne (skóra/tłuszcz/ubytek)"}


def byproduct_breakdown(kg_bones, kg_backs, kg_remainder) -> List[Dict[str, Any]]:
    """Rozbij część niemięsną na loty ABP. remainder = kości + grzbiety + inne."""
    bones = max(0.0, float(kg_bones or 0))
    backs = max(0.0, float(kg_backs or 0))
    rem = max(0.0, float(kg_remainder or 0))
    other = round(rem - bones - backs, 3)
    lots: List[Dict[str, Any]] = []
    if bones > 0:
        lots.append({"kind": "bones", "kg": round(bones, 3)})
    if backs > 0:
        lots.append({"kind": "backs", "kg": round(backs, 3)})
    if other > 0.0005:
        lots.append({"kind": "other", "kg": other})
    return lots


def create_byproduct_lots_for_entry(conn, entry: Dict[str, Any]) -> int:
    """Utwórz loty ABP dla wpisu rozbioru (w trwającej transakcji). Idempotentne."""
    existing = cx_query_all(
        conn,
        "SELECT id FROM byproduct_lots WHERE deboning_entry_id=%s",
        (entry["id"],),
    )
    if existing:
        return 0
    lots = byproduct_breakdown(
        entry.get("kg_bones"), entry.get("kg_backs"), entry.get("kg_remainder")
    )
    for lot in lots:
        cx_execute(
            conn,
            """
            INSERT INTO byproduct_lots
                (id, deboning_entry_id, raw_batch_id, raw_batch_no, kind, kg,
                 status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,'open',%s)
            """,
            (
                cuid(),
                entry["id"],
                entry.get("raw_batch_id"),
                entry.get("raw_batch_no"),
                lot["kind"],
                lot["kg"],
                now_iso(),
            ),
        )
    return len(lots)


def backfill_byproduct_lots() -> Dict[str, int]:
    """Wygeneruj loty ABP dla historycznych rozbiorów (idempotentne)."""
    with transaction() as conn:
        entries = cx_query_all(
            conn,
            """
            SELECT * FROM deboning_entries de
            WHERE NOT EXISTS (
                SELECT 1 FROM byproduct_lots b WHERE b.deboning_entry_id = de.id
            )
            """,
        )
        created = 0
        for e in entries:
            created += create_byproduct_lots_for_entry(conn, e)
    logger.info(
        "byproducts.backfill",
        extra={"created_lots": created, "entries_count": len(entries)},
    )
    return {"created_lots": created, "entries_checked": len(entries)}


def list_byproducts(status: Optional[str] = None) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM byproduct_lots"
    params: tuple = ()
    if status in ("open", "disposed"):
        sql += " WHERE status=%s"
        params = (status,)
    sql += " ORDER BY created_at DESC"
    rows = query_all(sql, params)
    for r in rows:
        r["kind_label"] = KIND_LABELS.get(r.get("kind"), r.get("kind"))
    return rows


def dispose_byproduct(lot_id: str, destination: str, doc_ref: str = "") -> Dict[str, Any]:
    """Zarejestruj utylizację/przeznaczenie lotu ABP."""
    dest = (destination or "").strip()
    if not dest:
        raise HTTPException(400, "Podaj przeznaczenie/utylizację (destination)")
    with transaction() as conn:
        lot = cx_query_all(
            conn, "SELECT id FROM byproduct_lots WHERE id=%s", (lot_id,)
        )
        if not lot:
            raise HTTPException(404, "Lot ABP nie istnieje")
        cx_execute(
            conn,
            """
            UPDATE byproduct_lots
            SET destination=%s, doc_ref=%s, status='disposed', disposed_at=%s
            WHERE id=%s
            """,
            (dest, (doc_ref or "").strip(), now_iso(), lot_id),
        )
    logger.info("byproducts.disposed", extra={"lot_id": lot_id, "destination": dest})
    return query_one("SELECT * FROM byproduct_lots WHERE id=%s", (lot_id,))


def byproducts_for_raw_batch(raw_batch_id: str) -> List[Dict[str, Any]]:
    """Loty ABP danej partii surowca — do dołączenia w recall/forward trace."""
    rows = query_all(
        "SELECT * FROM byproduct_lots WHERE raw_batch_id=%s ORDER BY created_at",
        (raw_batch_id,),
    )
    for r in rows:
        r["kind_label"] = KIND_LABELS.get(r.get("kind"), r.get("kind"))
    return rows


def open_byproducts_summary() -> Dict[str, Any]:
    """Otwarte (nieutylizowane) loty ABP — do lineage_health."""
    row = query_one(
        """
        SELECT count(*) AS open_count,
               COALESCE(round(sum(kg)::numeric, 3), 0) AS open_kg
        FROM byproduct_lots WHERE status='open'
        """
    ) or {}
    return {
        "open_count": int(row.get("open_count") or 0),
        "open_kg": float(row.get("open_kg") or 0),
    }
