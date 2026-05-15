"""Vehicles (samochody do załadunku)."""
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.models.vehicles import VehicleCreate, VehicleUpdate
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def list_vehicles(include_inactive: bool = False) -> List[Dict]:
    if include_inactive:
        sql = "SELECT * FROM vehicles ORDER BY sort_order, name"
    else:
        sql = "SELECT * FROM vehicles WHERE active = true ORDER BY sort_order, name"
    return query_all(sql)


def create_vehicle(dto: VehicleCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO vehicles
                (id, name, plate, kind, vehicle_type, sort_order, notes, active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,true,%s)
            RETURNING *
            """,
            (
                cuid(),
                dto.name,
                dto.plate,
                dto.kind,
                dto.vehicle_type,
                dto.sort_order,
                dto.notes,
                now_iso(),
            ),
        )
    logger.info("vehicle.created", extra={"vehicle_id": row["id"], "name": dto.name})
    return row


def update_vehicle(vehicle_id: str, dto: VehicleUpdate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE vehicles
            SET name=%s, plate=%s, kind=%s, vehicle_type=%s,
                sort_order=%s, notes=%s, active=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.name,
                dto.plate,
                dto.kind,
                dto.vehicle_type,
                dto.sort_order,
                dto.notes,
                dto.active,
                vehicle_id,
            ),
        )
    if not row:
        raise HTTPException(404, "Samochód nie znaleziony")
    return row


def delete_vehicle(vehicle_id: str) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE vehicles SET active=false WHERE id=%s RETURNING *",
            (vehicle_id,),
        )
    if not row:
        raise HTTPException(404, "Samochód nie znaleziony")
    return {"ok": True, "id": vehicle_id}
