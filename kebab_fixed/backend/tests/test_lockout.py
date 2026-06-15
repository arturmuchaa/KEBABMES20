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
