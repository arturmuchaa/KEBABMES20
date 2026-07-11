import re
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.models.suppliers import SupplierCreate
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def list_suppliers() -> List[Dict]:
    return query_all("SELECT * FROM suppliers WHERE active = true ORDER BY name")


def _next_supplier_code() -> str:
    """Kolejny kod dostawcy: D{n} kontynuujący po najwyższym istniejącym numerze
    (D1, D2 → D3). Liczy ze WSZYSTKICH kodów (też nieaktywnych), żeby nie
    powielać numeru. Zastępuje rozjechany licznik + niespójny format „D-001"."""
    rows = query_all("SELECT code FROM suppliers WHERE code IS NOT NULL")
    max_n = 0
    for r in rows:
        m = re.search(r"(\d+)", r.get("code") or "")
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"D{max_n + 1}"


def create_supplier(dto: SupplierCreate) -> Dict:
    code = dto.code or _next_supplier_code()
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO suppliers
                (id, code, name, display_name, nip, regon, vet_number, contact_name,
                 phone, email, address, city, postal_code, active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
            RETURNING *
            """,
            (
                cuid(),
                code,
                dto.name,
                dto.display_name,
                dto.nip,
                dto.regon,
                dto.vet_number,
                dto.contact_name,
                dto.phone,
                dto.email,
                dto.address,
                dto.city,
                dto.postal_code,
                now_iso(),
            ),
        )
    logger.info("supplier.created", extra={"supplier_id": row["id"], "supplier_name": dto.name})
    return row


def update_supplier(supplier_id: str, dto: SupplierCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE suppliers
            SET name=%s, display_name=%s, nip=%s, regon=%s, vet_number=%s,
                contact_name=%s, phone=%s, email=%s,
                address=%s, city=%s, postal_code=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.name,
                dto.display_name,
                dto.nip,
                dto.regon,
                dto.vet_number,
                dto.contact_name,
                dto.phone,
                dto.email,
                dto.address,
                dto.city,
                dto.postal_code,
                supplier_id,
            ),
        )
    if not row:
        raise HTTPException(404, "Dostawca nie znaleziony")
    logger.info("supplier.updated", extra={"supplier_id": supplier_id})
    return row


def delete_supplier(supplier_id: str) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE suppliers SET active=false WHERE id=%s RETURNING *",
            (supplier_id,),
        )
    if not row:
        raise HTTPException(404, "Dostawca nie znaleziony")
    logger.info("supplier.deleted", extra={"supplier_id": supplier_id})
    return {"ok": True, "id": supplier_id}
