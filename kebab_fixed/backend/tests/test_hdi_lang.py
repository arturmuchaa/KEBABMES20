from app.utils.hdi_lang import lang_from_nip


def test_polish_digits_or_empty():
    assert lang_from_nip("1234567890") == "pl"
    assert lang_from_nip("") == "pl"
    assert lang_from_nip(None) == "pl"


def test_known_prefixes():
    assert lang_from_nip("PL1234567890") == "pl"
    assert lang_from_nip("DE123456789") == "de"
    assert lang_from_nip("AT U12345678") == "de"
    assert lang_from_nip("SK1234567890") == "sk"
    assert lang_from_nip("CZ12345678") == "cs"
    assert lang_from_nip("SI54806852") == "sl"


def test_unknown_prefix_fallback_en():
    assert lang_from_nip("FR12345678901") == "en"
