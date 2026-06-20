"""Wyszukiwanie firm po NIP (dane polskie).

Źródło GŁÓWNE: oficjalny, DARMOWY „Wykaz podatników VAT" Ministerstwa Finansów
(`wl-api.mf.gov.pl`) — bez klucza API, stabilny. Źródło ZAPASOWE: dataport.pl
(płatne, opcjonalne — tylko gdy ustawiony DATAPORT_API_KEY). Dzięki temu wyszukiwanie
po NIP działa nawet gdy płatny dostawca ma awarię/quota — koniec nawracających psuć.
"""
from __future__ import annotations

import datetime
import json
import re
from urllib import error, request

from fastapi import HTTPException

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(__name__)

_USER_AGENT = "Kebab-MES/3.0"


def _clean_nip(nip: str) -> str:
    clean = "".join(ch for ch in (nip or "") if ch.isdigit())
    if len(clean) != 10:
        raise HTTPException(400, "NIP musi mieć dokładnie 10 cyfr")
    return clean


def _http_get_json(url: str, headers: dict, timeout: int = 12) -> dict:
    req = request.Request(url, headers=headers)
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_pl_address(addr: str) -> dict:
    """Best-effort rozbicie polskiego adresu „UL. X 12/3, 00-000 MIASTO" na pola.
    Na nieznanym formacie zwraca puste pola — pełny adres i tak wraca w `adres`."""
    out = {"ulica": None, "numer_budynku": None, "numer_lokalu": None,
           "kod_pocztowy": None, "miasto": None}
    if not addr:
        return out
    parts = [p.strip() for p in addr.split(",") if p.strip()]
    if parts:
        m = re.search(r"(\d{2}-\d{3})\s+(.+)$", parts[-1])
        if m:
            out["kod_pocztowy"] = m.group(1)
            out["miasto"] = m.group(2).strip()
            street = ", ".join(parts[:-1]) if len(parts) > 1 else ""
        else:
            street = parts[0]
        sm = re.search(r"^(.*?)[\s]+(\d+[A-Za-z]?)(?:\s*/\s*(\w+))?$", street)
        if sm:
            out["ulica"] = sm.group(1).strip() or None
            out["numer_budynku"] = sm.group(2)
            out["numer_lokalu"] = sm.group(3)
        elif street:
            out["ulica"] = street
    return out


def _lookup_mf(clean: str) -> dict | None:
    """Oficjalny wykaz podatników VAT (MF). Bez klucza. None gdy brak/nieosiągalne."""
    date = datetime.date.today().isoformat()
    url = f"https://wl-api.mf.gov.pl/api/search/nip/{clean}?date={date}"
    try:
        payload = _http_get_json(url, {"Accept": "application/json", "User-Agent": _USER_AGENT})
    except error.HTTPError as exc:
        if exc.code == 404:
            return None
        logger.warning("mf.lookup.http_error", extra={"nip": clean, "status": exc.code})
        return None
    except Exception as exc:  # sieć/timeout — pozwól na fallback
        logger.warning("mf.lookup.error", extra={"nip": clean, "error": str(exc)})
        return None

    subject = (payload.get("result") or {}).get("subject") or {}
    if not subject.get("name"):
        return None
    address = subject.get("workingAddress") or subject.get("residenceAddress") or ""
    parsed = _parse_pl_address(address)
    return {
        "nip": clean,
        "regon": subject.get("regon"),
        "nazwa": subject.get("name") or "",
        "adres": address,
        **parsed,
    }


def _lookup_dataport(clean: str) -> dict | None:
    """Zapas: dataport.pl (płatny). None gdy brak klucza / brak firmy / błąd."""
    api_key = (settings.dataport_api_key or "").strip()
    if not api_key:
        return None
    url = f"https://dataport.pl/api/v1/company/{clean}?format=full"
    try:
        payload = _http_get_json(
            url,
            {"X-API-Key": api_key, "Accept": "application/json", "User-Agent": _USER_AGENT},
        )
    except error.HTTPError as exc:
        if exc.code == 404:
            return None
        logger.warning("gus.lookup.http_error", extra={"nip": clean, "status": exc.code})
        return None
    except Exception as exc:
        logger.warning("gus.lookup.error", extra={"nip": clean, "error": str(exc)})
        return None

    if not payload or not payload.get("nazwa"):
        return None
    address_parts = [
        " ".join(p for p in [payload.get("ulica"), payload.get("numer_budynku")] if p).strip(),
        " ".join(p for p in [payload.get("kod_pocztowy"), payload.get("miasto")] if p).strip(),
    ]
    address = ", ".join(p for p in address_parts if p)
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


def gus_lookup(nip: str) -> dict:
    """Dane firmy po NIP: MF (główne, darmowe) → dataport (zapas)."""
    clean = _clean_nip(nip)
    company = _lookup_mf(clean)
    if company:
        return company
    company = _lookup_dataport(clean)
    if company:
        return company
    raise HTTPException(404, "Nie znaleziono firmy w rejestrze (MF/GUS)")


def nip_lookup(nip: str) -> dict:
    company = gus_lookup(nip)
    return {
        "valid": True,
        "nip": company["nip"],
        "regon": company.get("regon"),
        "name": company.get("nazwa") or "",
        "address": company.get("adres") or "",
    }
