"""CRUD kont biura (app_users) + bootstrap konta admin."""
from __future__ import annotations

import secrets

from fastapi import HTTPException, status

from app.config import settings
from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.models.auth import AppUserCreate, AppUserUpdate
from app.utils.ids import cuid, now_iso
from app.utils.passwords import hash_secret

logger = get_logger(__name__)


def _public(u: dict) -> dict:
    return {"id": u["id"], "login": u["login"], "role": u["role"],
            "display_name": u["display_name"], "active": u["active"],
            "must_change_password": u["must_change_password"]}


def list_users() -> list:
    return [_public(u) for u in query_all("SELECT * FROM app_users ORDER BY login")]


def create_user(dto: AppUserCreate) -> dict:
    if query_one("SELECT 1 FROM app_users WHERE login=%s", (dto.login,)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Login zajęty")
    if len(dto.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Hasło min. 8 znaków")
    uid = cuid()
    execute(
        "INSERT INTO app_users (id, login, password_hash, role, display_name, active, "
        "must_change_password, failed_attempts, created_at) "
        "VALUES (%s,%s,%s,%s,%s,true,false,0,%s)",
        (uid, dto.login, hash_secret(dto.password), dto.role, dto.display_name, now_iso()),
    )
    return _public(query_one("SELECT * FROM app_users WHERE id=%s", (uid,)))


def update_user(uid: str, dto: AppUserUpdate) -> dict:
    u = query_one("SELECT * FROM app_users WHERE id=%s", (uid,))
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nie ma takiego konta")
    if dto.display_name is not None:
        execute("UPDATE app_users SET display_name=%s WHERE id=%s", (dto.display_name, uid))
    if dto.role is not None:
        execute("UPDATE app_users SET role=%s WHERE id=%s", (dto.role, uid))
    if dto.active is not None:
        execute("UPDATE app_users SET active=%s WHERE id=%s", (dto.active, uid))
    if dto.new_password is not None:
        if len(dto.new_password) < 8:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Hasło min. 8 znaków")
        execute("UPDATE app_users SET password_hash=%s, must_change_password=true WHERE id=%s",
                (hash_secret(dto.new_password), uid))
    return _public(query_one("SELECT * FROM app_users WHERE id=%s", (uid,)))


def ensure_bootstrap_admin() -> None:
    """Tworzy konto admin jeśli brak jakiegokolwiek admina."""
    if query_one("SELECT 1 FROM app_users WHERE role='admin'"):
        return
    login = settings.admin_login or "admin"
    password = settings.admin_password
    must_change = False
    if not password:
        password = secrets.token_urlsafe(12)
        must_change = True
        logger.warning("auth.bootstrap.random_password",
                       extra={"login": login, "hint": "ustaw ADMIN_PASSWORD w .env"})
        print(f"[BOOTSTRAP] konto admin: login={login} haslo={password} (ZMIEN po zalogowaniu)")
    execute(
        "INSERT INTO app_users (id, login, password_hash, role, display_name, active, "
        "must_change_password, failed_attempts, created_at) "
        "VALUES (%s,%s,%s,'admin','Administrator',true,%s,0,%s)",
        (cuid(), login, hash_secret(password), must_change, now_iso()),
    )
    logger.info("auth.bootstrap.admin_created", extra={"login": login})
