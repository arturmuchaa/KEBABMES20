from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.models.carriers import CarrierCreate
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

_COLS = ("name", "address", "postal_code", "city", "country", "nip",
         "vat_eu", "default_plate", "phone", "notes")


def list_carriers() -> List[Dict]:
    return query_all("SELECT * FROM carriers WHERE active = true ORDER BY name")


def create_carrier(dto: CarrierCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """INSERT INTO carriers
               (id, name, address, postal_code, city, country, nip, vat_eu,
                default_plate, phone, notes, active, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s) RETURNING *""",
            (cuid(), dto.name, dto.address, dto.postal_code, dto.city, dto.country,
             dto.nip, dto.vat_eu, dto.default_plate, dto.phone, dto.notes, now_iso()),
        )
    logger.info("carrier.created", extra={"carrier_id": row["id"]})
    return row


def update_carrier(carrier_id: str, dto: CarrierCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """UPDATE carriers SET name=%s, address=%s, postal_code=%s, city=%s,
               country=%s, nip=%s, vat_eu=%s, default_plate=%s, phone=%s, notes=%s
               WHERE id=%s RETURNING *""",
            (dto.name, dto.address, dto.postal_code, dto.city, dto.country, dto.nip,
             dto.vat_eu, dto.default_plate, dto.phone, dto.notes, carrier_id),
        )
    if not row:
        raise HTTPException(404, "Przewoźnik nie znaleziony")
    logger.info("carrier.updated", extra={"carrier_id": carrier_id})
    return row


def deactivate_carrier(carrier_id: str) -> None:
    with transaction() as conn:
        cx_execute(conn, "UPDATE carriers SET active=false WHERE id=%s", (carrier_id,))
    logger.info("carrier.deactivated", extra={"carrier_id": carrier_id})
