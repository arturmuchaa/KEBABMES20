"""Bootstrap konta admin na ŚWIEŻEJ bazie — musi znieść kilka procesów naraz.

Znalezione 19.08.2026 przez nowe e2e (obraz produkcyjny + czysta baza):
gunicorn startuje z kilkoma workerami, każdy woła `ensure_bootstrap_admin`,
wszystkie przechodzą sprawdzenie „czy jest admin" i wszystkie próbują wstawić
konto `admin`. Unikat na `login` przewracał wtedy worker przy starcie:

    ERROR [app.db] db.tx.error … duplicate key value violates unique constraint

Na produkcji dotyczy to KAŻDEJ nowej instancji u klienta (deploy/nowy-klient.sh
stawia świeżą bazę), więc pierwsze uruchomienie potrafiło wstać niekompletne.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
from app.db import execute, query_all, query_one
from app.services import app_users_service
from app.services.app_users_service import ensure_bootstrap_admin
from app.utils.ids import cuid, now_iso


def _admini() -> list:
    return query_all("SELECT login FROM app_users WHERE role='admin'")


def _czysta_baza_kont() -> None:
    """Baza testowa niesie konta z innych testów — bootstrap dotyczy ŚWIEŻEJ
    instalacji, więc mierzymy go na pustej kartotece kont."""
    execute("DELETE FROM app_users")


def test_bootstrap_na_pustej_bazie_zaklada_jedno_konto(db):
    _czysta_baza_kont()
    ensure_bootstrap_admin()
    assert len(_admini()) == 1


def test_drugi_worker_nie_wywraca_startu(db, monkeypatch):
    """Wyścig dwóch workerów: obaj widzą pustą bazę, obaj wstawiają.

    Odtwarzamy go deterministycznie — pierwszy worker zakłada konto, a drugi
    ma podane, że admina NIE MA (dokładnie to widzi, gdy oba sprawdzenia
    wykonają się przed pierwszym zapisem).
    """
    _czysta_baza_kont()
    ensure_bootstrap_admin()
    assert len(_admini()) == 1

    monkeypatch.setattr(app_users_service, "query_one", lambda *a, **k: None)
    ensure_bootstrap_admin()          # przed poprawką: UniqueViolation

    assert len(_admini()) == 1, "wyścig nie może zrobić drugiego admina"


def test_istniejacego_admina_nie_rusza(db):
    """Konto założone wcześniej (własnym loginem) zostaje nietknięte."""
    _czysta_baza_kont()
    execute(
        "INSERT INTO app_users (id, login, password_hash, role, display_name, active, "
        "must_change_password, failed_attempts, created_at) "
        "VALUES (%s,'szef','x','admin','Szef',true,false,0,%s)", (cuid(), now_iso()))

    ensure_bootstrap_admin()

    assert [a["login"] for a in _admini()] == ["szef"]
    assert query_one("SELECT 1 FROM app_users WHERE login='admin'") is None
