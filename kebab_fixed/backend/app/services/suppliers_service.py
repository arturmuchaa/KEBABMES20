from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.models.suppliers import SupplierCreate
from app.utils.ids import cuid, next_seq, now_iso

logger = get_logger(__name__)


def list_suppliers() -> List[Dict]:
    return query_all("SELECT * FROM suppliers WHERE active = true ORDER BY name")


def create_supplier(dto: SupplierCreate) -> Dict:
    seq = next_seq("supplier_seq")
    code = dto.code or f"D-{str(seq).zfill(3)}"
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO suppliers
                (id, code, name, nip, vet_number, contact_name,
                 phone, email, active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
            RETURNING *
            """,
            (
                cuid(),
                code,
                dto.name,
                dto.nip,
                dto.vet_number,
                dto.contact_name,
                dto.phone,
                dto.email,
                now_iso(),
            ),
        )
    logger.info("supplier.created", extra={"supplier_id": row["id"], "name": dto.name})
    return row


def update_supplier(supplier_id: str, dto: SupplierCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE suppliers
            SET name=%s, nip=%s, vet_number=%s,
                contact_name=%s, phone=%s, email=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.name,
                dto.nip,
                dto.vet_number,
                dto.contact_name,
                dto.phone,
                dto.email,
                supplier_id,
            ),
        )
    if not row:
        raise HTTPException(404, "Dostawca nie znaleziony")
    logger.info("supplier.updated", extra={"supplier_id": supplier_id})
    return row
