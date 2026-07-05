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
    # Manifesty/pobieranie aktualizacji desktopowych (Tauri updater) — klient
    # sprawdza/pobiera anonimowo, nie ma żadnego tokenu sesji. Publikacja
    # (/api/admin/desktop-updates/...) ma WŁASNY, osobny gate (require_admin /
    # nagłówek X-Admin-Token) — "public" tu oznacza tylko "pomiń system
    # Bearer/działów z tej warstwy", NIE "bez żadnej ochrony". Potwierdzone na
    # produkcji: oba te prefiksy dostawały 401 z tej warstwy PRZED dotarciem
    # do require_admin, więc auto-update (główna appka i kiosk rozbioru v10)
    # nigdy nie mógł zadziałać.
    "/api/desktop-updates",
    "/api/admin/desktop-updates",
)

# Endpointy dostępne każdemu zalogowanemu
ANY_PREFIXES = (
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/change-password",
    # Wspólne odczyty hali — używane przez kilka działów naraz (rozbiór,
    # mieszanie, produkcja), więc nie da się ich przypisać do jednego działu
    # przez sam prefiks ścieżki (np. production-sessions rozróżnia proces
    # dopiero po ?processType=, którego permission_for_path nie widzi).
    # Baza danych: 404/2xx per rekord to za mało uprawnień, więc nadal
    # wymagane jest bycie zalogowanym (nie "public").
    "/api/raw-batches",
    "/api/workers",
    "/api/production-sessions",
)

# Tylko admin (konta biura)
ADMIN_PREFIXES = ("/api/app-users", "/api/audit-log")

# Działy hali → prefiksy
DEPARTMENT_PREFIXES = {
    "rozbior": ("/api/deboning",),
    "produkcja": ("/api/mixing", "/api/seasoned_meat"),
    "pakowanie": ("/api/packaging", "/api/finished_units"),
    "wydanie": ("/api/dispatches",),
}


def _matches(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def permission_for_path(path: str, method: str = "GET") -> str:
    for p in PUBLIC_PREFIXES:
        if _matches(path, p):
            return "public"
    for p in ANY_PREFIXES:
        if _matches(path, p):
            return "any"
    for p in ADMIN_PREFIXES:
        if _matches(path, p):
            return "admin"
    # Karton magazynowy: skan/odczyt = hala (pakowanie); tworzenie i ręczne dodanie
    # sztuk z magazynu = biuro (office ma nadzbiór, więc i tak ma dostęp do skanu).
    if path.startswith("/api/stock-cartons"):
        if method == "POST" and path == "/api/stock-cartons":
            return "office"
        if path.endswith("/add") and "/lines/" in path:
            return "office"
        return "pakowanie"
    # Palety: pakowanie sztuk = hala; skan na wyjazd / mroźnia = wydanie.
    if path.startswith("/api/pallets"):
        if path == "/api/pallets/scan" or path == "/api/pallets/in-cold-storage":
            return "wydanie"
        return "pakowanie"
    # Tary wózków rozbioru (ważenie RS232): panel hali tylko czyta listę,
    # edycja wyłącznie z biura (strona Ustawienia firmy).
    if _matches(path, "/api/deboning/cart-tares"):
        return "rozbior" if method == "GET" else "office"
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
