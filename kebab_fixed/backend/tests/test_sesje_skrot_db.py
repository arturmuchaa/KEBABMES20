"""Tokeny sesji w bazie jako skrót SHA-256, nie jawnym tekstem.

Znalezione w próbie PROTRIMA (30.10.2026): tabela `sessions` trzymała tokeny jawnie — kopia bazy
(backup, próba na :8090) była kopią aktywnych sesji wszystkich kont i kiosków. Teraz w bazie leży
sha256(token); klient dalej wysyła sam token. Sesje sprzed zmiany (jawne) przechodzą na skrót przy
pierwszym użyciu — nikt nie zostaje wylogowany, także kioski hali.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import hashlib

from app.db import execute, query_one
from app.services import auth_service
from app.utils.ids import cuid, now_iso
from app.utils.passwords import hash_secret

skrot = lambda t: hashlib.sha256(t.encode()).hexdigest()


def _konto():
    """Konto z własnym loginem — fixture nie czyści kartoteki kont między testami."""
    uid = cuid()
    login = f"biuro-{uid}"
    execute(
        "INSERT INTO app_users (id, login, password_hash, display_name, role, active, must_change_password, failed_attempts, created_at) "
        "VALUES (%s,%s,%s,%s,'office',true,false,0,%s)",
        (uid, login, hash_secret("haslo-123456"), "Biuro Test", now_iso()),
    )
    return uid, login


def test_logowanie_zapisuje_skrot_tokenu_a_nie_token(db):
    _, login = _konto()
    token = auth_service.login_office(login, "haslo-123456")["token"]
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (token,)) is None
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (skrot(token),)) is not None
    assert auth_service.resolve_session(token)["name"] == "Biuro Test"


def test_wylogowanie_usuwa_sesje_po_skrocie(db):
    _, login = _konto()
    token = auth_service.login_office(login, "haslo-123456")["token"]
    auth_service.logout(token)
    assert auth_service.resolve_session(token) is None
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (skrot(token),)) is None


def test_sesja_sprzed_zmiany_dziala_i_przechodzi_na_skrot(db):
    uid, _ = _konto()
    stary = f"jawny-sprzed-zmiany-{cuid()}"  # unikalny — fixture nie czyści tabeli sesji
    ts = now_iso()
    execute(
        "INSERT INTO sessions (token, subject_type, subject_id, label, created_at, last_seen, expires_at) "
        "VALUES (%s,'office',%s,'',%s,%s, now() + interval '1 day')",
        (stary, uid, ts, ts),
    )
    assert auth_service.resolve_session(stary)["name"] == "Biuro Test"
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (stary,)) is None
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (skrot(stary),)) is not None
    # Kolejne użycie działa już po skrócie.
    assert auth_service.resolve_session(stary)["name"] == "Biuro Test"


def test_pusty_albo_cudzy_token_nie_otwiera_sesji(db):
    _, login = _konto()
    token = auth_service.login_office(login, "haslo-123456")["token"]
    assert auth_service.resolve_session("") is None
    # Sam skrót z bazy (np. z kopii) nie jest tokenem — nie wolno nim się zalogować.
    assert auth_service.resolve_session(skrot(token)) is None


def test_migracja_zamienia_stare_sesje_na_skroty_raz(db):
    """Migracja zbiorcza przy starcie serwera: jawne tokeny → skróty; skróty zostają nietknięte
    (drugie uruchomienie nie haszuje skrótu drugi raz)."""
    from app.migrations import run_migrations
    uid, _ = _konto()
    stary = f"jawny-do-migracji-{cuid()}"
    ts = now_iso()
    execute(
        "INSERT INTO sessions (token, subject_type, subject_id, label, created_at, last_seen, expires_at) "
        "VALUES (%s,'office',%s,'',%s,%s, now() + interval '1 day')",
        (stary, uid, ts, ts),
    )
    run_migrations()
    run_migrations()
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (stary,)) is None
    assert query_one("SELECT 1 FROM sessions WHERE token=%s", (skrot(stary),)) is not None
    assert auth_service.resolve_session(stary)["name"] == "Biuro Test"
