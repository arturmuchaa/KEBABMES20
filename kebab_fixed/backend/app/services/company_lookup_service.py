"""Company lookup helpers for Polish NIP/GUS data."""
from __future__ import annotations

import json
from urllib import error, request

from fastapi import HTTPException

from app.logging_config import get_logger

logger = get_logger(__name__)

_DATAPORT_API_KEY = "bQnofjptVjNp8m2jL90lkSofEsluEoCJVORSAb5rzVTQ8ZrJodsECPrcQuUsEeTg"


def _clean_nip(nip: str) -> str:
    clean = "".join(ch for ch in (nip or "") if ch.isdigit())
    if len(clean) != 10:
        raise HTTPException(400, "NIP musi mieć dokładnie 10 cyfr")
    return clean


def gus_lookup(nip: str) -> dict:
    clean = _clean_nip(nip)
    url = f"https://dataport.pl/api/v1/company/{clean}?format=full"
    req = request.Request(
        url,
        headers={
            "X-API-Key": _DATAPORT_API_KEY,
            "Accept": "application/json",
            "User-Agent": "Kebab-MES/3.0",
        },
    )
    try:
        with request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        logger.warning(
            "gus.lookup.http_error",
            extra={"nip": clean, "status": exc.code, "detail": detail[:300]},
        )
        if exc.code == 404:
            raise HTTPException(404, "Nie znaleziono firmy w GUS")
        raise HTTPException(502, f"Błąd GUS/dataport ({exc.code})")
    except Exception as exc:
        logger.warning("gus.lookup.error", extra={"nip": clean, "error": str(exc)})
        raise HTTPException(502, "Błąd połączenia z GUS/dataport")

    if not payload or not payload.get("nazwa"):
        raise HTTPException(404, "Nie znaleziono firmy w GUS")

    address_parts = [
        " ".join(
            part
            for part in [payload.get("ulica"), payload.get("numer_budynku")]
            if part
        ).strip(),
        " ".join(
            part for part in [payload.get("kod_pocztowy"), payload.get("miasto")] if part
        ).strip(),
    ]
    address = ", ".join(part for part in address_parts if part)

    return {
        "nip": clean,
        "regon": payload.get("regon"),
        "nazwa": payload.get("nazwa") or "",
        "ulica": payload.get("ulica"),
        "numer_budynku": payload.get("numer_budynku"),
        "numer_lokalu": payload.get("numer_lokalu"),
        "kod_pocztowy": payload.get("kod_pocztowy"),
        "miasto": payload.get("miasto"),
        "adres": address,
    }


def nip_lookup(nip: str) -> dict:
    company = gus_lookup(nip)
    return {
        "valid": True,
        "nip": company["nip"],
        "regon": company.get("regon"),
        "name": company.get("nazwa") or "",
        "address": company.get("adres") or "",
    }
