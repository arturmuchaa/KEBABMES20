"""Uwierzytelnianie: użytkownicy biura, operatorzy (workers), sesje."""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.lockout import is_locked, register_failure
from app.db import execute, query_all, query_one
from app.utils.ids import cuid, now_iso
from app.utils.passwords import hash_secret, verify_secret


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _create_session(subject_type: str, subject_id: str, label: str) -> str:
    token = _new_token()
    ts = now_iso()
    execute(
        "INSERT INTO sessions (token, subject_type, subject_id, label, created_at, last_seen) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (token, subject_type, subject_id, label, ts, ts),
    )
    return token


def _record_failure(table: str, row_id: str, attempts: int) -> None:
    new_attempts, locked_until = register_failure(attempts, _now())
    execute(
        f"UPDATE {table} SET failed_attempts=%s, locked_until=%s WHERE id=%s",
        (new_attempts, locked_until, row_id),
    )


def _reset_failures(table: str, row_id: str) -> None:
    execute(f"UPDATE {table} SET failed_attempts=0, locked_until=NULL WHERE id=%s", (row_id,))


def _deny():
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nieprawidłowe dane logowania")


# ── Logowanie biura ──
def login_office(login: str, password: str, label: str = "") -> dict:
    u = query_one("SELECT * FROM app_users WHERE login=%s", (login,))
    if not u or not u["active"]:
        _deny()
    if is_locked(u.get("locked_until"), _now()):
        raise HTTPException(status.HTTP_423_LOCKED, "Konto tymczasowo zablokowane")
    if not verify_secret(password, u["password_hash"]):
        _record_failure("app_users", u["id"], u["failed_attempts"])
        _deny()
    _reset_failures("app_users", u["id"])
    token = _create_session("office", u["id"], label)
    return {"token": token, "user": _office_public(u)}


# ── Logowanie operatora ──
def list_operators(department: str) -> list:
    rows = query_all("SELECT id, name, departments FROM workers WHERE active = true ORDER BY name")
    out = []
    for r in rows:
        depts = r.get("departments") or []
        if isinstance(depts, str):
            depts = json.loads(depts)
        if department in depts:
            out.append({"id": r["id"], "name": r["name"]})
    return out


def login_pin(worker_id: str, pin: str, label: str = "") -> dict:
    w = query_one("SELECT * FROM workers WHERE id=%s", (worker_id,))
    if not w or not w["active"]:
        _deny()
    if is_locked(w.get("locked_until"), _now()):
        raise HTTPException(status.HTTP_423_LOCKED, "Konto tymczasowo zablokowane")
    if not w.get("pin_hash") or not verify_secret(pin, w["pin_hash"]):
        _record_failure("workers", w["id"], w.get("failed_attempts") or 0)
        _deny()
    _reset_failures("workers", w["id"])
    token = _create_session("operator", w["id"], label)
    return {"token": token, "user": _operator_public(w)}


# ── Sesja → podmiot ──
def resolve_session(token: str) -> dict | None:
    s = query_one("SELECT * FROM sessions WHERE token=%s", (token,))
    if not s:
        return None
    execute("UPDATE sessions SET last_seen=%s WHERE token=%s", (now_iso(), token))
    if s["subject_type"] == "office":
        u = query_one("SELECT * FROM app_users WHERE id=%s", (s["subject_id"],))
        if not u or not u["active"]:
            return None
        return _office_public(u)
    w = query_one("SELECT * FROM workers WHERE id=%s", (s["subject_id"],))
    if not w or not w["active"]:
        return None
    return _operator_public(w)


def logout(token: str) -> None:
    execute("DELETE FROM sessions WHERE token=%s", (token,))


def change_password(subject: dict, old: str, new: str) -> None:
    if subject.get("kind") != "office":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tylko konta biura")
    u = query_one("SELECT * FROM app_users WHERE id=%s", (subject["id"],))
    if not u or not verify_secret(old, u["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Błędne aktualne hasło")
    if len(new) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Hasło min. 8 znaków")
    execute(
        "UPDATE app_users SET password_hash=%s, must_change_password=false WHERE id=%s",
        (hash_secret(new), u["id"]),
    )


def _office_public(u: dict) -> dict:
    return {
        "kind": "office", "id": u["id"], "name": u.get("display_name") or u["login"],
        "login": u["login"], "role": u["role"], "departments": [],
        "must_change_password": bool(u.get("must_change_password")),
    }


def _operator_public(w: dict) -> dict:
    depts = w.get("departments") or []
    if isinstance(depts, str):
        depts = json.loads(depts)
    return {"kind": "operator", "id": w["id"], "name": w["name"],
            "role": None, "departments": depts, "must_change_password": False}
