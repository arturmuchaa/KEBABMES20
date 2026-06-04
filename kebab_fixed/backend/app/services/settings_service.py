"""Settings — app-wide klucz–wartość (jsonb).

Klucz `company` przechowuje dane firmy dla nagłówków wydruków.
"""
import json
from typing import Dict

from app.db import execute, query_one
from app.logging_config import get_logger
from app.models.settings import CompanySettings

logger = get_logger(__name__)

COMPANY_KEY = "company"


def _empty_company() -> Dict:
    return {
        "name": "", "nip": "", "regon": "", "address": "",
        "city": "", "postal_code": "", "phone": "", "email": "",
        "vet_number": "", "market_domestic": True, "market_eu": True, "load_place": "",
    }


def get_company() -> Dict:
    row = query_one("SELECT value FROM app_settings WHERE key = %s", (COMPANY_KEY,))
    if not row:
        return _empty_company()
    val = row["value"]
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except Exception:
            val = {}
    return {**_empty_company(), **(val or {})}


def save_company(dto: CompanySettings) -> Dict:
    payload = dto.model_dump()
    execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (%s, %s::jsonb, now())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        """,
        (COMPANY_KEY, json.dumps(payload)),
    )
    logger.info("settings.company.saved")
    return payload
