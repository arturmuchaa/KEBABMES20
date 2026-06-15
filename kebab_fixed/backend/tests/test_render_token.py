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
