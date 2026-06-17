"""FastAPI application factory.

Creates the app, registers routes, configures CORS, and serves the
SPA frontend from ``../dist`` when the build directory exists.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import close_pool, init_pool
from app.logging_config import configure_logging, get_logger
from app.migrations import run_migrations
from app.utils.ids import now_iso

logger = get_logger(__name__)


def cors_is_wildcard(origins: list[str]) -> bool:
    """True jeśli konfiguracja CORS dopuszcza dowolny origin ("*")."""
    return "*" in origins


# ── Lifespan (startup + shutdown) ─────────────────────────────────────

@asynccontextmanager
async def _lifespan(app: FastAPI):
    configure_logging()
    logger.info("app.startup", extra={"version": settings.app_version})
    init_pool()
    run_migrations()
    from app.services.app_users_service import ensure_bootstrap_admin
    ensure_bootstrap_admin()
    yield
    logger.info("app.shutdown")
    close_pool()


# ── Build the FastAPI instance ────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="Kebab MES API",
        version=settings.app_version,
        lifespan=_lifespan,
    )

    # CORS
    # Aplikacja nie używa uwierzytelniania cookie/sesją, więc allow_credentials
    # musi być False — inaczej w połączeniu z origin="*" przeglądarka i tak
    # odrzuca żądania (spec CORS), a włączone credentials niepotrzebnie
    # rozszerzałoby powierzchnię ataku. Klient desktop (Tauri) korzysta z
    # nagłówków bez credentials, więc to bezpieczne.
    if cors_is_wildcard(settings.cors_origins):
        logger.warning(
            "cors.wildcard_origin",
            extra={"hint": "Ustaw CORS_ORIGINS na konkretne domeny w produkcji"},
        )
    _cors_credentials = settings.cors_origins != ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=_cors_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.auth.middleware import auth_middleware
    from app.auth.audit import audit_middleware
    # Kolejność: audit rejestrowane po auth → jest „na zewnątrz", więc po
    # await call_next subject (ustawiony przez auth) jest już dostępny.
    app.middleware("http")(auth_middleware)
    app.middleware("http")(audit_middleware)

    # ── Register route modules ────────────────────────────────────
    from app.routes import (  # noqa: E402
        app_users,
        audit,
        auth,
        health,
        suppliers,
        clients,
        carriers,
        raw_batches,
        meat_stock,
        ingredients,
        packaging,
        orders,
        pallets,
        dispatches,
        production_plans,
        recipes,
        seasoned_meat,
        mixing,
        finished_goods,
        finished_units,
        label_templates,
        labels_zebra,
        hdi,
        cmr,
        invoices,
        workers,
        product_types,
        production_sessions,
        deboning,
        machine_locks,
        vies,
        traceability,
        vehicles,
        day_closures,
        stubs,
        cost,
        desktop_updates,
        byproducts,
        wz,
    )
    # Aliasujemy: app.routes.settings koliduje z app.config.settings używanym wyżej
    from app.routes import settings as settings_route  # noqa: E402

    for mod in (
        app_users,
        auth,
        health,
        suppliers,
        clients,
        carriers,
        raw_batches,
        meat_stock,
        ingredients,
        packaging,
        orders,
        pallets,
        dispatches,
        production_plans,
        recipes,
        seasoned_meat,
        mixing,
        finished_goods,
        finished_units,
        label_templates,
        labels_zebra,
        hdi,
        cmr,
        invoices,
        workers,
        product_types,
        production_sessions,
        deboning,
        machine_locks,
        vies,
        vies.gus_router,
        audit,
        traceability,
        vehicles,
        day_closures,
        stubs,
        cost,
        desktop_updates,
        byproducts,
        wz,
        settings_route,
    ):
        app.include_router(getattr(mod, "router", mod))

    # ── Root + SPA fallback ───────────────────────────────────────
    _dist = str(settings.dist_dir)

    @app.get("/api/health-full")
    def health_full():
        from app.db import healthcheck
        db_ok = healthcheck()
        return {
            "status": "ok" if db_ok else "degraded",
            "database": "connected" if db_ok else "error",
            "time": now_iso(),
            "version": settings.app_version,
        }

    @app.get("/", include_in_schema=False)
    def root():
        index = os.path.join(_dist, "index.html")
        if os.path.isfile(index):
            return FileResponse(
                index,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        return HTMLResponse("<h1>Kebab MES API</h1>")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        ico_path = os.path.join(_dist, "favicon.ico")
        if os.path.isfile(ico_path):
            return FileResponse(ico_path)
        from fastapi.responses import Response
        return Response(content=b"", media_type="image/x-icon")

    # Mount static assets if dist exists
    if os.path.isdir(os.path.join(_dist, "assets")):
        app.mount(
            "/assets",
            StaticFiles(directory=os.path.join(_dist, "assets")),
            name="assets",
        )

    # SPA catch-all (must be last)
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        file_path = os.path.join(_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index = os.path.join(_dist, "index.html")
        if os.path.isfile(index):
            return FileResponse(
                index,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        return HTMLResponse("<h1>Kebab MES API</h1>", status_code=404)

    return app


app = create_app()
