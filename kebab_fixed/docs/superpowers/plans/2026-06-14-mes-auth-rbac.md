# Logowanie i konta z rolami w MES — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realne uwierzytelnianie i kontrola dostępu: biuro (login+hasło, pełny dostęp) i operatorzy hali (wybór nazwiska + PIN, dostęp tylko do swoich działów).

**Architecture:** Wariant 1 ze spec: sesje w bazie (`sessions`), operatorzy reużywają `workers` (+`departments`,`pin_hash`), biuro w nowej `app_users`. Egzekwowanie jednym middleware HTTP mapującym prefiks URL → wymagane uprawnienie (default-deny). Logika czysta (hash, mapa uprawnień, blokada, token wydruku) wydzielona do testowalnych modułów; I/O DB cienkie.

**Tech Stack:** FastAPI + psycopg2 (backend), bcrypt, React + react-router + fetch (`src/lib/api.ts`), Playwright (e2e w CI).

**Spec:** `docs/superpowers/specs/2026-06-14-mes-auth-rbac-design.md`

---

## Struktura plików

Backend (nowe):
- `app/utils/passwords.py` — hash/verify hasła i PIN (bcrypt). Czyste.
- `app/auth/__init__.py`
- `app/auth/lockout.py` — czysta logika blokady po błędnych próbach.
- `app/auth/permissions.py` — mapa prefiks→uprawnienie + `can_access`. Czyste.
- `app/auth/render_token.py` — krótkożyciowy token renderowania PDF. Czyste.
- `app/auth/middleware.py` — middleware HTTP egzekwujący dostęp.
- `app/services/auth_service.py` — I/O DB: użytkownicy, sesje, operatorzy.
- `app/services/app_users_service.py` — CRUD kont biura.
- `app/models/auth.py` — DTO logowania/kont.
- `app/routes/auth.py`, `app/routes/app_users.py` — endpointy.
- testy: `tests/test_passwords.py`, `tests/test_lockout.py`, `tests/test_permissions.py`, `tests/test_render_token.py`.

Backend (modyfikacje):
- `app/migrations.py` — DDL: kolumny `workers`, tabele `app_users`, `sessions`.
- `app/main.py` — rejestracja middleware + bootstrap admina w lifespan.
- `app/services/workers_service.py`, `app/models/workers.py` — `departments` + hash PIN.
- `app/services/pdf_render.py` — dołączanie tokenu renderowania.
- `requirements_pg.txt` — `bcrypt`.

Frontend (nowe):
- `src/features/auth/AuthContext.tsx` — kontekst sesji + akcje.
- `src/features/auth/guards.tsx` — `RequireOffice`, `RequireDepartment`.
- `src/features/auth/storage.ts` — token w localStorage.
- `src/pages/auth/LoginPage.tsx` — logowanie biura.
- `src/pages/auth/ChangePasswordPage.tsx` — wymuszona zmiana hasła.
- `src/pages/auth/PanelLoginPage.tsx` — logowanie operatora (dział→nazwisko→PIN).
- `src/pages/office/UsersPage.tsx` — zarządzanie kontami biura.

Frontend (modyfikacje):
- `src/lib/api.ts` — token w `req()` + obsługa 401.
- `src/main.tsx` — `AuthProvider`.
- `src/App.tsx` — trasy `/login`, `/panel`, guardy na layoutach.
- `src/layouts/OfficeLayout.tsx`, `src/layouts/OfficeSidebar.tsx`, `src/layouts/TabletLayout.tsx` — user w nagłówku, wylogowanie, ukrycie menu.
- `src/pages/office/WorkersPage.tsx` — działy + PIN operatora.

Deploy / e2e:
- `deploy/.env.example`, `deploy/docker-compose.yml` — `ADMIN_LOGIN`/`ADMIN_PASSWORD`.
- `e2e/auth.spec.ts` — logowanie biura, operator, guardy, menu.

---

## Task 1: bcrypt + hashowanie haseł i PIN (czyste, TDD)

**Files:**
- Modify: `backend/requirements_pg.txt`
- Create: `backend/app/utils/passwords.py`
- Test: `backend/tests/test_passwords.py`

- [ ] **Step 1: Dodaj zależność**

W `backend/requirements_pg.txt` dopisz linię:
```
bcrypt>=4.1.0
```
Zainstaluj: `cd backend && pip install -r requirements_dev.txt`

- [ ] **Step 2: Test (failing)**

`backend/tests/test_passwords.py`:
```python
from app.utils.passwords import hash_secret, verify_secret


def test_hash_is_not_plaintext():
    h = hash_secret("tajne123")
    assert h != "tajne123"
    assert h.startswith("$2")  # bcrypt


def test_verify_true_for_correct():
    h = hash_secret("1234")
    assert verify_secret("1234", h) is True


def test_verify_false_for_wrong():
    h = hash_secret("1234")
    assert verify_secret("0000", h) is False


def test_verify_false_for_empty_hash():
    assert verify_secret("1234", "") is False
```

- [ ] **Step 3: Run (fails)**

Run: `cd backend && python -m pytest tests/test_passwords.py -q`
Expected: FAIL (ModuleNotFoundError: app.utils.passwords)

- [ ] **Step 4: Implementacja**

`backend/app/utils/passwords.py`:
```python
"""Hashowanie sekretów (hasła biura, PIN-y operatorów) — bcrypt."""
from __future__ import annotations

import bcrypt


def hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_secret(secret: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(secret.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False
```

- [ ] **Step 5: Run (passes)**

Run: `cd backend && python -m pytest tests/test_passwords.py -q`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**
```bash
git add backend/requirements_pg.txt backend/app/utils/passwords.py backend/tests/test_passwords.py
git commit -m "feat(auth): hashowanie haseł/PIN (bcrypt)"
```

---

## Task 2: Logika blokady po błędnych próbach (czyste, TDD)

**Files:**
- Create: `backend/app/auth/__init__.py` (pusty), `backend/app/auth/lockout.py`
- Test: `backend/tests/test_lockout.py`

- [ ] **Step 1: Test (failing)**

