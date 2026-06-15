import time
import types

import app.auth.render_token as rt
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


def test_default_secret_comes_from_settings(monkeypatch):
    # Gdy RENDER_TOKEN_SECRET jest ustawiony, domyślny sekret = ta wartość.
    monkeypatch.setattr(
        rt, "settings", types.SimpleNamespace(render_token_secret="shared-prod-secret"),
        raising=False,
    )
    t = make_render_token(ttl=60)  # bez jawnego sekretu → domyślny
    assert verify_render_token(t, secret="shared-prod-secret") is True


def test_configured_secret_consistent_across_processes(monkeypatch):
    # Sedno fixu: dwa workery gunicorna z tym samym RENDER_TOKEN_SECRET, ale
    # różnym losowym sekretem efemerycznym, muszą weryfikować nawzajem tokeny.
    monkeypatch.setattr(
        rt, "settings", types.SimpleNamespace(render_token_secret="shared"),
        raising=False,
    )
    t = make_render_token(ttl=60)
    monkeypatch.setattr(rt, "_EPHEMERAL_SECRET", "inny-losowy-na-drugim-workerze", raising=False)
    assert verify_render_token(t) is True


def test_falls_back_to_ephemeral_when_unset(monkeypatch):
    # Brak konfiguracji (dev/single-worker) → roundtrip nadal działa.
    monkeypatch.setattr(
        rt, "settings", types.SimpleNamespace(render_token_secret=""),
        raising=False,
    )
    t = make_render_token(ttl=60)
    assert verify_render_token(t) is True
