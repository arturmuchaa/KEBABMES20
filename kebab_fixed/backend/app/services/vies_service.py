"""VIES proxy (EU VAT validation)."""
import json as _json
import urllib.error
import urllib.request
from typing import Dict

from fastapi import HTTPException

from app.logging_config import get_logger

logger = get_logger(__name__)


def vies_lookup(vat: str) -> Dict:
    vat = (vat or "").strip().upper().replace(" ", "")
    if len(vat) < 4:
        raise HTTPException(400, "Za krótki numer VAT")

    country_code = vat[:2]
    vat_number = vat[2:]

    if not country_code.isalpha() or not vat_number:
        raise HTTPException(
            400,
            "Nieprawidłowy format VAT — oczekiwany: KK + numer, np. DE129274202",
        )

    url = (
        f"https://ec.europa.eu/taxation_customs/vies/rest-api/ms/"
        f"{country_code}/vat/{vat_number}"
    )
    try:
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "KebabMES/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = _json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if hasattr(e, "read") else ""
        logger.warning(
            "vies.http_error",
            extra={"vat": vat, "code": e.code, "body": body[:200]},
        )
        raise HTTPException(502, f"VIES API błąd {e.code}: {body[:200]}")
    except Exception as e:
        logger.warning("vies.error", extra={"vat": vat, "error": str(e)})
        raise HTTPException(502, f"Błąd połączenia z VIES: {e}")

    return {
        "vatNumber": country_code + vat_number,
        "countryCode": data.get("countryCode") or country_code,
        "traderName": data.get("name") or "",
        "traderAddress": data.get("address") or "",
        "valid": bool(data.get("valid")),
    }
