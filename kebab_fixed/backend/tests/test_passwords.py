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


def test_verify_false_for_none_secret():
    h = hash_secret("x")
    assert verify_secret(None, h) is False  # type: ignore[arg-type]
