"""Wyszukiwanie firm po NIP (dane polskie).

Kolejność (27.11.2026): GUS BIR1.1 (gdy ustawiony GUS_BIR_KEY — pola adresu
przychodzą osobno, bez zgadywania) → wykaz VAT MF → dataport. Adres z MF to
jeden napis — rozbija go `adresy.rozbij_adres_pl`. Nazwa firmy zostaje jak
w rejestrze; ulica i miasto dostają zwykłe litery.

Źródło GŁÓWNE: oficjalny, DARMOWY „Wykaz podatników VAT" Ministerstwa Finansów
(`wl-api.mf.gov.pl`) — bez klucza API, stabilny. Źródło ZAPASOWE: dataport.pl
(płatne, opcjonalne — tylko gdy ustawiony DATAPORT_API_KEY). Dzięki temu wyszukiwanie
po NIP działa nawet gdy płatny dostawca ma awarię/quota — koniec nawracających psuć.
"""
from __future__ import annotations

import datetime
import html
import json
import re
import xml.etree.ElementTree as ET
from urllib import error, request

from fastapi import HTTPException

from app.config import settings
from app.logging_config import get_logger
from app.services.adresy import (formatuj_ulice, ladne_litery, normalizuj_kod,
                                 rozbij_adres_pl)

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
    parsed = rozbij_adres_pl(address)
    return _wynik(clean, subject.get("regon"), subject.get("name") or "",
                  parsed["ulica"], parsed["kod_pocztowy"], parsed["miasto"], address, "MF")


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
    ulica = " ".join(p for p in [payload.get("ulica"), payload.get("numer_budynku")] if p).strip()
    if payload.get("numer_lokalu"):
        ulica = f"{ulica}/{payload['numer_lokalu']}"
    kod = payload.get("kod_pocztowy") or ""
    miasto = payload.get("miasto") or ""
    address = ", ".join(p for p in [ulica, " ".join(p for p in [kod, miasto] if p).strip()] if p)
    return _wynik(clean, payload.get("regon"), payload.get("nazwa") or "",
                  formatuj_ulice(ulica), normalizuj_kod(kod, "PL"), ladne_litery(miasto),
                  address, "dataport")


def _wynik(nip, regon, nazwa, ulica, kod, miasto, adres, zrodlo) -> dict:
    """Wspólny kształt odpowiedzi. `numer_budynku`/`numer_lokalu` zostają
    (puste) dla zgodności starego frontu — numer jest już w `ulica`."""
    return {
        "nip": nip, "regon": regon, "nazwa": nazwa,
        "ulica": ulica, "kod_pocztowy": kod, "miasto": miasto, "kraj": "PL",
        "adres": adres, "zrodlo": zrodlo,
        "numer_budynku": None, "numer_lokalu": None,
    }


# ── GUS BIR1.1 (rejestr REGON) ──────────────────────────────────────────
_BIR_URL = "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc"
_BIR_NS = "http://CIS/BIR/PUBL/2014/07"


def _bir_koperta(akcja: str, cialo: str) -> bytes:
    return (
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" '
        f'xmlns:ns="{_BIR_NS}" xmlns:dat="{_BIR_NS}/DataContract">'
        '<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">'
        f"<wsa:To>{_BIR_URL}</wsa:To>"
        f"<wsa:Action>{_BIR_NS}/IUslugaBIRzewnPubl/{akcja}</wsa:Action>"
        f"</soap:Header><soap:Body>{cialo}</soap:Body></soap:Envelope>"
    ).encode("utf-8")


def _bir_post(akcja: str, cialo: str, sid: str = "", timeout: int = 10) -> str:
    headers = {"Content-Type": "application/soap+xml; charset=utf-8", "User-Agent": _USER_AGENT}
    if sid:
        headers["sid"] = sid
    req = request.Request(_BIR_URL, data=_bir_koperta(akcja, cialo), headers=headers, method="POST")
    with request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _bir_wynik(odpowiedz: str, akcja: str) -> str:
    m = re.search(rf"<{akcja}Result>(.*?)</{akcja}Result>", odpowiedz, re.S)
    return html.unescape(m.group(1)).strip() if m else ""


def _bir_z_xml(dane_xml: str, nip: str) -> dict | None:
    """Wynik DaneSzukajPodmioty (XML w XML-u) → nasz kształt. None gdy pusty."""
    try:
        root = ET.fromstring(dane_xml)
    except ET.ParseError:
        return None
    dane = root.find("dane")
    if dane is None or not (dane.findtext("Nazwa") or "").strip():
        return None
    pole = lambda k: (dane.findtext(k) or "").strip()  # noqa: E731
    miejscowosc = pole("Miejscowosc")
    nr = pole("NrNieruchomosci")
    if pole("NrLokalu"):
        nr = f"{nr}/{pole('NrLokalu')}"
    ulica = " ".join(p for p in [pole("Ulica") or miejscowosc, nr] if p)
    miasto = pole("MiejscowoscPoczty") or miejscowosc
    kod = pole("KodPocztowy")
    adres = ", ".join(p for p in [ulica, f"{kod} {miasto}".strip()] if p)
    return _wynik(nip, pole("Regon") or None, pole("Nazwa"), formatuj_ulice(ulica),
                  normalizuj_kod(kod, "PL"), ladne_litery(miasto), adres, "GUS")


def _lookup_bir(clean: str) -> dict | None:
    """GUS BIR1.1: Zaloguj → DaneSzukajPodmioty. None na każdy błąd (dalej MF)."""
    key = (settings.gus_bir_key or "").strip()
    if not key:
        return None
    try:
        sid = _bir_wynik(_bir_post(
            "Zaloguj", f"<ns:Zaloguj><ns:pKluczUzytkownika>{html.escape(key)}"
                       "</ns:pKluczUzytkownika></ns:Zaloguj>"), "Zaloguj")
        if not sid:
            logger.warning("bir.lookup.no_session", extra={"nip": clean})
            return None
        dane = _bir_wynik(_bir_post(
            "DaneSzukajPodmioty",
            "<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania>"
            f"<dat:Nip>{clean}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>",
            sid=sid), "DaneSzukajPodmioty")
        return _bir_z_xml(dane, clean) if dane else None
    except Exception as exc:  # sieć/timeout/format — zapas: MF
        logger.warning("bir.lookup.error", extra={"nip": clean, "error": str(exc)})
        return None


def gus_lookup(nip: str) -> dict:
    """Dane firmy po NIP: GUS BIR (gdy klucz) → MF (darmowe) → dataport (zapas)."""
    clean = _clean_nip(nip)
    company = _lookup_bir(clean) if (settings.gus_bir_key or "").strip() else None
    if company:
        return company
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
