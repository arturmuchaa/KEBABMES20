"""Język klienta dla HDI na podstawie prefiksu NIP."""

# Mapowanie 2-literowego prefiksu kraju (z NIP) → kod języka HDI.
_CC_TO_LANG = {"PL": "pl", "DE": "de", "AT": "de", "SK": "sk", "CZ": "cs", "SI": "sl", "FR": "fr"}


def lang_from_nip(nip: str) -> str:
    """Kod języka wg prefiksu NIP.

    Brak prefiksu (polskie cyfry / pusty) → 'pl'. Nieznany prefiks → 'en' (zapas).
    """
    s = (nip or "").strip().upper()
    cc = s[:2] if len(s) >= 2 and s[:2].isalpha() else ""
    if not cc:
        return "pl"
    return _CC_TO_LANG.get(cc, "en")
