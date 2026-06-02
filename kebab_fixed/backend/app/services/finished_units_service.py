"""finished_units — generacja z planu, skan produkcyjny, lookup."""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, next_seq, now_iso
from app.utils.unit_codes import next_produced_status, parse_unit_qr, unit_qr

logger = get_logger(__name__)


def generate_units_from_plan_line(plan_line_id: str) -> Dict[str, Any]:
    """Tworzy `qty` rekordów finished_units (status 'planned') dla linii planu.

    Idempotentne per linia: jeśli sztuki już istnieją, zwraca istniejące.
    """
    with transaction() as conn:
        line = cx_query_one(
            conn,
            "SELECT * FROM production_plan_lines WHERE id=%s",
            (plan_line_id,),
        )
        if not line:
            raise HTTPException(404, "Linia planu nie znaleziona")

        existing = cx_query_all(
            conn,
            "SELECT id FROM finished_units WHERE plan_line_id=%s",
            (plan_line_id,),
        )
        if existing:
            return {"planLineId": plan_line_id, "created": 0, "existing": len(existing)}

        qty = int(line.get("qty") or 0)
        if qty <= 0:
            raise HTTPException(400, "Linia planu ma qty <= 0")

        seasoned = line.get("seasoned_batch_nos") or []
        batch_no = seasoned[0] if seasoned else ""
        created = 0
        for _ in range(qty):
            uid = cuid()
            seq = next_seq("unit_seq")
            cx_execute(
                conn,
                """
                INSERT INTO finished_units
                    (id, qr_code, qr_seq, plan_line_id, order_id, client_name,
                     product_type_id, recipe_id, tuleja, weight_kg, batch_no,
                     produced_date, status, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'planned',%s)
                """,
                (
                    uid,
                    unit_qr(uid),
                    seq,
                    plan_line_id,
                    line.get("client_order_line_id"),
                    line.get("client_name") or "",
                    line.get("product_type_id") or "",
                    line.get("recipe_id") or "",
                    line.get("tuleja") or "",
                    float(line.get("kg_per_unit") or 0),
                    batch_no,
                    line.get("produced_date") or "",
                    now_iso(),
                ),
            )
            created += 1

        logger.info("finished_units.generated", extra={"plan_line_id": plan_line_id, "created": created})
        return {"planLineId": plan_line_id, "created": created, "existing": 0}


def scan_produced(code: str, trolley_id: str | None = None) -> Dict[str, Any]:
    """Skan produkcyjny: planned → produced (+ wózek). Dubel → 409."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")

    with transaction() as conn:
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")
        try:
            new_status = next_produced_status(unit["status"])
        except ValueError as exc:
            raise HTTPException(409, str(exc))

        cx_execute(
            conn,
            """
            UPDATE finished_units
            SET status=%s, produced_at=now(), trolley_id=%s
            WHERE id=%s
            """,
            (new_status, trolley_id, unit_id),
        )

        counts = cx_query_one(
            conn,
            """
            SELECT count(*) FILTER (WHERE status <> 'planned') AS done,
                   count(*) AS total
            FROM finished_units WHERE plan_line_id=%s
            """,
            (unit.get("plan_line_id"),),
        )
        return {
            "ok": True,
            "unitId": unit_id,
            "status": new_status,
            "clientName": unit.get("client_name") or "",
            "batchNo": unit.get("batch_no") or "",
            "weightKg": float(unit.get("weight_kg") or 0),
            "done": int((counts or {}).get("done") or 0),
            "total": int((counts or {}).get("total") or 0),
        }


def lookup_unit(code: str) -> Dict[str, Any]:
    """Pełna karta sztuki po QR (identyfikacja w dowolnym momencie)."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    unit = query_one("SELECT * FROM finished_units WHERE id=%s", (unit_id,))
    if not unit:
        raise HTTPException(404, "Sztuka nie znaleziona")
    return {
        "id": unit["id"],
        "qrCode": unit["qr_code"],
        "status": unit["status"],
        "clientName": unit.get("client_name") or "",
        "productTypeId": unit.get("product_type_id") or "",
        "recipeId": unit.get("recipe_id") or "",
        "tuleja": unit.get("tuleja") or "",
        "weightKg": float(unit.get("weight_kg") or 0),
        "batchNo": unit.get("batch_no") or "",
        "trolleyId": unit.get("trolley_id"),
        "cartonId": unit.get("carton_id"),
        "producedAt": str(unit.get("produced_at") or ""),
    }
