import re
from typing import Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, query_all, transaction
from app.logging_config import get_logger
from app.models.clients import ClientCreate
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


# Dozwolone tryby nazwy pozycji HDI (kartoteka odbiorcy). Nieznany tryb
# wraca do domyślnego, żeby literówka nie zostawiła dokumentu bez nazwy.
HDI_NAME_MODES = ("type_recipe", "type", "recipe")


def _hdi_name_mode(value: str) -> str:
    v = (value or "").strip()
    return v if v in HDI_NAME_MODES else "type_recipe"


def list_clients() -> List[Dict]:
    """Kartoteka odbiorców razem z własnymi nazwami receptur — ekran kartoteki
    edytuje je w formularzu klienta, więc muszą przyjść tym samym żądaniem."""
    return query_all(
        """
        SELECT c.*, COALESCE(
                   (SELECT jsonb_agg(jsonb_build_object('recipe_id', n.recipe_id,
                                                        'name', n.name)
                                     ORDER BY n.recipe_id)
                      FROM client_recipe_names n WHERE n.client_id = c.id),
                   '[]'::jsonb) AS hdi_recipe_names
          FROM clients c
         WHERE c.active = true
         ORDER BY c.name
        """)


def _save_recipe_names(conn, client_id: str, names) -> None:
    """Podmień komplet własnych nazw receptur odbiorcy (pusta nazwa = kasuj).

    Formularz kartoteki przysyła CAŁĄ listę, więc zapis jest podmianą —
    inaczej skasowana w UI nazwa zostawałaby w bazie i dalej schodziła
    na dokument.
    """
    cx_execute(conn, "DELETE FROM client_recipe_names WHERE client_id=%s", (client_id,))
    for n in names or []:
        rid = (getattr(n, "recipe_id", "") or "").strip()
        nazwa = (getattr(n, "name", "") or "").strip()
        if not rid or not nazwa:
            continue
        cx_execute(
            conn,
            "INSERT INTO client_recipe_names (client_id, recipe_id, name) VALUES (%s,%s,%s) "
            "ON CONFLICT (client_id, recipe_id) DO UPDATE SET name=EXCLUDED.name",
            (client_id, rid, nazwa))


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
                (id, code, name, display_name, nip, regon, address, postal_code, city,
                 contact_name, phone, email, language, dest_name, dest_address, dest_city,
                 dest_for_hdi, dest_for_cmr, halal_supervision, hdi_name_mode,
                 active, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
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
                dto.postal_code,
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
                _hdi_name_mode(dto.hdi_name_mode),
                now_iso(),
            ),
        )
        _save_recipe_names(conn, row["id"], dto.hdi_recipe_names)
    logger.info("client.created", extra={"client_id": row["id"]})
    return row


def update_client(client_id: str, dto: ClientCreate) -> Dict:
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            """
            UPDATE clients
            SET name=%s, display_name=%s, nip=%s, regon=%s, address=%s, postal_code=%s, city=%s,
                contact_name=%s, phone=%s, email=%s,
                language=%s, dest_name=%s, dest_address=%s, dest_city=%s,
                dest_for_hdi=%s, dest_for_cmr=%s, halal_supervision=%s,
                hdi_name_mode=%s
            WHERE id=%s
            RETURNING *
            """,
            (
                dto.name,
                dto.display_name or None,
                dto.nip,
                dto.regon,
                dto.address,
                dto.postal_code,
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
                _hdi_name_mode(dto.hdi_name_mode),
                client_id,
            ),
        )
        if row:
            _save_recipe_names(conn, client_id, dto.hdi_recipe_names)
    if not row:
        raise HTTPException(404, "Klient nie znaleziony")
    logger.info("client.updated", extra={"client_id": client_id})
    return row


def deactivate_client(client_id: str) -> None:
    with transaction() as conn:
        cx_execute(conn, "UPDATE clients SET active=false WHERE id=%s", (client_id,))
    logger.info("client.deactivated", extra={"client_id": client_id})
