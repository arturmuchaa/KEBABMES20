from datetime import datetime, timedelta, timezone

from app.auth.session_policy import SESSION_TTL_HOURS, is_expired, next_expiry


def _now():
    return datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc)


def test_next_expiry_is_now_plus_ttl():
    assert next_expiry(_now()) == _now() + timedelta(hours=SESSION_TTL_HOURS)


def test_not_expired_before_expiry():
    exp = _now() + timedelta(minutes=1)
    assert is_expired(exp, _now()) is False


def test_expired_after_expiry():
    exp = _now() - timedelta(seconds=1)
    assert is_expired(exp, _now()) is True


def test_expired_exactly_at_boundary_is_not_expired():
    # expires_at == now → sesja jeszcze ważna w tej milisekundzie
    assert is_expired(_now(), _now()) is False


def test_null_expiry_never_expires():
    # Wiersze sprzed wdrożenia mają expires_at = NULL; nie wyrzucamy ich z sesji.
    assert is_expired(None, _now()) is False
