"""Whole pallet of backs/bones weighed for information (hall request 2026-11-06).

Per-worker takes already put their backs and bones on stock (byproduct lots +
movements at settlement). Workers then stack them on one pallet; weighing that
pallet only records the figure for the warehouse and prints a pallet label.
It NEVER writes a stock movement or touches stock: doing so would receive the
same kilograms twice.
"""
import json

from fastapi import HTTPException

from app.db import transaction, cx_query_one, cx_query_all, cx_execute, query_all
from app.models.deboning_settlement import ByproductPalletCheck


def _map(row):
    return {
        "id": row["id"], "kind": row["kind"], "kgNet": float(row["kg_net"]),
        "kgGross": float(row["kg_gross"]) if row["kg_gross"] is not None else None,
        "tareKg": float(row["tare_kg"]) if row["tare_kg"] is not None else None,
        "tareLabel": row["tare_label"], "e2Count": row["e2_count"],
        "tareE2Kg": float(row["tare_e2_kg"]) if row["tare_e2_kg"] is not None else None,
        "weighMode": row["weigh_mode"], "reason": row["reason"],
        "batches": row["batches"], "workersKg": float(row["workers_kg"] or 0),
        "weighedBy": row["weighed_by"], "weighedAt": row["weighed_at"].isoformat(),
    }


def _workers_kg(conn, kind, batch_ids):
    """Backs/bones these batches put on stock through per-worker takes (for comparison)."""
    row = cx_query_one(conn, """SELECT COALESCE(SUM(l.kg),0) AS kg FROM byproduct_lots l
        JOIN deboning_entries e ON e.id = l.deboning_entry_id
        WHERE l.kind=%s AND l.raw_batch_id = ANY(%s) AND e.settlement_stage='done'""", (kind, batch_ids))
    return float(row["kg"] or 0)


def create(dto: ByproductPalletCheck, subject=""):
    payload = dto.model_dump(mode="json")
    ids = list(dict.fromkeys(dto.raw_batch_ids))
    with transaction() as conn:
        existing = cx_query_one(conn, "SELECT * FROM byproduct_pallet_checks WHERE id=%s", (dto.request_id,))
        if existing:  # response lost — the retry returns the same record, never a second one
            if existing["original_payload"] != payload:
                raise HTTPException(409, "Identyfikator ważenia został już użyty z innymi danymi")
            return _map(existing)
        rows = cx_query_all(conn, "SELECT id, internal_batch_no, expiry_date FROM raw_batches WHERE id = ANY(%s)", (ids,))
        if len(rows) != len(ids):
            raise HTTPException(404, "Nie znaleziono wybranej partii")
        order = {bid: i for i, bid in enumerate(ids)}
        batches = [{"rawBatchId": r["id"], "rawBatchNo": r["internal_batch_no"],
                    "expiryDate": str(r["expiry_date"])[:10] if r.get("expiry_date") else None}
                   for r in sorted(rows, key=lambda r: order[r["id"]])]
        workers = _workers_kg(conn, dto.kind, ids)
        cx_execute(conn, """INSERT INTO byproduct_pallet_checks
            (id, kind, kg_net, kg_gross, tare_kg, tare_label, tare_e2_kg, e2_count, weigh_mode, reason,
             batches, workers_kg, weighed_by, original_payload)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (dto.request_id, dto.kind, dto.kg_net, dto.kg_gross, dto.tare_kg, dto.tare_label.strip(),
             dto.tare_e2_kg, dto.e2_count, dto.weigh_mode, dto.reason.strip(), json.dumps(batches),
             workers, subject or "kiosk", json.dumps(payload)))
        row = cx_query_one(conn, "SELECT * FROM byproduct_pallet_checks WHERE id=%s", (dto.request_id,))
    return _map(row)


def recent(days=7):
    days = max(1, min(int(days or 7), 90))
    rows = query_all("""SELECT * FROM byproduct_pallet_checks
        WHERE weighed_at >= now() - make_interval(days => %s) ORDER BY weighed_at DESC LIMIT 200""", (days,))
    return [_map(r) for r in rows]
