"""Mapa prefiks URL → wymagane uprawnienie + sprawdzenie dostępu.

Zwracane uprawnienia:
  "public" — bez logowania
  "any"    — dowolny zalogowany
  "admin"  — tylko konto biura roli admin
  "office" — konto biura (admin lub office)
  <slug>   — operator z tym działem LUB biuro
"""
from __future__ import annotations

from typing import Optional

# Prefiksy publiczne (bez sesji)
PUBLIC_PREFIXES = (
    "/api/auth/login",
    "/api/auth/login-pin",
    "/api/auth/operators",
    "/api/health",
)

# Endpointy dostępne każdemu zalogowanemu
ANY_PREFIXES = (
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/change-password",
)

# Tylko admin (konta biura)
ADMIN_PREFIXES = ("/api/app-users", "/api/audit-log")

# Działy hali → prefiksy
DEPARTMENT_PREFIXES = {
    "rozbior": ("/api/deboning",),
    "produkcja": ("/api/mixing", "/api/production_sessions", "/api/seasoned_meat"),
    "pakowanie": ("/api/packaging", "/api/finished_units"),
    "wydanie": ("/api/dispatches",),
}


def _matches(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def permission_for_path(path: str) -> str:
    for p in PUBLIC_PREFIXES:
        if _matches(path, p):
            return "public"
    for p in ANY_PREFIXES:
        if _matches(path, p):
            return "any"
    for p in ADMIN_PREFIXES:
        if _matches(path, p):
            return "admin"
    for dept, prefixes in DEPARTMENT_PREFIXES.items():
        for p in prefixes:
            if _matches(path, p):
                return dept
    return "office"  # default-deny: wymaga co najmniej biura


def can_access(subject: Optional[dict], required: str) -> bool:
    if required == "public":
        return True
    if subject is None:
        return False
    if required == "any":
        return True

    kind = subject.get("kind")
    role = subject.get("role")
    if kind == "office":
        if role == "admin":
            return True
        # office: wszystko poza kontami biura
        return required != "admin"

    # operator
    if required in DEPARTMENT_PREFIXES:
        return required in (subject.get("departments") or [])
    return False
