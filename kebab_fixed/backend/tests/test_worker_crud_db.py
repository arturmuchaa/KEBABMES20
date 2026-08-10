"""Zakładanie i edycja pracownika przez serwis.

Powód: dopisanie kolumn do INSERT-a zostawiło 17 parametrów na 16
placeholderów i KAŻDE dodanie pracownika kończyło się 500
(„not all arguments converted during string formatting"). Żaden test nie
dotykał create_worker, więc 926 zielonych testów tego nie widziało.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import query_one
from app.models.workers import WorkerCreate, WorkerUpdate
from app.services.workers_service import create_worker, update_worker


def test_zakladanie_pracownika_godzinowego(db):
    row = create_worker(WorkerCreate(
        name="TESTOWY", role="WORKER_GENERAL", rate_per_hour=27.0,
        sunday_bonus_enabled=True, sunday_bonus_per_hour=6.0,
        saturday_bonus_enabled=True, saturday_bonus_per_hour=4.0,
    ))
    assert row["name"] == "TESTOWY"
    assert float(row["rate_per_hour"]) == 27.0
    assert row["pay_mode"] == "hourly"
    assert row["saturday_bonus_enabled"] is True
    assert float(row["saturday_bonus_per_hour"]) == 4.0
    assert row["active"] is True


def test_zakladanie_pracownika_na_dniowce(db):
    """Myjący: 150 zł za dzień obecności."""
    row = create_worker(WorkerCreate(
        name="MYJACY", role="WORKER_GENERAL",
        pay_mode="daily", rate_per_day=150.0,
    ))
    assert row["pay_mode"] == "daily"
    assert float(row["rate_per_day"]) == 150.0


def test_zakladanie_rozbieracza_bez_nowych_pol(db):
    """Regresja: domyślne wartości nie mogą wysypać INSERT-a."""
    row = create_worker(WorkerCreate(name="ROZBIERACZ", role="WORKER_DEBONING",
                                     rate_per_kg=0.55))
    assert float(row["rate_per_kg"]) == 0.55
    assert row["pay_mode"] == "hourly"
    assert float(row["rate_per_day"] or 0) == 0


def test_przelaczenie_na_dniowke_przez_edycje(db):
    row = create_worker(WorkerCreate(name="ZMIANA", role="WORKER_GENERAL",
                                     rate_per_hour=27.0))
    update_worker(row["id"], WorkerUpdate(pay_mode="daily", rate_per_day=150.0))
    after = query_one("SELECT pay_mode, rate_per_day FROM workers WHERE id=%s", (row["id"],))
    assert after["pay_mode"] == "daily"
    assert float(after["rate_per_day"]) == 150.0


def test_nieznany_tryb_platnosci_ladzie_jako_godzinowy(db):
    """CHECK w bazie zna tylko hourly/daily — cokolwiek innego ma się
    znormalizować, a nie wysadzić zapis."""
    row = create_worker(WorkerCreate(name="DZIWNY", role="WORKER_GENERAL",
                                     pay_mode="cokolwiek"))
    assert row["pay_mode"] == "hourly"
