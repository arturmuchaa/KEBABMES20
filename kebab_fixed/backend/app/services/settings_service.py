"""Settings — app-wide klucz–wartość (jsonb).

Klucz `company` przechowuje dane firmy dla nagłówków wydruków.
"""
import json
from typing import Dict

from app.db import execute, query_one
from app.logging_config import get_logger
from app.models.settings import CompanySettings
from app.services.material_requirements_service import DEFAULT_YIELD_PCT

logger = get_logger(__name__)

COMPANY_KEY = "company"
YIELD_KEY = "deboning_yield_pct"


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


# ── Współczynnik wydajności rozbioru (planistyczny) ──────────────────────
def resolve_yield_pct(saved, historical_avg) -> float:
    """Czysty wybór: zapisany (jeśli w zakresie 0<pct<=100) > historyczny > 70%."""
    if saved is not None and 0 < float(saved) <= 100:
        return round(float(saved), 2)
    if historical_avg is not None and 0 < float(historical_avg) <= 100:
        return round(float(historical_avg), 2)
    return DEFAULT_YIELD_PCT


def _historical_yield_avg():
    row = query_one(
        """
        SELECT AVG(yield_pct) AS avg_yield
        FROM deboning_entries
        WHERE yield_pct > 0 AND yield_pct <= 100
        """
    )
    return float(row["avg_yield"]) if row and row.get("avg_yield") is not None else None


def get_deboning_yield_pct() -> float:
    row = query_one("SELECT value FROM app_settings WHERE key = %s", (YIELD_KEY,))
    saved = None
    if row:
        val = row["value"]
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                val = {}
        if isinstance(val, dict):
            saved = val.get("pct")
        else:
            saved = val
    return resolve_yield_pct(saved, _historical_yield_avg())


def save_deboning_yield_pct(pct: float) -> Dict:
    value = json.dumps({"pct": float(pct)})
    execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (%s, %s::jsonb, now())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        """,
        (YIELD_KEY, value),
    )
    logger.info("settings.deboning_yield.saved")
    return {"deboningYieldPct": get_deboning_yield_pct()}
