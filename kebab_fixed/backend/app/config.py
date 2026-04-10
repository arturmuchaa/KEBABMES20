"""Centralized configuration loaded from environment."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def _split_csv(value: str) -> List[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/kebab_mes",
    )
    db_pool_min: int = int(os.environ.get("DB_POOL_MIN", "2"))
    db_pool_max: int = int(os.environ.get("DB_POOL_MAX", "20"))
    db_statement_timeout_ms: int = int(os.environ.get("DB_STATEMENT_TIMEOUT_MS", "30000"))

    cors_origins: List[str] = field(
        default_factory=lambda: _split_csv(os.environ.get("CORS_ORIGINS", "*"))
    )

    log_level: str = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_json: bool = os.environ.get("LOG_JSON", "false").lower() in ("1", "true", "yes")

    dist_dir: Path = ROOT_DIR.parent / "dist"
    app_version: str = "2.0.0"

    vies_api_id: str = os.environ.get("VIES_API_ID", "")
    vies_api_key: str = os.environ.get("VIES_API_KEY", "")


settings = Settings()
