"""Wydania (dispatches) — wydanie luzem sztuk + rozchód magazynu wyrobów."""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement
from app.utils.unit_codes import (
    SHIPPED, group_units_for_out, parse_unit_qr, validate_loose_dispatch,
)

logger = get_logger(__name__)


def create_dispatch(dto: Dict[str, Any]) -> Dict[str, Any]:
    did = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """INSERT INTO dispatches
                 (id, client_id, client_name, vehicle_id, cmr_requested, status, operator, created_at)
               VALUES (%s,%s,%s,%s,%s,'open',%s,%s)""",
            (did, dto.get("client_id") or None, dto.get("client_name") or "",
             dto.get("vehicle_id") or None, bool(dto.get("cmr_requested")),
             dto.get("operator") or "", now_iso()),
        )
    return {"id": did, "status": "open"}


def _batch_breakdown(conn, dispatch_id: str) -> List[Dict]:
    rows = cx_query_all(
        conn,
        """SELECT batch_no, COUNT(*) AS qty, SUM(weight_kg) AS kg
           FROM finished_units WHERE dispatch_id=%s
           GROUP BY batch_no ORDER BY batch_no""",
        (dispatch_id,),
    )
    return [{"batchNo": r["batch_no"] or "", "qty": int(r["qty"]),
             "weightKg": float(r["kg"] or 0)} for r in rows]


def scan_into_dispatch(dispatch_id: str, code: str) -> Dict[str, Any]:
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT * FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")
        unit = cx_query_one(conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,))
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")

        ok, reason = validate_loose_dispatch(unit, disp.get("client_name"))
        if not ok:
            qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
            return {"ok": False, "reason": reason, "qty": int(qty["c"] if qty else 0),
                    "batchBreakdown": _batch_breakdown(conn, dispatch_id)}

        cx_execute(conn, "UPDATE finished_units SET dispatch_id=%s WHERE id=%s", (dispatch_id, unit_id))
        qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
        return {"ok": True, "reason": "", "qty": int(qty["c"] if qty else 0),
                "batchBreakdown": _batch_breakdown(conn, dispatch_id)}


def remove_unit(dispatch_id: str, code: str) -> Dict[str, Any]:
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT status FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")
        cx_execute(conn, "UPDATE finished_units SET dispatch_id=NULL WHERE id=%s AND dispatch_id=%s",
                   (unit_id, dispatch_id))
        qty = cx_query_one(conn, "SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
        return {"ok": True, "qty": int(qty["c"] if qty else 0),
                "batchBreakdown": _batch_breakdown(conn, dispatch_id)}


def close_dispatch(dispatch_id: str) -> Dict[str, Any]:
    """Zamknięcie: rozchód finished_goods (OUT) + sztuki → shipped. Atomowo."""
    with transaction() as conn:
        disp = cx_query_one(conn, "SELECT * FROM dispatches WHERE id=%s FOR UPDATE", (dispatch_id,))
        if not disp:
            raise HTTPException(404, "Wydanie nie znalezione")
        if disp.get("status") != "open":
            raise HTTPException(409, "Wydanie zamknięte")

        units = cx_query_all(
            conn,
            """SELECT id, produced_date, batch_no, recipe_id, weight_kg
               FROM finished_units WHERE dispatch_id=%s""",
            (dispatch_id,),
        )
        if not units:
            raise HTTPException(400, "Brak sztuk na wydaniu")

        groups = group_units_for_out(units)
        for (produced_date, batch_no, recipe_id), g in groups.items():
            rows = cx_query_all(
                conn,
                """SELECT id, qty_available, kg_per_unit FROM finished_goods
                   WHERE produced_date=%s AND batch_no=%s AND recipe_id=%s
                   ORDER BY (COALESCE(client_name,'')='') DESC, qty_available DESC
                   FOR UPDATE""",
                (produced_date or None, batch_no, recipe_id),
            )
            remaining = g["count"]
            for row in rows:
                take = min(remaining, max(0, int(row.get("qty_available") or 0)))
                if take > 0:
                    cx_execute(
                        conn,
                        "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                        (take, take, row["id"]),
                    )
                    create_stock_movement(
                        conn, product_type="finished_goods", batch_id=row["id"],
                        qty=take * float(row.get("kg_per_unit") or 0),
                        movement_type="OUT", source_type="dispatch", source_id=dispatch_id,
                    )
                    remaining -= take
                if remaining == 0:
                    break
            if remaining > 0:
                raise HTTPException(
                    400, f"Za mało na stanie wyrobów dla partii {batch_no} (brakuje {remaining} szt)")

        cx_execute(conn, "UPDATE finished_units SET status=%s WHERE dispatch_id=%s", (SHIPPED, dispatch_id))
        cx_execute(conn, "UPDATE dispatches SET status='shipped', shipped_at=%s WHERE id=%s",
                   (now_iso(), dispatch_id))
        logger.info("dispatch.closed", extra={"dispatch_id": dispatch_id, "units": len(units)})
        return {"id": dispatch_id, "status": "shipped", "units": len(units)}


def dispatch_detail(dispatch_id: str) -> Dict[str, Any]:
    disp = query_one("SELECT * FROM dispatches WHERE id=%s", (dispatch_id,))
    if not disp:
        raise HTTPException(404, "Wydanie nie znalezione")
    qty = query_one("SELECT COUNT(*) AS c FROM finished_units WHERE dispatch_id=%s", (dispatch_id,))
    disp["qty"] = int(qty["c"] if qty else 0)
    with transaction() as conn:
        disp["batch_breakdown"] = _batch_breakdown(conn, dispatch_id)
    return disp


def list_open_dispatches() -> List[Dict]:
    return query_all(
        """SELECT d.id, d.client_name, d.vehicle_id, d.cmr_requested, d.created_at,
                  (SELECT COUNT(*) FROM finished_units fu WHERE fu.dispatch_id=d.id) AS qty
           FROM dispatches d WHERE d.status='open'
           ORDER BY d.created_at DESC""",
    )


def dispatch_batch_breakdown(dispatch_id: str) -> List[Dict]:
    with transaction() as conn:
        return _batch_breakdown(conn, dispatch_id)
