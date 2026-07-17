import re
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.models.clients import ClientCreate
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def list_clients() -> List[Dict]:
    return query_all("SELECT * FROM clients WHERE active = true ORDER BY name")


def _next_client_code() -> str:
    """Kolejny kod kontrahenta: K{n} po najwyższym istniejącym (K1..K5 → K6).
    Liczy ze wszystkich kodów — odporne na dryf licznika (jak u dostawców)."""
    rows = query_all("SELECT code FROM clients WHERE code IS NOT NULL")
    max_n = 0
    for r in rows:
        m = re.search(r"(\d+)", r.get("code") or "")
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"K{max_n + 1}"


def create_client(dto: ClientCreate) -> Dict:
    code = _next_client_code()
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO clients
                (id, code, name, display_name, nip, regon, address, city,
                 contact_name, phone, email, language, dest_name, dest_address, dest_city,
                 dest_for_hdi, dest_for_cmr, halal_supervision, active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
            RETURNING *
            """,
            (
                cuid(),
                code,
                dto.name,
                dto.display_name or None,
                dto.nip,
                dto.regon,
                dto.address,
                dto.city,
                dto.contact_name,
                dto.phone,
                dto.email,
                dto.language,
                dto.dest_name,
                dto.dest_address,
                dto.dest_city,
                bool(dto.dest_for_hdi),
                bool(dto.dest_for_cmr),
                bool(dto.halal_supervision),
                now_iso(),
            ),
        )
    logger.info("client.created", extra={"client_id": row["id"]})
    return row


def update_client(client_id: str, dto: ClientCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE clients
            SET name=%s, display_name=%s, nip=%s, regon=%s, address=%s, city=%s,
                contact_name=%s, phone=%s, email=%s,
                language=%s, dest_name=%s, dest_address=%s, dest_city=%s,
                dest_for_hdi=%s, dest_for_cmr=%s, halal_supervision=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.name,
                dto.display_name or None,
                dto.nip,
                dto.regon,
                dto.address,
                dto.city,
                dto.contact_name,
                dto.phone,
                dto.email,
                dto.language,
                dto.dest_name,
                dto.dest_address,
                dto.dest_city,
                bool(dto.dest_for_hdi),
                bool(dto.dest_for_cmr),
                bool(dto.halal_supervision),
                client_id,
            ),
        )
    if not row:
        raise HTTPException(404, "Klient nie znaleziony")
    logger.info("client.updated", extra={"client_id": client_id})
    return row


def deactivate_client(client_id: str) -> None:
    with transaction() as conn:
        cx_execute(conn, "UPDATE clients SET active=false WHERE id=%s", (client_id,))
    logger.info("client.deactivated", extra={"client_id": client_id})
