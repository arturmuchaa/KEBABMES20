"""Centralized configuration loaded from environment.

Loads .env from (in order):
1. /opt/kebab/config/.env  (production VPS)
2. ../backend/.env         (development, relative to app/)
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent  # .../backend

# Production layout: /opt/kebab/config/.env
# Development layout: backend/.env
_PROD_ENV = Path("/opt/kebab/config/.env")
if _PROD_ENV.is_file():
    load_dotenv(_PROD_ENV)
else:
    load_dotenv(ROOT_DIR / ".env")


def _split_csv(value: str) -> List[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _resolve_dist_dir() -> Path:
    """Find the frontend dist directory.

    Production: /opt/kebab/app/dist
    Development: backend/../dist
    """
    prod_dist = Path("/opt/kebab/app/dist")
    if prod_dist.is_dir():
        return prod_dist
    return ROOT_DIR.parent / "dist"


def _resolve_desktop_updates_dir() -> Path:
    prod_dir = Path("/opt/kebab/app/desktop-updates")
    if prod_dir.parent.is_dir():
        return prod_dir
    return ROOT_DIR.parent / "desktop-updates"


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

    dist_dir: Path = field(default_factory=_resolve_dist_dir)
    desktop_updates_dir: Path = field(default_factory=_resolve_desktop_updates_dir)
    app_version: str = "3.0.0"

    vies_api_id: str = os.environ.get("VIES_API_ID", "")
    vies_api_key: str = os.environ.get("VIES_API_KEY", "")

    # Klucz API dataport.pl (lookup GUS po NIP). Wymagany — ustaw w
    # /opt/kebab/config/.env. Pusty = endpoint GUS zwróci 503.
    dataport_api_key: str = os.environ.get("DATAPORT_API_KEY", "")

    # Adres, pod którym backend sam siebie widzi (do renderowania PDF przez
    # headless Chrome). Domyślnie wyprowadzony z BIND (np. 127.0.0.1:8010).
    self_base_url: str = os.environ.get(
        "SELF_BASE_URL",
        "http://" + os.environ.get("BIND", "127.0.0.1:8000"),
    )

    # Token przesyłany w nagłówku X-Admin-Token na endpointach /api/admin/*.
    # Pusty = soft-mode (pozwala, ale loguje warning na każdym wywołaniu).
    # Ustaw w /opt/kebab/config/.env żeby wymusić hard-fail bez tokenu.
    admin_token: str = os.environ.get("ADMIN_TOKEN", "")

    admin_login: str = os.environ.get("ADMIN_LOGIN", "")
    admin_password: str = os.environ.get("ADMIN_PASSWORD", "")


settings = Settings()
