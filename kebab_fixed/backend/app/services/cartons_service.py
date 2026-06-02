"""cartons — tworzenie kartonu, skan sztuki do kartonu (walidacja), zamknięcie."""
from typing import Any, Dict

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.unit_codes import PACKED, parse_unit_qr, validate_pack

logger = get_logger(__name__)


def create_carton(dto: Dict[str, Any]) -> Dict[str, Any]:
    cid = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """
            INSERT INTO cartons
                (id, order_id, client_name, product_type_id, recipe_id, tuleja,
                 target_qty, target_weight_kg, packed_qty, status, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,0,'open',%s)
            """,
            (
                cid,
                dto.get("order_id"),
                dto.get("client_name") or "",
                dto.get("product_type_id") or "",
                dto.get("recipe_id") or "",
                dto.get("tuleja") or "",
                int(dto.get("target_qty") or 0),
                float(dto.get("target_weight_kg") or 0),
                now_iso(),
            ),
        )
    return {"id": cid, "status": "open"}


def scan_into_carton(carton_id: str, code: str) -> Dict[str, Any]:
    """Skan sztuki do kartonu: walidacja SKU/klient/produced/dubel/limit."""
    unit_id = parse_unit_qr(code)
    if not unit_id:
        raise HTTPException(400, "Nieprawidłowy kod QR sztuki")
    with transaction() as conn:
        carton = cx_query_one(
            conn, "SELECT * FROM cartons WHERE id=%s FOR UPDATE", (carton_id,)
        )
        if not carton:
            raise HTTPException(404, "Karton nie znaleziony")
        unit = cx_query_one(
            conn, "SELECT * FROM finished_units WHERE id=%s FOR UPDATE", (unit_id,)
        )
        if not unit:
            raise HTTPException(404, "Sztuka nie znaleziona")

        ok, reason = validate_pack(unit, carton)
        if not ok:
            return {"ok": False, "reason": reason,
                    "packedQty": int(carton.get("packed_qty") or 0),
                    "targetQty": int(carton.get("target_qty") or 0)}

        cx_execute(
            conn,
            "UPDATE finished_units SET status=%s, carton_id=%s WHERE id=%s",
            (PACKED, carton_id, unit_id),
        )
        new_packed = int(carton.get("packed_qty") or 0) + 1
        new_status = "full" if new_packed >= int(carton.get("target_qty") or 0) else "open"
        closed = now_iso() if new_status == "full" else None
        cx_execute(
            conn,
            "UPDATE cartons SET packed_qty=%s, status=%s, closed_at=%s WHERE id=%s",
            (new_packed, new_status, closed, carton_id),
        )
        return {"ok": True, "reason": "", "packedQty": new_packed,
                "targetQty": int(carton.get("target_qty") or 0), "cartonStatus": new_status}
