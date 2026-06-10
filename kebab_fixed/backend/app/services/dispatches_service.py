"""Wydania (dispatches) — wydanie luzem sztuk + rozchód magazynu wyrobów."""
from datetime import date
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.settings_service import get_company
from app.services.wz_service import _insert_wz, _seller_block, build_goods_wz_lines
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement
from app.utils.unit_codes import (
    SHIPPED, group_units_by_goods, parse_unit_qr, validate_loose_dispatch,
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
            """SELECT id, weight_kg, source_finished_goods_id
               FROM finished_units WHERE dispatch_id=%s""",
            (dispatch_id,),
        )
        if not units:
            raise HTTPException(400, "Brak sztuk na wydaniu")

        # Twardy link sztuka → wyrób gotowy (source_finished_goods_id, nadawany
        # przy zamknięciu dnia). Dopasowanie po stringu partii zabronione:
        # sztuka nosi partię mięsa ("353"), wyrób partię kebaba ("100626 353").
        groups, unlinked = group_units_by_goods(units)
        if unlinked:
            raise HTTPException(
                400,
                f"{len(unlinked)} szt na wydaniu nie ma powiązania z wyrobem gotowym "
                "(dzień produkcji niezamknięty?). Zatwierdź produkcję w biurze "
                "(plan → Potwierdź), a potem zamknij wydanie.")

        # Zbierz i zablokuj wyroby w deterministycznej kolejności (anty-deadlock),
        # sprawdź stany PRZED wystawieniem WZ.
        goods_with_counts: List[Dict[str, Any]] = []
        for gid in sorted(groups):
            fg = cx_query_one(
                conn,
                """SELECT id, batch_no, recipe_id, recipe_name, product_type_name,
                          qty_available, kg_per_unit
                   FROM finished_goods WHERE id=%s FOR UPDATE""",
                (gid,))
            if not fg:
                raise HTTPException(400, f"Wyrób gotowy powiązany ze sztukami nie istnieje ({gid})")
            need = int(groups[gid]["count"])
            avail = int(fg.get("qty_available") or 0)
            if avail < need:
                raise HTTPException(
                    400,
                    f"Za mało na stanie wyrobów (partia {fg.get('batch_no')}): "
                    f"jest {avail} szt, wydanie wymaga {need}")
            goods_with_counts.append({"goods": fg, "count": need})

        buyer: Dict[str, Any] = {"name": disp.get("client_name") or "", "address": "", "nip": ""}
        if disp.get("client_id"):
            cli = cx_query_one(conn, "SELECT name, address, city, nip FROM clients WHERE id=%s",
                               (disp["client_id"],))
            if cli:
                buyer = {"name": cli.get("name") or buyer["name"],
                         "address": f"{cli.get('address') or ''} {cli.get('city') or ''}".strip(),
                         "nip": cli.get("nip") or ""}

        existing_wz = cx_query_one(
            conn, "SELECT id, number FROM wz_documents WHERE source_type='dispatch' AND source_id=%s "
                  "ORDER BY created_at LIMIT 1", (dispatch_id,))
        if existing_wz:
            wid, wz_number = existing_wz["id"], existing_wz["number"]
        else:
            issued = date.today().isoformat()
            wid = _insert_wz(
                conn, source_type="dispatch", source_id=dispatch_id, seller=_seller_block(),
                buyer=buyer, valued=False, lines=build_goods_wz_lines(goods_with_counts),
                total=0.0, place=get_company().get("city") or "", issued=issued,
                released=issued, notes="")
            wz_number = cx_query_one(conn, "SELECT number FROM wz_documents WHERE id=%s", (wid,))["number"]

        # Rozchód dokładnie z wyrobów, z których pochodzą sztuki (wiersze już
        # zablokowane FOR UPDATE i zwalidowane wyżej).
        for g in goods_with_counts:
            fg, take = g["goods"], g["count"]
            cx_execute(
                conn,
                "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                (take, take, fg["id"]),
            )
            create_stock_movement(
                conn, product_type="finished_goods", batch_id=fg["id"],
                qty=take * float(fg.get("kg_per_unit") or 0),
                movement_type="OUT", source_type="wz", source_id=wid,
            )

        cx_execute(conn, "UPDATE finished_units SET status=%s WHERE dispatch_id=%s", (SHIPPED, dispatch_id))
        cx_execute(conn, "UPDATE dispatches SET status='shipped', shipped_at=%s WHERE id=%s",
                   (now_iso(), dispatch_id))
        logger.info("dispatch.closed", extra={"dispatch_id": dispatch_id, "units": len(units), "wz_id": wid})
        return {"id": dispatch_id, "status": "shipped", "units": len(units),
                "wzId": wid, "wzNumber": wz_number}


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
