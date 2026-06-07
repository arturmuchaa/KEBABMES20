from app.services.wz_service import is_foreign_nip


def test_polish_digits_domestic():
    assert is_foreign_nip("1234567890") is False


def test_pl_prefix_domestic():
    assert is_foreign_nip("PL1234567890") is False


def test_de_foreign():
    assert is_foreign_nip("DE123456789") is True


def test_case_insensitive_and_trim():
    assert is_foreign_nip("  sk2020202020 ") is True
    assert is_foreign_nip("at12345") is True


def test_empty_domestic():
    assert is_foreign_nip("") is False
    assert is_foreign_nip(None) is False
