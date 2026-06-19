"""VIES proxy (EU VAT validation)."""
import json as _json
import time
import urllib.error
import urllib.request
from typing import Dict

from fastapi import HTTPException

from app.logging_config import get_logger

logger = get_logger(__name__)


# userError oznaczające „nie udało się sprawdzić TERAZ" (NIE „numer nieważny").
_TRANSIENT = {
    "MS_UNAVAILABLE", "SERVICE_UNAVAILABLE", "TIMEOUT", "MS_MAX_CONCURRENT_REQ",
    "GLOBAL_MAX_CONCURRENT_REQ", "MS_TIMEOUT",
}


def _normalize_vat(vat: str) -> tuple[str, str]:
    """Zwraca (kod_kraju, numer). Usuwa spacje/myślniki i ZDUBLOWANY prefiks kraju
    (np. gdy ktoś wpisze 'DE' w polu kraju i 'DE123...' w numerze → 'DEDE123...')."""
    v = "".join(ch for ch in (vat or "").upper() if ch.isalnum())
    if len(v) < 4 or not v[:2].isalpha():
        raise HTTPException(400, "Nieprawidłowy format VAT — oczekiwany: KK + numer, np. DE129274202")
    cc, rest = v[:2], v[2:]
    if rest[:2] == cc and len(rest) > 2:  # zdublowany prefiks kraju
        rest = rest[2:]
    if not rest:
        raise HTTPException(400, "Brak numeru VAT po kodzie kraju")
    return cc, rest


def vies_lookup(vat: str) -> Dict:
    country_code, vat_number = _normalize_vat(vat)
    url = (
        f"https://ec.europa.eu/taxation_customs/vies/rest-api/ms/"
        f"{country_code}/vat/{vat_number}"
    )

    data = None
    last_err = ""
    for attempt in range(3):  # VIES bywa chwilowo niedostępny — ponów (jak strona VIES)
        try:
            req = urllib.request.Request(url)
            req.add_header("Accept", "application/json")
            req.add_header("User-Agent", "KebabMES/1.0")
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = _json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            logger.warning("vies.http_error", extra={"vat": vat, "code": e.code})
        except Exception as e:
            last_err = str(e)
            logger.warning("vies.error", extra={"vat": vat, "error": str(e)})

        if data is not None:
            user_error = (data.get("userError") or "").upper()
            # Numer ważny LUB jednoznacznie nieważny → zwróć wynik (nie ponawiaj).
            if data.get("isValid") is not None and user_error not in _TRANSIENT:
                break
            last_err = user_error or last_err
            data = None  # transient → ponów
        time.sleep(0.8)

    if data is None:
        raise HTTPException(
            503,
            f"VIES chwilowo niedostępny ({last_err or 'brak odpowiedzi'}) — spróbuj ponownie za chwilę.",
        )

    return {
        "vatNumber": country_code + vat_number,
        "countryCode": data.get("countryCode") or country_code,
        "traderName": (data.get("name") or "").replace("---", "").strip(),
        "traderAddress": (data.get("address") or "").replace("---", "").strip(),
        "valid": bool(data.get("isValid")),
        "userError": (data.get("userError") or "").upper(),
    }
