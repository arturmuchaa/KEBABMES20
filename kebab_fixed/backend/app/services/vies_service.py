"""VIES proxy (EU VAT validation)."""
import json as _json
import socket
import time
import urllib.error
import urllib.request
from typing import Dict

from fastapi import HTTPException

from app.logging_config import get_logger
from app.services.adresy import kraj_z_vat, rozbij_adres_vies

logger = get_logger(__name__)


# userError oznaczające „nie udało się sprawdzić TERAZ" (NIE „numer nieważny").
_TRANSIENT = {
    "MS_UNAVAILABLE", "SERVICE_UNAVAILABLE", "TIMEOUT", "MS_MAX_CONCURRENT_REQ",
    "GLOBAL_MAX_CONCURRENT_REQ", "MS_TIMEOUT",
}


# Odpowiedzi, które są pewnym wynikiem (ważny / nieważny / zły format numeru).
_PEWNE = {"", "VALID", "INVALID", "INVALID_INPUT"}


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


_BAZA = "https://ec.europa.eu/taxation_customs/vies/rest-api"


def _nip_zakladu() -> str:
    """NIP naszego zakładu (zapytujący w VIES → numer potwierdzenia).
    Pusty, gdy ustawień firmy brak lub baza niedostępna — sprawdzenie i tak idzie."""
    try:
        from app.services.settings_service import get_company
        return str((get_company() or {}).get("nip") or "")
    except Exception:
        logger.warning("vies.nip_zakladu.error")
        return ""


def _http_json(req: urllib.request.Request, timeout: int) -> Dict:
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "KebabMES/1.0")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return _json.loads(resp.read().decode())


def _zapytaj(cc: str, num: str, timeout: int) -> Dict:
    """POST check-vat-number (z naszym NIP-em → requestIdentifier); gdy POST
    zawiedzie — GET po staremu (bez numeru potwierdzenia)."""
    body = {"countryCode": cc, "vatNumber": num}
    nasz = "".join(ch for ch in _nip_zakladu() if ch.isdigit())
    if len(nasz) == 10:
        body.update({"requesterMemberStateCode": "PL", "requesterNumber": nasz})
    try:
        req = urllib.request.Request(f"{_BAZA}/check-vat-number",
                                     data=_json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        return _http_json(req, timeout)
    except (TimeoutError, socket.timeout) as e:
        # VIES nie odpowiada — drugie zapytanie (GET) tylko podwoiłoby czekanie.
        raise e
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), (TimeoutError, socket.timeout)):
            raise
        logger.warning("vies.post_error", extra={"vat": cc + num, "error": str(e)})
    except Exception as e:
        logger.warning("vies.post_error", extra={"vat": cc + num, "error": str(e)})
    return _http_json(urllib.request.Request(f"{_BAZA}/ms/{cc}/vat/{num}"), timeout)


def vies_check(vat: str, *, timeout: int = 15, attempts: int = 3) -> Dict:
    """Sprawdzenie VAT UE w VIES. 503 = chwilowo nie da się sprawdzić (to NIE
    jest „nieaktywny”), 400 = zły format numeru."""
    country_code, vat_number = _normalize_vat(vat)

    data = None
    last_err = ""
    for attempt in range(max(1, attempts)):  # VIES bywa chwilowo niedostępny — ponów
        try:
            data = _zapytaj(country_code, vat_number, timeout)
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            logger.warning("vies.http_error", extra={"vat": vat, "code": e.code})
        except Exception as e:
            last_err = str(e)
            logger.warning("vies.error", extra={"vat": vat, "error": str(e)})

        if data is not None:
            user_error = (data.get("userError") or "").upper()
            valid = data.get("valid", data.get("isValid"))
            # Wynik pewny TYLKO dla znanych odpowiedzi; każdy inny kod błędu
            # (SERVER_BUSY, INVALID_REQUESTER_INFO, IP_BLOCKED…) to „nie sprawdzono”,
            # bo zapisany jako nieaktywny zmieniłby stawkę VAT na WZ (przegląd 27.11).
            if isinstance(valid, bool) and user_error in _PEWNE:
                break
            last_err = user_error or last_err
            data = None  # transient → ponów
        if attempt < attempts - 1:
            time.sleep(0.8)

    if data is None:
        raise HTTPException(
            503,
            f"VIES chwilowo niedostępny ({last_err or 'brak odpowiedzi'}) — spróbuj ponownie za chwilę.",
        )

    kraj = kraj_z_vat(country_code + vat_number)
    adres = (data.get("address") or "").replace("---", "").strip()
    rozbity = rozbij_adres_vies(adres, kraj)
    return {
        "vatNumber": country_code + vat_number,
        "countryCode": data.get("countryCode") or country_code,
        "traderName": (data.get("name") or "").replace("---", "").strip(),
        "traderAddress": adres,
        "valid": bool(data.get("valid", data.get("isValid"))),
        "userError": (data.get("userError") or "").upper(),
        "ulica": rozbity["ulica"],
        "kodPocztowy": rozbity["kod_pocztowy"],
        "miasto": rozbity["miasto"],
        "kraj": kraj,
        "requestIdentifier": data.get("requestIdentifier") or "",
        "requestDate": data.get("requestDate") or "",
    }


def vies_lookup(vat: str) -> Dict:
    return vies_check(vat)
