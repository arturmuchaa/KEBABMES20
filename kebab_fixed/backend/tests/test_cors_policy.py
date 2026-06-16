from app.main import cors_is_wildcard


def test_wildcard_detected():
    assert cors_is_wildcard(["*"]) is True


def test_specific_origin_not_wildcard():
    assert cors_is_wildcard(["https://app.example.com"]) is False


def test_wildcard_among_specific_is_detected():
    assert cors_is_wildcard(["https://app.example.com", "*"]) is True


def test_empty_list_not_wildcard():
    assert cors_is_wildcard([]) is False