`backend/tests/test_lockout.py`:
```python
from datetime import datetime, timedelta, timezone

from app.auth.lockout import register_failure, is_locked, MAX_ATTEMPTS, LOCK_MINUTES


def _now():
    return datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc)


def test_below_threshold_not_locked():
    attempts, locked_until = register_failure(MAX_ATTEMPTS - 2, _now())
    assert attempts == MAX_ATTEMPTS - 1
    assert locked_until is None


def test_reaches_threshold_locks():
    attempts, locked_until = register_failure(MAX_ATTEMPTS - 1, _now())
    assert attempts == MAX_ATTEMPTS
    assert locked_until == _now() + timedelta(minutes=LOCK_MINUTES)


def test_is_locked_true_before_expiry():
    until = _now() + timedelta(minutes=5)
    assert is_locked(until, _now()) is True


def test_is_locked_false_after_expiry():
    until = _now() - timedelta(minutes=1)
    assert is_locked(until, _now()) is False


def test_is_locked_false_when_none():
    assert is_locked(None, _now()) is False
```

- [ ] **Step 2: Run (fails)**

Run: `cd backend && python -m pytest tests/test_lockout.py -q`
Expected: FAIL (ModuleNotFoundError: app.auth.lockout)

- [ ] **Step 3: Implementacja**

`backend/app/auth/__init__.py`: pusty plik.

`backend/app/auth/lockout.py`:
```python
"""Czysta logika blokady kont po błędnych próbach logowania."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Tuple

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15


def register_failure(
    current_attempts: int, now: datetime
) -> Tuple[int, Optional[datetime]]:
    """Zwraca (nowa_liczba_prob, locked_until|None) po nieudanej probie."""
    attempts = current_attempts + 1
    if attempts >= MAX_ATTEMPTS:
        return attempts, now + timedelta(minutes=LOCK_MINUTES)
    return attempts, None


def is_locked(locked_until: Optional[datetime], now: datetime) -> bool:
    return locked_until is not None and locked_until > now
```

- [ ] **Step 4: Run (passes)**

Run: `cd backend && python -m pytest tests/test_lockout.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**
```bash
git add backend/app/auth/__init__.py backend/app/auth/lockout.py backend/tests/test_lockout.py
git commit -m "feat(auth): logika blokady po blednych probach"
```

---

## Task 3: Mapa uprawnień prefiks→dostęp (czyste, TDD)

**Files:**
- Create: `backend/app/auth/permissions.py`
- Test: `backend/tests/test_permissions.py`

Model: `Subject` to dict `{"kind": "office"|"operator", "role": "admin"|"office"|None, "departments": [...]}`.
`permission_for_path(path)` zwraca jeden z: `"public"`, `"any"`, `"admin"`, `"office"`, lub slug działu.

- [ ] **Step 1: Test (failing)**

`backend/tests/test_permissions.py`:
```python
from app.auth.permissions import permission_for_path, can_access


def test_public_paths():
    assert permission_for_path("/api/auth/login") == "public"
    assert permission_for_path("/api/auth/operators") == "public"
    assert permission_for_path("/api/health") == "public"


def test_any_authenticated_paths():
    assert permission_for_path("/api/auth/me") == "any"
    assert permission_for_path("/api/auth/logout") == "any"


def test_department_paths():
    assert permission_for_path("/api/deboning/sessions") == "rozbior"
    assert permission_for_path("/api/mixing/orders") == "produkcja"
    assert permission_for_path("/api/packaging/items") == "pakowanie"
    assert permission_for_path("/api/dispatches/123") == "wydanie"


def test_admin_paths():
    assert permission_for_path("/api/app-users") == "admin"


def test_default_is_office():
    assert permission_for_path("/api/orders") == "office"
    assert permission_for_path("/api/wz/nowy") == "office"


def test_admin_can_access_everything():
    admin = {"kind": "office", "role": "admin", "departments": []}
    for perm in ("public", "any", "admin", "office", "rozbior"):
        assert can_access(admin, perm) is True


def test_office_access():
    office = {"kind": "office", "role": "office", "departments": []}
    assert can_access(office, "office") is True
    assert can_access(office, "rozbior") is True   # biuro widzi wszystko w aplikacji
    assert can_access(office, "any") is True
    assert can_access(office, "admin") is False     # konta biura tylko admin


def test_operator_access():
    op = {"kind": "operator", "role": None, "departments": ["rozbior"]}
    assert can_access(op, "rozbior") is True
    assert can_access(op, "pakowanie") is False
    assert can_access(op, "office") is False
    assert can_access(op, "admin") is False
    assert can_access(op, "any") is True


def test_public_always_accessible():
    assert can_access(None, "public") is True
```

- [ ] **Step 2: Run (fails)**

Run: `cd backend && python -m pytest tests/test_permissions.py -q`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implementacja**

`backend/app/auth/permissions.py`:
```python
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
ADMIN_PREFIXES = ("/api/app-users",)

# Działy hali → prefiksy
DEPARTMENT_PREFIXES = {
    "rozbior": ("/api/deboning",),
    "produkcja": ("/api/mixing", "/api/production_sessions", "/api/seasoned_meat"),
    "pakowanie": ("/api/packaging", "/api/finished_units"),
    "wydanie": ("/api/dispatches",),
}


def permission_for_path(path: str) -> str:
    for p in PUBLIC_PREFIXES:
        if path.startswith(p):
            return "public"
    for p in ANY_PREFIXES:
        if path.startswith(p):
            return "any"
    for p in ADMIN_PREFIXES:
        if path.startswith(p):
            return "admin"
    for dept, prefixes in DEPARTMENT_PREFIXES.items():
        for p in prefixes:
            if path.startswith(p):
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
```

- [ ] **Step 4: Run (passes)**

Run: `cd backend && python -m pytest tests/test_permissions.py -q`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**
```bash
git add backend/app/auth/permissions.py backend/tests/test_permissions.py
git commit -m "feat(auth): mapa uprawnien prefiks->dostep"
```

> **Uwaga przy implementacji:** zweryfikuj prefiksy względem realnych ścieżek w `app/routes/*`
> (część routów obsługuje i biuro, i halę). Jeśli któryś dział używa innego prefiksu —
> dopisz go do `DEPARTMENT_PREFIXES` i dodaj przypadek testowy.

---

## Task 4: Token renderowania PDF (czyste, TDD)

**Files:**
- Create: `backend/app/auth/render_token.py`
- Test: `backend/tests/test_render_token.py`

- [ ] **Step 1: Test (failing)**

`backend/tests/test_render_token.py`:
```python
import time
from app.auth.render_token import make_render_token, verify_render_token


def test_valid_token_verifies():
    t = make_render_token(secret="s3cret", ttl=60)
    assert verify_render_token(t, secret="s3cret") is True


def test_wrong_secret_fails():
    t = make_render_token(secret="s3cret", ttl=60)
    assert verify_render_token(t, secret="inne") is False


def test_expired_token_fails():
    t = make_render_token(secret="s3cret", ttl=-1)
    assert verify_render_token(t, secret="s3cret") is False


def test_garbage_fails():
    assert verify_render_token("nonsense", secret="s3cret") is False
```

- [ ] **Step 2: Run (fails)**

Run: `cd backend && python -m pytest tests/test_render_token.py -q`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implementacja**

`backend/app/auth/render_token.py`:
```python
"""Krótkożyciowy podpisany token do renderowania stron wydruku przez headless chrome."""
from __future__ import annotations

import hashlib
import hmac
import time


def make_render_token(secret: str, ttl: int = 60) -> str:
    exp = int(time.time()) + ttl
    sig = hmac.new(secret.encode(), str(exp).encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def verify_render_token(token: str, secret: str) -> bool:
    try:
        exp_str, sig = token.split(".", 1)
        exp = int(exp_str)
    except (ValueError, AttributeError):
        return False
    if exp < int(time.time()):
        return False
    expected = hmac.new(secret.encode(), exp_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)
```

- [ ] **Step 4: Run (passes)**

Run: `cd backend && python -m pytest tests/test_render_token.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add backend/app/auth/render_token.py backend/tests/test_render_token.py
git commit -m "feat(auth): token renderowania PDF"
```

---

## Task 5: Migracje — kolumny workers + tabele app_users i sessions

**Files:**
- Modify: `backend/app/migrations.py` (lista `_DDL`)

- [ ] **Step 1: Dodaj DDL**

W `backend/app/migrations.py` do listy `_DDL` (na końcu listy) dopisz:
```python
    # ── Auth: konta i sesje ──
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS departments JSONB DEFAULT '[]'",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS pin_hash TEXT",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP",
    """CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        login TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'office',
        display_name TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        failed_attempts INT NOT NULL DEFAULT 0,
        locked_until TIMESTAMP,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        label TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        expires_at TIMESTAMP
    )""",
```

- [ ] **Step 2: Zastosuj na lokalnej bazie (docker)**

Uruchom jednorazowy Postgres i wykonaj migracje:
```bash
docker run -d --name kebab-mig -e POSTGRES_PASSWORD=p -e POSTGRES_DB=kebab_mes -p 55432:5432 postgres:16-alpine
sleep 4
cd backend
DATABASE_URL=postgresql://postgres:p@localhost:55432/kebab_mes python -c "from app.db import init_pool; from app.migrations import run_migrations; init_pool(); run_migrations(); print('OK')"
```
Expected: log `migrations.done`, wydruk `OK`.

- [ ] **Step 3: Sprawdź tabele/kolumny**
```bash
docker exec kebab-mig psql -U postgres -d kebab_mes -c "\d app_users" -c "\d sessions" -c "\d workers"
```
Expected: `app_users`, `sessions` istnieją; `workers` ma `departments, pin_hash, failed_attempts, locked_until`.
Sprzątanie: `docker rm -f kebab-mig`

- [ ] **Step 4: Commit**
```bash
git add backend/app/migrations.py
git commit -m "feat(auth): migracje - app_users, sessions, kolumny workers"
```

---

## Task 6: Modele auth + serwis I/O (DB)

**Files:**
- Create: `backend/app/models/auth.py`, `backend/app/services/auth_service.py`

- [ ] **Step 1: Modele**

`backend/app/models/auth.py`:
```python
from typing import List, Optional
from pydantic import BaseModel


class LoginDto(BaseModel):
    login: str
    password: str


class LoginPinDto(BaseModel):
    worker_id: str
    pin: str
    label: str = ""


class ChangePasswordDto(BaseModel):
    old_password: str
    new_password: str


class AppUserCreate(BaseModel):
    login: str
    password: str
    role: str = "office"      # 'admin' | 'office'
    display_name: str = ""


class AppUserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    new_password: Optional[str] = None
```

- [ ] **Step 2: Serwis (I/O DB + logika logowania)**

`backend/app/services/auth_service.py`:
```python
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
```

- [ ] **Step 3: Commit**
```bash
git add backend/app/models/auth.py backend/app/services/auth_service.py
git commit -m "feat(auth): modele + serwis logowania/sesji"
```

---

## Task 7: Endpointy auth

**Files:**
- Create: `backend/app/routes/auth.py`

- [ ] **Step 1: Implementacja**

`backend/app/routes/auth.py`:
```python
"""Endpointy uwierzytelniania."""
from fastapi import APIRouter, Header, Query, Request

from app.models.auth import ChangePasswordDto, LoginDto, LoginPinDto
from app.services import auth_service as svc

router = APIRouter(tags=["auth"])


def _token(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    return ""


@router.post("/api/auth/login")
def login(dto: LoginDto):
    return svc.login_office(dto.login, dto.password)


@router.get("/api/auth/operators")
def operators(department: str = Query(...)):
    return svc.list_operators(department)


@router.post("/api/auth/login-pin")
def login_pin(dto: LoginPinDto):
    return svc.login_pin(dto.worker_id, dto.pin, dto.label)


@router.get("/api/auth/me")
def me(request: Request):
    # middleware już zweryfikował sesję i wstawił podmiot do request.state
    return getattr(request.state, "subject", None)


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    svc.logout(_token(authorization))
    return {"ok": True}


@router.post("/api/auth/change-password")
def change_password(dto: ChangePasswordDto, request: Request):
    svc.change_password(request.state.subject, dto.old_password, dto.new_password)
    return {"ok": True}
```

- [ ] **Step 2: Commit**
```bash
git add backend/app/routes/auth.py
git commit -m "feat(auth): endpointy login/login-pin/me/logout/change-password"
```

---

## Task 8: Middleware egzekwujący dostęp + rejestracja

**Files:**
- Create: `backend/app/auth/middleware.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Middleware**

`backend/app/auth/middleware.py`:
```python
"""Middleware HTTP: egzekwuje uprawnienia wg mapy prefiks→dostęp."""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.auth.permissions import can_access, permission_for_path
from app.auth.render_token import verify_render_token
from app.config import settings
from app.services import auth_service


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    return auth[7:] if auth.lower().startswith("bearer ") else ""


async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Tylko API podlega kontroli; SPA/asset/print przepuszczamy do routingu niżej
    if not path.startswith("/api/"):
        return await call_next(request)

    required = permission_for_path(path)
    request.state.subject = None

    if required == "public":
        return await call_next(request)

    # Token renderowania PDF (headless chrome) — dostęp do stron danych dla wydruku
    rtok = request.headers.get("x-render-token") or request.query_params.get("render_token")
    if rtok and verify_render_token(rtok, secret=settings.admin_token or "render"):
        return await call_next(request)

    subject = auth_service.resolve_session(_bearer(request))
    request.state.subject = subject

    if not can_access(subject, required):
        code = 401 if subject is None else 403
        return JSONResponse({"detail": "Brak dostępu"}, status_code=code)

    return await call_next(request)
```

- [ ] **Step 2: Zarejestruj w main.py**

W `backend/app/main.py`, w `create_app()` po `app.add_middleware(CORSMiddleware, ...)` dodaj:
```python
    from app.auth.middleware import auth_middleware
    app.middleware("http")(auth_middleware)
```

- [ ] **Step 3: Weryfikacja (docker + curl)**

Uruchom bazę + backend (osobny terminal), utwórz konto admin ręcznie i sprawdź:
```bash
# baza
docker run -d --name kebab-auth -e POSTGRES_PASSWORD=p -e POSTGRES_DB=kebab_mes -p 55432:5432 postgres:16-alpine
sleep 4
cd backend
export DATABASE_URL=postgresql://postgres:p@localhost:55432/kebab_mes ADMIN_LOGIN=admin ADMIN_PASSWORD=admin12345
uvicorn app.main:app --port 8009 &   # poczekaj na "Application startup complete"
sleep 4
# bez tokenu na endpoint biura → 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8009/api/orders      # 401
# login
TOKEN=$(curl -s -X POST http://localhost:8009/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin12345"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
# z tokenem → 200 (lub 404/200 zależnie od danych, NIE 401/403)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8009/api/orders -H "Authorization: Bearer $TOKEN"
```
Expected: pierwszy `401`, drugi inny niż 401/403. (Konto admin tworzy bootstrap z Task 9 — jeśli robisz Task 8 przed 9, utwórz użytkownika ręcznie przez `python -c` z `auth_service`/`app_users_service`.)
Sprzątanie: `kill %1; docker rm -f kebab-auth`

- [ ] **Step 4: Commit**
```bash
git add backend/app/auth/middleware.py backend/app/main.py
git commit -m "feat(auth): middleware egzekwujacy dostep (default-deny)"
```

---

## Task 9: Bootstrap admina + serwis kont biura + endpointy

**Files:**
- Create: `backend/app/services/app_users_service.py`, `backend/app/routes/app_users.py`
- Modify: `backend/app/main.py` (lifespan), `backend/app/config.py`

- [ ] **Step 1: Konfiguracja**

W `backend/app/config.py` w `Settings` dodaj pola:
```python
    admin_login: str = os.environ.get("ADMIN_LOGIN", "")
    admin_password: str = os.environ.get("ADMIN_PASSWORD", "")
```

- [ ] **Step 2: Serwis kont biura + bootstrap**

`backend/app/services/app_users_service.py`:
```python
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
```

- [ ] **Step 3: Wołaj bootstrap w lifespan**

W `backend/app/main.py` w `_lifespan`, po `run_migrations()` dodaj:
```python
    from app.services.app_users_service import ensure_bootstrap_admin
    ensure_bootstrap_admin()
```

- [ ] **Step 4: Endpointy kont biura**

`backend/app/routes/app_users.py`:
```python
"""Zarządzanie kontami biura (tylko admin — egzekwuje middleware)."""
from fastapi import APIRouter

from app.models.auth import AppUserCreate, AppUserUpdate
from app.services import app_users_service as svc

router = APIRouter(tags=["app-users"])


@router.get("/api/app-users")
def list_users():
    return svc.list_users()


@router.post("/api/app-users")
def create_user(dto: AppUserCreate):
    return svc.create_user(dto)


@router.put("/api/app-users/{uid}")
def update_user(uid: str, dto: AppUserUpdate):
    return svc.update_user(uid, dto)
```

- [ ] **Step 5: Weryfikacja**

Powtórz scenariusz z Task 8 Step 3 — teraz admin tworzy się sam (bootstrap z `ADMIN_LOGIN/ADMIN_PASSWORD`). Sprawdź dodatkowo:
```bash
curl -s http://localhost:8009/api/app-users -H "Authorization: Bearer $TOKEN" | head   # lista (admin)
```
Expected: JSON z kontem admin.

- [ ] **Step 6: Commit**
```bash
git add backend/app/services/app_users_service.py backend/app/routes/app_users.py backend/app/main.py backend/app/config.py
git commit -m "feat(auth): konta biura (CRUD) + bootstrap admina"
```

---

## Task 10: Operatorzy — działy + PIN w workers

**Files:**
- Modify: `backend/app/models/workers.py`, `backend/app/services/workers_service.py`

- [ ] **Step 1: Model**

W `backend/app/models/workers.py`:
- do `WorkerCreate` dodaj: `departments: List[str] = []`
- do `WorkerUpdate` dodaj: `departments: Optional[List[str]] = None`
(import `List` już jest.)

- [ ] **Step 2: Serwis — hash PIN + zapis działów**

W `backend/app/services/workers_service.py`:
- `import json` (jeśli brak) oraz `from app.utils.passwords import hash_secret`.
- W `create_worker`: jeśli `dto.pin` niepuste → policz `pin_hash = hash_secret(dto.pin)` i zapisz do kolumny `pin_hash`; zapisz `departments` jako `json.dumps(dto.departments)`. (Zostaw jawne `pin` puste/None — nie przechowuj jawnego PIN.)
- W `update_worker`: jeśli `dto.pin` podane i niepuste → ustaw `pin_hash=hash_secret(dto.pin)`; jeśli `dto.departments` podane → ustaw `departments=json.dumps(...)`.

Przykład fragmentu INSERT (dostosuj do istniejącej kolejności kolumn):
```python
    pin_hash = hash_secret(dto.pin) if dto.pin else None
    departments = json.dumps(dto.departments or [])
    # ... w INSERT dodaj kolumny pin_hash, departments z wartościami (pin_hash, departments)
```

- [ ] **Step 3: Weryfikacja**
```bash
# (backend z Task 9 działa, TOKEN admina ustawiony)
curl -s -X POST http://localhost:8009/api/workers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jan Kowalski","pin":"1234","departments":["rozbior"]}' | head
# operator widoczny na liście działu
curl -s "http://localhost:8009/api/auth/operators?department=rozbior" | head
# logowanie PIN
curl -s -X POST http://localhost:8009/api/auth/login-pin -H 'Content-Type: application/json' \
  -d "{\"worker_id\":\"<ID_Z_POWYZSZEGO>\",\"pin\":\"1234\"}" | head
```
Expected: operator na liście `rozbior`; login-pin zwraca `{token, user{departments:["rozbior"]}}`.

- [ ] **Step 4: Commit**
```bash
git add backend/app/models/workers.py backend/app/services/workers_service.py
git commit -m "feat(auth): operatorzy - dzialy + hash PIN w workers"
```

---

## Task 11: PDF render token w pdf_render

**Files:**
- Modify: `backend/app/services/pdf_render.py`

- [ ] **Step 1: Dołącz token do URL renderowanej strony**

W `backend/app/services/pdf_render.py`, w miejscu gdzie budowany jest URL strony do renderowania przez chrome, dołącz parametr `render_token`:
```python
from app.auth.render_token import make_render_token
from app.config import settings

def _with_render_token(url: str) -> str:
    tok = make_render_token(secret=settings.admin_token or "render", ttl=120)
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}render_token={tok}"
```
Użyj `_with_render_token(url)` przy przekazywaniu URL do polecenia chrome.

- [ ] **Step 2: Weryfikacja (manualna)**

Po pełnym wdrożeniu (gdy middleware aktywne) wygeneruj dowolny PDF (np. WZ) z UI zalogowany jako biuro — render musi się udać (chrome trafia na stronę z `render_token`, middleware go przepuszcza). Brak 401 w logach przy renderze.

- [ ] **Step 3: Commit**
```bash
git add backend/app/services/pdf_render.py
git commit -m "feat(auth): pdf_render dolacza token renderowania"
```

- [ ] **Step 4: Pełny zestaw testów backendu**

Run: `cd backend && python -m pytest -q`
Expected: wszystkie zielone (dotychczasowe 209 + nowe testy auth).

---

## Task 12: Front — token w api.ts + obsługa 401

**Files:**
- Create: `src/features/auth/storage.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Storage tokenu**

`src/features/auth/storage.ts`:
```ts
const TOKEN_KEY = 'kebab.token'
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}
export const KIOSK_DEPT_KEY = 'kebab.kiosk.department'
```

- [ ] **Step 2: Token + 401 w `req()`**

W `src/lib/api.ts` zmień funkcję `req()`:
```ts
import { tokenStore } from '@/features/auth/storage'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    tokenStore.clear()
    if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/panel')) {
      location.href = '/login'
    }
    throw new Error('Sesja wygasła')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const msg = err.detail || err.message || `HTTP ${res.status}`
    throw new Error(Array.isArray(msg) ? msg.map((e: any) => e.msg || e).join(', ') : String(msg))
  }
  return res.json()
}
```

- [ ] **Step 3: Weryfikacja**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 4: Commit**
```bash
git add src/features/auth/storage.ts src/lib/api.ts
git commit -m "feat(auth): front - token Bearer + obsluga 401"
```

---

## Task 13: Front — AuthContext + provider

**Files:**
- Create: `src/features/auth/AuthContext.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Kontekst**

`src/features/auth/AuthContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { tokenStore } from './storage'

export interface AuthUser {
  kind: 'office' | 'operator'
  id: string
  name: string
  role: 'admin' | 'office' | null
  departments: string[]
  must_change_password: boolean
}

interface AuthCtx {
  user: AuthUser | null
  loading: boolean
  loginOffice: (login: string, password: string) => Promise<AuthUser>
  loginPin: (workerId: string, pin: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as any)
const BASE = (import.meta as any).env?.VITE_API_URL || '/api'

async function call(path: string, opts: RequestInit = {}) {
  const token = tokenStore.get()
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(e.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return }
    try { setUser(await call('/auth/me')) }
    catch { tokenStore.clear(); setUser(null) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const loginOffice = async (login: string, password: string) => {
    const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) })
    tokenStore.set(r.token); setUser(r.user); return r.user as AuthUser
  }
  const loginPin = async (workerId: string, pin: string) => {
    const r = await call('/auth/login-pin', { method: 'POST', body: JSON.stringify({ worker_id: workerId, pin }) })
    tokenStore.set(r.token); setUser(r.user); return r.user as AuthUser
  }
  const logout = async () => {
    try { await call('/auth/logout', { method: 'POST' }) } catch {}
    tokenStore.clear(); setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, loginOffice, loginPin, logout, refresh }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
```

- [ ] **Step 2: Owijka w main.tsx**

W `src/main.tsx` zaimportuj i owiń `<App/>`:
```tsx
import { AuthProvider } from '@/features/auth/AuthContext'
// ...
<BrowserRouter>
  <AuthProvider>
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster richColors closeButton />
    </TooltipProvider>
  </AuthProvider>
</BrowserRouter>
```

- [ ] **Step 3: Weryfikacja**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 4: Commit**
```bash
git add src/features/auth/AuthContext.tsx src/main.tsx
git commit -m "feat(auth): front - AuthContext + provider"
```

---

## Task 14: Front — ekran logowania biura + zmiana hasła

**Files:**
- Create: `src/pages/auth/LoginPage.tsx`, `src/pages/auth/ChangePasswordPage.tsx`
- Modify: `src/App.tsx` (trasy `/login`, `/zmiana-hasla`)

- [ ] **Step 1: LoginPage**

`src/pages/auth/LoginPage.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'

export function LoginPage() {
  const { loginOffice } = useAuth()
  const nav = useNavigate()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    try {
      const u = await loginOffice(login, password)
      nav(u.must_change_password ? '/zmiana-hasla' : '/office/dashboard', { replace: true })
    } catch (e: any) { setErr(e.message || 'Błąd logowania') }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white p-8 rounded-xl shadow w-80 space-y-4">
        <h1 className="text-lg font-bold text-center">Kebab MES — biuro</h1>
        <input className="w-full border rounded px-3 py-2" placeholder="Login"
               value={login} onChange={e => setLogin(e.target.value)} autoFocus />
        <input className="w-full border rounded px-3 py-2" placeholder="Hasło" type="password"
               value={password} onChange={e => setPassword(e.target.value)} />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button className="w-full bg-blue-600 text-white rounded py-2 font-medium">Zaloguj</button>
        <a href="/panel" className="block text-center text-sm text-gray-500">Panel hali →</a>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: ChangePasswordPage**

`src/pages/auth/ChangePasswordPage.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tokenStore } from '@/features/auth/storage'
import { useAuth } from '@/features/auth/AuthContext'

const BASE = (import.meta as any).env?.VITE_API_URL || '/api'

export function ChangePasswordPage() {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [oldP, setOld] = useState(''); const [newP, setNew] = useState(''); const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const res = await fetch(`${BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.get()}` },
      body: JSON.stringify({ old_password: oldP, new_password: newP }),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.detail || 'Błąd'); return }
    await refresh(); nav('/office/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white p-8 rounded-xl shadow w-80 space-y-4">
        <h1 className="text-lg font-bold text-center">Zmień hasło</h1>
        <input className="w-full border rounded px-3 py-2" placeholder="Stare hasło" type="password"
               value={oldP} onChange={e => setOld(e.target.value)} />
        <input className="w-full border rounded px-3 py-2" placeholder="Nowe hasło (min. 8)" type="password"
               value={newP} onChange={e => setNew(e.target.value)} />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button className="w-full bg-blue-600 text-white rounded py-2 font-medium">Zapisz</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Trasy w App.tsx**

W `src/App.tsx` dodaj importy i trasy PRZED layoutami (poza `OfficeLayout`):
```tsx
import { LoginPage } from '@/pages/auth/LoginPage'
import { ChangePasswordPage } from '@/pages/auth/ChangePasswordPage'
// w <Routes>:
<Route path="/login" element={<LoginPage />} />
<Route path="/zmiana-hasla" element={<ChangePasswordPage />} />
```

- [ ] **Step 4: Weryfikacja** — `npm run typecheck` → brak błędów.

- [ ] **Step 5: Commit**
```bash
git add src/pages/auth/LoginPage.tsx src/pages/auth/ChangePasswordPage.tsx src/App.tsx
git commit -m "feat(auth): front - logowanie biura + zmiana hasla"
```

---

## Task 15: Front — panel logowania operatora (dział → nazwisko → PIN)

**Files:**
- Create: `src/pages/auth/PanelLoginPage.tsx`
- Modify: `src/App.tsx` (trasa `/panel`)

- [ ] **Step 1: PanelLoginPage**

`src/pages/auth/PanelLoginPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { KIOSK_DEPT_KEY } from '@/features/auth/storage'

const BASE = (import.meta as any).env?.VITE_API_URL || '/api'
const DEPTS: Record<string, { label: string; route: string }> = {
  rozbior: { label: 'Rozbiór', route: '/tablet/rozbior' },
  produkcja: { label: 'Produkcja', route: '/tablet/produkcja' },
  pakowanie: { label: 'Pakowanie', route: '/tablet/produkcja' },
  wydanie: { label: 'Wydanie', route: '/tablet/produkcja' },
}

export function PanelLoginPage() {
  const { loginPin } = useAuth()
  const nav = useNavigate()
  const [dept, setDept] = useState<string>(localStorage.getItem(KIOSK_DEPT_KEY) || '')
  const [ops, setOps] = useState<{ id: string; name: string }[]>([])
  const [sel, setSel] = useState<string>('')
  const [pin, setPin] = useState(''); const [err, setErr] = useState('')

  useEffect(() => {
    if (!dept) return
    fetch(`${BASE}/auth/operators?department=${dept}`).then(r => r.json()).then(setOps).catch(() => setOps([]))
  }, [dept])

  if (!dept) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-900 text-white">
        <h1 className="text-xl mb-2">Wybierz dział</h1>
        {Object.entries(DEPTS).map(([k, v]) => (
          <button key={k} onClick={() => setDept(k)}
            className="w-64 py-4 bg-gray-700 rounded-lg text-lg">{v.label}</button>
        ))}
      </div>
    )
  }

  const submit = async () => {
    setErr('')
    try { await loginPin(sel, pin); nav(DEPTS[dept].route, { replace: true }) }
    catch (e: any) { setErr(e.message || 'Błędny PIN'); setPin('') }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-900 text-white">
      <h1 className="text-xl">{DEPTS[dept].label} — zaloguj się</h1>
      <select className="text-black rounded px-3 py-3 w-72 text-lg"
              value={sel} onChange={e => setSel(e.target.value)}>
        <option value="">— wybierz nazwisko —</option>
        {ops.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input className="text-black rounded px-3 py-3 w-72 text-2xl text-center tracking-widest"
             placeholder="PIN" type="password" inputMode="numeric"
             value={pin} onChange={e => setPin(e.target.value)} />
      {err && <div className="text-red-400">{err}</div>}
      <button disabled={!sel || !pin} onClick={submit}
        className="w-72 py-4 bg-green-600 rounded-lg text-lg disabled:opacity-40">Zaloguj</button>
      <button onClick={() => { setDept(''); setSel(''); setPin('') }}
        className="text-sm text-gray-400">← zmień dział</button>
    </div>
  )
}
```

> Kiosk można „przypiąć" do działu ustawiając raz w konsoli urządzenia:
> `localStorage.setItem('kebab.kiosk.department','rozbior')` — wtedy ekran od razu pokazuje listę.

- [ ] **Step 2: Trasa w App.tsx**
```tsx
import { PanelLoginPage } from '@/pages/auth/PanelLoginPage'
// w <Routes>:
<Route path="/panel" element={<PanelLoginPage />} />
```

- [ ] **Step 3: Weryfikacja** — `npm run typecheck`.

- [ ] **Step 4: Commit**
```bash
git add src/pages/auth/PanelLoginPage.tsx src/App.tsx
git commit -m "feat(auth): front - panel logowania operatora (dzial/nazwisko/PIN)"
```

---

## Task 16: Front — guardy tras (biuro / dział)

**Files:**
- Create: `src/features/auth/guards.tsx`
- Modify: `src/App.tsx` (owinięcie layoutów), `src/App.tsx` mapowanie tras tablet→dział

- [ ] **Step 1: Guardy**

`src/features/auth/guards.tsx`:
```tsx
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireOffice({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user || user.kind !== 'office') return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/zmiana-hasla" replace />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user || user.role !== 'admin') return <Navigate to="/office/dashboard" replace />
  return <>{children}</>
}

export function RequireDepartment({ dept, children }: { dept: string; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/panel" replace />
  const ok = user.kind === 'office' || user.departments.includes(dept)
  if (!ok) return <Navigate to="/panel" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: Owiń layouty w App.tsx**

`OfficeLayout` element owiń w `RequireOffice`:
```tsx
<Route path="/office" element={<RequireOffice><OfficeLayout /></RequireOffice>}>
```
Każdą trasę działu hali owiń w `RequireDepartment` z właściwym działem:
```tsx
<Route path="/tablet" element={<TabletLayout />}>
  <Route path="rozbior"   element={<RequireDepartment dept="rozbior"><RozbiorRoute /></RequireDepartment>} />
  <Route path="mieszanie" element={<RequireDepartment dept="produkcja"><MixingHmiV1Page /></RequireDepartment>} />
  <Route path="mieszanie-v2" element={<RequireDepartment dept="produkcja"><MixingHmiV2Page /></RequireDepartment>} />
  <Route path="produkcja" element={<RequireDepartment dept="produkcja"><ProductionTabletPage /></RequireDepartment>} />
</Route>
```
Import: `import { RequireOffice, RequireDepartment } from '@/features/auth/guards'`

- [ ] **Step 3: Weryfikacja** — `npm run typecheck`.

- [ ] **Step 4: Commit**
```bash
git add src/features/auth/guards.tsx src/App.tsx
git commit -m "feat(auth): front - guardy tras biuro/dzial"
```

---

## Task 17: Front — user w nagłówku, wylogowanie, ukrycie menu

**Files:**
- Modify: `src/layouts/OfficeLayout.tsx`, `src/layouts/OfficeSidebar.tsx`, `src/layouts/TabletLayout.tsx`

- [ ] **Step 1: OfficeLayout — nazwa użytkownika + wyloguj**

W nagłówku `OfficeLayout` (sekcja z awatarem, ok. linia 118-119) zastąp statyczny awatar:
```tsx
import { useAuth } from '@/features/auth/AuthContext'
// w komponencie:
const { user, logout } = useAuth()
// w nagłówku:
<div className="flex items-center gap-2 pl-2 border-l border-gray-200">
  <span className="text-sm text-gray-600">{user?.name}</span>
  <button onClick={() => { logout(); location.href = '/login' }}
          className="text-sm text-red-600">Wyloguj</button>
</div>
```

- [ ] **Step 2: OfficeSidebar — ukryj „Użytkownicy" dla nie-admina**

W `OfficeSidebar.tsx` przefiltruj pozycję `/office/uzytkownicy`:
```tsx
import { useAuth } from '@/features/auth/AuthContext'
// w komponencie:
const { user } = useAuth()
// przy renderowaniu itemów sekcji odfiltruj:
.filter(item => item.to !== '/office/uzytkownicy' || user?.role === 'admin')
```

- [ ] **Step 3: TabletLayout — operator + „Wyloguj / zmień operatora"**

W nagłówku `TabletLayout` dodaj:
```tsx
import { useAuth } from '@/features/auth/AuthContext'
const { user, logout } = useAuth()
// w nagłówku:
<div className="flex items-center gap-2">
  <span>{user?.name}</span>
  <button onClick={() => { logout(); location.href = '/panel' }}
          className="px-3 py-1 bg-gray-700 rounded">Wyloguj / zmień operatora</button>
</div>
```

- [ ] **Step 4: Weryfikacja** — `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add src/layouts/OfficeLayout.tsx src/layouts/OfficeSidebar.tsx src/layouts/TabletLayout.tsx
git commit -m "feat(auth): front - user w naglowku, wylogowanie, ukrycie menu"
```

---

## Task 18: Front — strona „Użytkownicy" (konta biura)

**Files:**
- Create: `src/pages/office/UsersPage.tsx`
- Modify: `src/App.tsx` (zamień PlaceholderPage przy `/office/uzytkownicy`)

- [ ] **Step 1: UsersPage**

`src/pages/office/UsersPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { tokenStore } from '@/features/auth/storage'
import { RequireAdmin } from '@/features/auth/guards'

const BASE = (import.meta as any).env?.VITE_API_URL || '/api'
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.get()}` })

interface AppUser { id: string; login: string; role: string; display_name: string; active: boolean }

function UsersInner() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState({ login: '', password: '', display_name: '', role: 'office' })
  const [err, setErr] = useState('')

  const load = () => fetch(`${BASE}/app-users`, { headers: authHeaders() }).then(r => r.json()).then(setUsers)
  useEffect(() => { load() }, [])

  const create = async () => {
    setErr('')
    const res = await fetch(`${BASE}/app-users`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) })
    if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.detail || 'Błąd'); return }
    setForm({ login: '', password: '', display_name: '', role: 'office' }); load()
  }
  const toggle = async (u: AppUser) => {
    await fetch(`${BASE}/app-users/${u.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ active: !u.active }) })
    load()
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Konta biura</h1>
      <div className="flex gap-2 items-end flex-wrap bg-white p-4 rounded shadow">
        <input className="border rounded px-2 py-1" placeholder="Login" value={form.login}
               onChange={e => setForm({ ...form, login: e.target.value })} />
        <input className="border rounded px-2 py-1" placeholder="Imię i nazwisko" value={form.display_name}
               onChange={e => setForm({ ...form, display_name: e.target.value })} />
        <input className="border rounded px-2 py-1" placeholder="Hasło (min.8)" type="password" value={form.password}
               onChange={e => setForm({ ...form, password: e.target.value })} />
        <select className="border rounded px-2 py-1" value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="office">Biuro</option><option value="admin">Admin</option>
        </select>
        <button onClick={create} className="bg-blue-600 text-white rounded px-3 py-1">Dodaj</button>
      </div>
      {err && <div className="text-red-600">{err}</div>}
      <table className="w-full bg-white rounded shadow text-sm">
        <thead><tr className="text-left border-b"><th className="p-2">Login</th><th>Imię</th><th>Rola</th><th>Aktywne</th><th></th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="border-b">
              <td className="p-2">{u.login}</td><td>{u.display_name}</td><td>{u.role}</td>
              <td>{u.active ? '✓' : '—'}</td>
              <td><button onClick={() => toggle(u)} className="text-blue-600">{u.active ? 'Dezaktywuj' : 'Aktywuj'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UsersPage() {
  return <RequireAdmin><UsersInner /></RequireAdmin>
}
```

- [ ] **Step 2: Podmień trasę**

W `src/App.tsx` zamień:
```tsx
<Route path="uzytkownicy" element={<PlaceholderPage title="Użytkownicy" icon="🔐" description="" />} />
```
na:
```tsx
<Route path="uzytkownicy" element={<UsersPage />} />
```
Import: `import { UsersPage } from '@/pages/office/UsersPage'`

- [ ] **Step 3: Weryfikacja** — `npm run typecheck`.

- [ ] **Step 4: Commit**
```bash
git add src/pages/office/UsersPage.tsx src/App.tsx
git commit -m "feat(auth): front - strona Uzytkownicy (konta biura)"
```

---

## Task 19: Front — działy + PIN na stronie Pracownicy

**Files:**
- Modify: `src/pages/office/WorkersPage.tsx`

- [ ] **Step 1: Dodaj pola PIN i działy w formularzu pracownika**

W `WorkersPage.tsx` przy tworzeniu/edycji workera dodaj:
- pole `pin` (input numeryczny),
- multiselect/checkboxy działów: `rozbior, produkcja, pakowanie, wydanie`,
i wysyłaj je w DTO do `POST/PUT /api/workers` (klucze `pin`, `departments`).

Przykład checkboxów:
```tsx
const ALL_DEPTS = ['rozbior', 'produkcja', 'pakowanie', 'wydanie'] as const
// stan: const [departments, setDepartments] = useState<string[]>([])
{ALL_DEPTS.map(d => (
  <label key={d} className="flex items-center gap-1 text-sm">
    <input type="checkbox" checked={departments.includes(d)}
      onChange={e => setDepartments(e.target.checked ? [...departments, d] : departments.filter(x => x !== d))} />
    {d}
  </label>
))}
```
Dołącz `pin` i `departments` do payloadu zapisu workera.

- [ ] **Step 2: Weryfikacja** — `npm run typecheck`.

- [ ] **Step 3: Commit**
```bash
git add src/pages/office/WorkersPage.tsx
git commit -m "feat(auth): front - PIN i dzialy operatora na stronie Pracownicy"
```

---

## Task 20: E2E (Playwright) — logowanie i guardy

**Files:**
- Create: `e2e/auth.spec.ts`

- [ ] **Step 1: Test e2e**

`e2e/auth.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

// Wymaga działającego backendu + bazy (CI). Lokalnie OOM — uruchamiać w CI.
test.describe('auth', () => {
  test('niezalogowany na /office wraca na /login', async ({ page }) => {
    await page.goto('/office/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('logowanie biura wpuszcza do dashboardu', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[placeholder="Login"]', process.env.E2E_ADMIN_LOGIN || 'admin')
    await page.fill('input[placeholder="Hasło"]', process.env.E2E_ADMIN_PASSWORD || 'admin12345')
    await page.click('button:has-text("Zaloguj")')
    await expect(page).toHaveURL(/\/office\//)
  })

  test('panel hali pokazuje wybór działu lub listę', async ({ page }) => {
    await page.goto('/panel')
    await expect(page.locator('text=dział').or(page.locator('text=zaloguj'))).toBeVisible()
  })
})
```

- [ ] **Step 2: Commit**
```bash
git add e2e/auth.spec.ts
git commit -m "test(e2e): logowanie biura, redirect guardow, panel hali"
```

---

## Task 21: Deploy — przekazanie ADMIN_LOGIN/ADMIN_PASSWORD

**Files:**
- Modify: `deploy/.env.example`, `deploy/docker-compose.yml`, `deploy/nowy-klient.sh`

- [ ] **Step 1: .env.example**

W `deploy/.env.example` dodaj sekcję:
```
# Konto startowe biura (admin) — tworzone przy pierwszym uruchomieniu
ADMIN_LOGIN=admin
ADMIN_PASSWORD=ZMIEN_MNIE_mocne_haslo
```

- [ ] **Step 2: docker-compose passthrough**

W `deploy/docker-compose.yml` w `backend.environment` dodaj:
```yaml
      ADMIN_LOGIN: ${ADMIN_LOGIN:-admin}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
```

- [ ] **Step 3: nowy-klient.sh — generuj hasło admina**

W `deploy/nowy-klient.sh` dodaj generację i wpis do `.env` klienta:
```bash
ADMIN_PW="$(openssl rand -hex 16)"
# w bloku cat > "$ENV_FILE":
#   ADMIN_LOGIN=admin
#   ADMIN_PASSWORD=$ADMIN_PW
# oraz w podsumowaniu wypisz: "Konto biura: admin / $ADMIN_PW (zmień po 1. logowaniu)"
```

- [ ] **Step 4: Weryfikacja**
```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config >/dev/null && echo OK
```
Expected: `OK`.

- [ ] **Step 5: Commit**
```bash
git add deploy/.env.example deploy/docker-compose.yml deploy/nowy-klient.sh
git commit -m "feat(deploy): konto startowe admina (ADMIN_LOGIN/ADMIN_PASSWORD)"
```

---

## Task 22: Pełna weryfikacja end-to-end

- [ ] **Step 1: Testy backendu**

Run: `cd backend && python -m pytest -q`
Expected: wszystkie zielone.

- [ ] **Step 2: Typecheck frontu**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 3: Smoke przez docker (pełny obraz)**

```bash
bash deploy/nowy-klient.sh testklient   # port np. 8088, admin/<haslo z wydruku>
# zaloguj biuro przez UI (http://localhost:8088/login), utwórz operatora z PIN+dział,
# wyloguj, wejdź /panel, zaloguj operatora PIN, potwierdź dostęp tylko do jego działu.
docker compose -p kebab-testklient -f deploy/docker-compose.yml down -v   # sprzątanie
```
Expected: biuro widzi wszystko; operator tylko swój panel; wejście na `/office` jako operator → redirect.

---

## Self-review (wypełnione przez autora planu)

- **Pokrycie spec:** logowanie biuro (T6/7/14) ✓; operator PIN + wybór nazwiska (T6/10/15) ✓;
  per dział + wiele działów (T3/10/16/19) ✓; ręczne wylogowanie (T17) ✓; sesje w bazie (T5/6) ✓;
  middleware prefiksowy default-deny (T3/8) ✓; bcrypt + blokada (T1/2/6) ✓; bootstrap admina (T9/21) ✓;
  token renderowania PDF (T4/11) ✓; UI kont (T18/19) ✓; e2e (T20) ✓.
- **Placeholdery:** brak „TBD/TODO"; miejsca dostosowania do istniejącego kodu (INSERT workers, nagłówki
  layoutów) mają konkretny kod i wskazane linie.
- **Spójność typów:** `subject` = `{kind, id, name, role, departments, must_change_password}` jednolicie
  w backendzie (`_office_public`/`_operator_public`), middleware (`request.state.subject`) i froncie
  (`AuthUser`). Uprawnienia `public/any/admin/office/<dept>` spójne w `permissions.py` i `can_access`.
- **Zakres:** jeden spójny plan; fazy backend→front→deploy. OK dla jednego cyklu wdrożenia.
