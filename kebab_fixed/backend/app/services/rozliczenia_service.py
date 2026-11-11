"""Rozliczenia z odbiorcami — karta klienta, lista kontrahentów i zapisy biura
(faktury, wpłaty z podglądem, saldo otwarcia, ustawienia, dziennik).

Księgi WZ i FV klienta budowane są z bazy i liczone wyłącznie przez
`rozliczenia_ksiega.rozlicz_ksiege` (jedno źródło sald dla panelu i wydruków).

Wejście księgi:
  * dokumenty — aktywne (`stan_zrodla='aktywny'`), nieusunięte, w walucie
    kontrahenta, z kwotą > 0;
  * dokument z kwotą < 0 (faktura korygująca) staje się kredytem;
  * saldo otwarcia ujemne — najstarszy dokument „Saldo otwarcia”, dodatnie —
    kredyt z datą startu;
  * wpłaty nieusunięte — kredyty;
  * dokumenty i wpłaty liczą się od daty startu włącznie (wcześniejsze są
    w saldzie otwarcia).
Dokumenty, wpłaty i salda otwarcia w innej walucie niż kontrahent nie wchodzą
do sum — są zgłaszane (`inna_waluta`, z polem `rodzaj`). Niewycenione WZ
trafiają na listę „czeka na ceny”.

Na granicy API kwoty to `float` zaokrąglony do 2 miejsc, daty — ISO.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, execute, query_all, query_one, transaction
from app.services.rozliczenia_ksiega import (grosze, na_dzien as _na_dzien,
                                             rozlicz_ksiege, stan_dokumentu,
                                             waluta_z_nip)
from app.services.rozliczenia_wz import (data_startu, historia, synchronizuj_wz,
                                         zablokuj_ksiege_wz)
from app.utils.ids import cuid

KSIEGI = ("wz", "fv")
_ZERO = Decimal("0.00")

_SQL_KLIENT = ("SELECT id, name, display_name, nip, settlement_currency, rozl_termin_wz, "
               "       rozl_termin_fv, rozl_forma_wz, rozl_forma_fv, rozl_notatka "
               "FROM clients")
_SQL_DOKUMENTY = ("SELECT id, client_id, ksiega, zrodlo, numer, data_dok, kwota, waluta, "
                  "       termin, forma, stan_zrodla, brak_vat, uwagi "
                  "FROM rozl_dokumenty WHERE usuniety_at IS NULL")
_SQL_WPLATY = ("SELECT id, client_id, ksiega, forma, kwota, waluta, data, dokument_id, "
               "       uwagi, utworzyl "
               "FROM rozl_wplaty WHERE usuniety_at IS NULL")
_SQL_OTWARCIA = "SELECT client_id, ksiega, kwota, waluta, zalegle_od, uwagi FROM rozl_otwarcia"


# ── Konwersje na granicy API ────────────────────────────────────────────

def _f(x: Any) -> float:
    return float(grosze(x))


def _d(x: Optional[date]) -> Optional[str]:
    return x.isoformat() if x is not None else None


# ── Budowa ksiąg (bez bazy) ─────────────────────────────────────────────

def _nazwa(k: dict) -> str:
    return k.get("display_name") or k["name"]


def _wejscie_ksiegi(klient: dict, ksiega: str, dokumenty: list[dict], wplaty: list[dict],
                    otwarcie: Optional[dict], start: date) -> tuple[list, list]:
    """Dokumenty i kredyty jednej księgi (dokumenty już odfiltrowane: aktywne,
    w walucie kontrahenta, tej księgi)."""
    docs: list[dict] = []
    kredyty: list[dict] = []
    for r in dokumenty:
        kwota = grosze(r["kwota"])
        if kwota > 0:
            docs.append({"id": r["id"], "numer": r["numer"], "data": r["data_dok"],
                         "kwota": kwota, "termin": r["termin"], "forma": r["forma"],
                         "uwagi": r["uwagi"] or "", "zrodlo": r["zrodlo"],
                         "brak_vat": bool(r["brak_vat"]), "otwarcie": False})
        elif kwota < 0:
            kredyty.append({"id": r["id"], "data": r["data_dok"], "kwota": -kwota,
                            "dokument_id": None, "rodzaj": "korekta", "numer": r["numer"],
                            "forma": "", "uwagi": r["uwagi"] or ""})
    if otwarcie is not None:
        kwota = grosze(otwarcie["kwota"])
        oid = f"otwarcie-{ksiega}"
        if kwota < 0:
            dzien = otwarcie["zalegle_od"] or start
            docs.append({"id": oid, "numer": "Saldo otwarcia", "data": dzien,
                         "kwota": -kwota, "termin": dzien,
                         "forma": klient[f"rozl_forma_{ksiega}"],
                         "uwagi": otwarcie["uwagi"] or "", "zrodlo": "otwarcie",
                         "brak_vat": False, "otwarcie": True})
        elif kwota > 0:
            kredyty.append({"id": oid, "data": start, "kwota": kwota, "dokument_id": None,
                            "rodzaj": "otwarcie", "numer": "Saldo otwarcia", "forma": "",
                            "uwagi": otwarcie["uwagi"] or ""})
    for w in wplaty:
        kredyty.append({"id": w["id"], "data": w["data"], "kwota": grosze(w["kwota"]),
                        "dokument_id": w["dokument_id"], "rodzaj": "wplata", "numer": "",
                        "forma": w["forma"], "uwagi": w["uwagi"] or "",
                        "utworzyl": w["utworzyl"] or "", "ksiega": ksiega})
    return docs, kredyty


def _zbuduj(klient: dict, dokumenty: list[dict], wplaty: list[dict], otwarcia: list[dict],
            start: date, na_dzien: Optional[date], dzis: date) -> dict:
    """Księgi WZ/FV klienta z wierszy bazy (wspólne dla karty i listy)."""
    waluta = klient["settlement_currency"]
    # Pozycje sprzed startu siedzą w saldzie otwarcia (spec 5) — także wtedy,
    # gdy biuro przesunęło datę startu po zapisaniu dokumentów i wpłat.
    dokumenty = [r for r in dokumenty if r["data_dok"] >= start]
    wplaty = [w for w in wplaty if w["data"] >= start]
    # Pozycje w innej walucie nie wchodzą do sum, ale nie znikają po cichu.
    inna_waluta = (
        [{"id": r["id"], "numer": r["numer"], "data": r["data_dok"], "kwota": r["kwota"],
          "waluta": r["waluta"], "rodzaj": "dokument"}
         for r in dokumenty if r["stan_zrodla"] == "aktywny" and r["waluta"] != waluta]
        + [{"id": w["id"], "numer": "Wpłata", "data": w["data"], "kwota": w["kwota"],
            "waluta": w["waluta"], "rodzaj": "wplata"}
           for w in wplaty if w["waluta"] != waluta]
        + [{"id": f"otwarcie-{o['ksiega']}", "numer": "Saldo otwarcia",
            "data": o["zalegle_od"] or start, "kwota": o["kwota"], "waluta": o["waluta"],
            "rodzaj": "otwarcie"}
           for o in otwarcia if o["waluta"] != waluta])
    wplaty = [w for w in wplaty if w["waluta"] == waluta]
    otwarcia = [o for o in otwarcia if o["waluta"] == waluta]
    czeka = [r for r in dokumenty if r["stan_zrodla"] == "czeka_na_ceny"]
    wynik: dict[str, Any] = {"klient": klient, "inna_waluta": inna_waluta,
                             "czeka_na_ceny": czeka}
    for ksiega in KSIEGI:
        docs, kredyty = _wejscie_ksiegi(
            klient, ksiega,
            [r for r in dokumenty if r["ksiega"] == ksiega and r["stan_zrodla"] == "aktywny"
             and r["waluta"] == waluta],
            [w for w in wplaty if w["ksiega"] == ksiega],
            next((o for o in otwarcia if o["ksiega"] == ksiega), None), start)
        if na_dzien is not None:
            docs, kredyty = _na_dzien(docs, kredyty, na_dzien)
        k = rozlicz_ksiege(docs, kredyty)
        po_terminie, najstarsza = _ZERO, 0
        for d in k["dokumenty"]:
            d["stan"] = stan_dokumentu(d, dzis)
            if d["stan"]["kod"] == "po_terminie":
                po_terminie += d["zostalo"]
                najstarsza = max(najstarsza, d["stan"]["dni"])
        k["po_terminie"] = po_terminie
        k["najstarsza_dni"] = najstarsza
        wynik[ksiega] = k
    return wynik


# ── Odczyt z bazy ───────────────────────────────────────────────────────

def _klient(client_id: str) -> dict:
    row = query_one(_SQL_KLIENT + " WHERE id=%s", (client_id,))
    if not row:
        raise HTTPException(404, "Kontrahent nie znaleziony")
    return row


def ksiegi_klienta(client_id: str, na_dzien: Optional[date] = None,
                   dzis: Optional[date] = None) -> dict:
    """Księgi WZ i FV klienta (wewnętrzny budulec karty, zestawień, zapisów).

    Nie synchronizuje WZ — robią to funkcje publiczne, raz na żądanie.
    """
    klient = _klient(client_id)
    return _zbuduj(
        klient,
        query_all(_SQL_DOKUMENTY + " AND client_id=%s", (client_id,)),
        query_all(_SQL_WPLATY + " AND client_id=%s", (client_id,)),
        query_all(_SQL_OTWARCIA + " WHERE client_id=%s", (client_id,)),
        data_startu(), na_dzien, dzis or date.today())


def _dok_json(d: dict) -> dict:
    return {"id": d["id"], "numer": d["numer"], "data": _d(d["data"]),
            "kwota": _f(d["kwota"]), "zaplacono": _f(d["zaplacono"]),
            "zostalo": _f(d["zostalo"]), "termin": _d(d["termin"]), "forma": d["forma"],
            "uwagi": d["uwagi"], "zrodlo": d["zrodlo"], "otwarcie": bool(d["otwarcie"]),
            "stan": d["stan"], "zamkniety": _d(d["zamkniety"]),
            "brak_vat": bool(d["brak_vat"])}


def _najnowsze(dokumenty: list[dict]) -> list[dict]:
    return sorted(dokumenty, key=lambda d: (d["data"], str(d["numer"]), str(d["id"])),
                  reverse=True)


def karta(client_id: str, dzis: Optional[date] = None, od: Optional[date] = None,
          do: Optional[date] = None) -> dict:
    """Karta klienta: salda obu ksiąg, dokumenty (najnowsze na górze), wpłaty,
    salda otwarcia, ostrzeżenia i dziennik. Filtr `od`/`do` (po dacie
    dokumentu) zawęża tylko listę dokumentów — salda zawsze pełne."""
    synchronizuj_wz()
    dzis = dzis or date.today()
    k = ksiegi_klienta(client_id, dzis=dzis)
    klient = k["klient"]
    wz, fv = k["wz"], k["fv"]

    def w_okresie(d: dict) -> bool:
        return (od is None or d["data"] >= od) and (do is None or d["data"] <= do)

    numery = {d["id"]: d["numer"] for ks in KSIEGI for d in k[ks]["dokumenty"]}
    wplaty = []
    for ks in KSIEGI:
        for kr in k[ks]["kredyty"]:
            if kr["rodzaj"] != "wplata":
                continue
            wplaty.append({
                "id": kr["id"], "ksiega": ks, "forma": kr["forma"], "kwota": _f(kr["kwota"]),
                "data": kr["data"], "uwagi": kr["uwagi"], "utworzyl": kr["utworzyl"],
                "dokument_id": kr["dokument_id"],
                "przydzialy": [{"numer": numery[p["dokument_id"]], "kwota": _f(p["kwota"])}
                               for p in kr["przydzialy"]],
                "reszta": _f(kr["reszta"])})
    wplaty.sort(key=lambda w: (w["data"], w["id"]), reverse=True)
    for w in wplaty:
        w["data"] = _d(w["data"])

    otwarcia = {o["ksiega"]: o for o in query_all(
        _SQL_OTWARCIA + " WHERE client_id=%s", (client_id,))}
    dziennik = query_all(
        "SELECT id, tresc, przypomnij, odhaczono_at, kto, kiedy FROM rozl_dziennik "
        "WHERE client_id=%s ORDER BY kiedy DESC, id DESC", (client_id,))
    podpowiedz = waluta_z_nip(klient["nip"])

    return {
        "klient": {"id": klient["id"], "nazwa": _nazwa(klient), "nip": klient["nip"] or "",
                   "waluta": klient["settlement_currency"],
                   "termin_wz": klient["rozl_termin_wz"], "termin_fv": klient["rozl_termin_fv"],
                   "forma_wz": klient["rozl_forma_wz"], "forma_fv": klient["rozl_forma_fv"],
                   "notatka": klient["rozl_notatka"] or "",
                   "waluta_podpowiedz": (podpowiedz if podpowiedz != klient["settlement_currency"]
                                         else None)},
        "start": data_startu().isoformat(),
        "saldo": {"wz": _f(wz["saldo"]), "fv": _f(fv["saldo"]),
                  "lacznie": _f(wz["saldo"] + fv["saldo"]),
                  "po_terminie_wz": _f(wz["po_terminie"]), "po_terminie_fv": _f(fv["po_terminie"]),
                  "najstarsza_dni_wz": wz["najstarsza_dni"],
                  "najstarsza_dni_fv": fv["najstarsza_dni"]},
        "otwarcia": {ks: ({"kwota": _f(otwarcia[ks]["kwota"]),
                           "zalegle_od": _d(otwarcia[ks]["zalegle_od"]),
                           "uwagi": otwarcia[ks]["uwagi"] or ""} if ks in otwarcia else None)
                     for ks in KSIEGI},
        "dokumenty": {ks: [_dok_json(d) for d in _najnowsze(k[ks]["dokumenty"]) if w_okresie(d)]
                      for ks in KSIEGI},
        "wplaty": wplaty,
        "czeka_na_ceny": [{"id": r["id"], "numer": r["numer"], "data": _d(r["data_dok"])}
                          for r in k["czeka_na_ceny"]],
        "inna_waluta": [{**r, "data": _d(r["data"]), "kwota": _f(r["kwota"])}
                        for r in k["inna_waluta"]],
        "dziennik": [{"id": r["id"], "tresc": r["tresc"], "przypomnij": _d(r["przypomnij"]),
                      "odhaczono": (r["odhaczono_at"].isoformat() if r["odhaczono_at"] else None),
                      "kto": r["kto"], "kiedy": r["kiedy"].isoformat()} for r in dziennik],
    }


# ── Lista kontrahentów ──────────────────────────────────────────────────

def _stan_klienta(wz: dict, fv: dict) -> str:
    if wz["po_terminie"] + fv["po_terminie"] > 0:
        return "po_terminie"
    if wz["do_zaplaty"] + fv["do_zaplaty"] > 0:
        return "w_terminie"
    if wz["nadplata"] + fv["nadplata"] > 0:
        return "nadplata"
    return "rozliczony"


def lista(dzis: Optional[date] = None) -> dict:
    """Lista kontrahentów z saldami i podsumowanie per waluta.

    Księgi wszystkich klientów liczone z zapytań zbiorczych (bez zapytania
    per klient). Na liście są klienci z nieusuniętym dokumentem (poza
    anulowanymi), wpłatą albo niezerowym saldem otwarcia."""
    synchronizuj_wz()
    dzis = dzis or date.today()
    start = data_startu()
    klienci = {k["id"]: k for k in query_all(_SQL_KLIENT)}
    dokumenty: dict[str, list] = defaultdict(list)
    for r in query_all(_SQL_DOKUMENTY + " AND client_id IS NOT NULL AND data_dok >= %s",
                       (start,)):
        dokumenty[r["client_id"]].append(r)
    wplaty: dict[str, list] = defaultdict(list)
    for r in query_all(_SQL_WPLATY + " AND data >= %s", (start,)):
        wplaty[r["client_id"]].append(r)
    otwarcia: dict[str, list] = defaultdict(list)
    for r in query_all(_SQL_OTWARCIA):
        otwarcia[r["client_id"]].append(r)
    z_przypomnieniem = {r["client_id"] for r in query_all(
        "SELECT DISTINCT client_id FROM rozl_dziennik "
        "WHERE przypomnij <= %s AND odhaczono_at IS NULL", (dzis,))}
    bez_kontrahenta = [
        {"id": r["id"], "numer": r["numer"], "data": _d(r["data_dok"]), "kwota": _f(r["kwota"]),
         "waluta": r["waluta"], "nabywca": r["buyer_name"] or ""}
        for r in query_all(
            "SELECT d.id, d.numer, d.data_dok, d.kwota, d.waluta, w.buyer_name "
            "FROM rozl_dokumenty d LEFT JOIN wz_documents w ON w.id = d.source_id "
            "WHERE d.client_id IS NULL AND d.zrodlo='mes_wz' AND d.usuniety_at IS NULL "
            "  AND d.stan_zrodla <> 'anulowany' AND d.data_dok >= %s "
            "ORDER BY d.data_dok, d.numer", (start,))]

    zero = {"naleznosci": _ZERO, "po_terminie": _ZERO, "gotowka_wz": _ZERO, "nadplaty": _ZERO}
    podsumowanie: dict[str, dict] = {"PLN": dict(zero), "EUR": dict(zero)}
    kontrahenci = []
    inna_waluta = 0
    for cid, klient in klienci.items():
        docs = [r for r in dokumenty[cid] if r["stan_zrodla"] != "anulowany"]
        otw = [o for o in otwarcia[cid] if grosze(o["kwota"]) != 0]
        if not docs and not wplaty[cid] and not otw:
            continue
        k = _zbuduj(klient, docs, wplaty[cid], otw, start, None, dzis)
        wz, fv = k["wz"], k["fv"]
        inna_waluta += len(k["inna_waluta"])
        otwarte = [d for ks in KSIEGI for d in k[ks]["dokumenty"] if d["zostalo"] > 0]
        terminy = [d["stan"]["dni"] for d in otwarte if d["stan"]["kod"] != "po_terminie"]
        kontrahenci.append({
            "id": cid, "nazwa": _nazwa(klient), "nip": klient["nip"] or "",
            "waluta": klient["settlement_currency"],
            "saldo_wz": _f(wz["saldo"]), "saldo_fv": _f(fv["saldo"]),
            "saldo": _f(wz["saldo"] + fv["saldo"]),
            "po_terminie": _f(wz["po_terminie"] + fv["po_terminie"]),
            "najstarsza_dni": max(wz["najstarsza_dni"], fv["najstarsza_dni"]),
            "najblizszy_termin_dni": min(terminy) if terminy else None,
            "stan": _stan_klienta(wz, fv),
            "przypomnienie": cid in z_przypomnieniem})
        suma = podsumowanie.setdefault(klient["settlement_currency"], dict(zero))
        suma["naleznosci"] += wz["do_zaplaty"] + fv["do_zaplaty"]
        suma["po_terminie"] += wz["po_terminie"] + fv["po_terminie"]
        suma["nadplaty"] += wz["nadplata"] + fv["nadplata"]
        suma["gotowka_wz"] += sum((d["zostalo"] for d in wz["dokumenty"]
                                   if d["forma"] == "gotowka"), _ZERO)
    # Rozliczeni zawsze na końcu (spec 8.1), reszta: najdłużej zalegający na górze.
    kontrahenci.sort(key=lambda r: (r["stan"] == "rozliczony", -r["najstarsza_dni"],
                                    r["saldo"]))
    return {"start": start.isoformat(),
            "podsumowanie": {w: {p: _f(v) for p, v in s.items()}
                             for w, s in podsumowanie.items()},
            "kontrahenci": kontrahenci, "bez_kontrahenta": bez_kontrahenta,
            "inna_waluta": inna_waluta}


# ── Szczegóły dokumentu ─────────────────────────────────────────────────

def dokument(dokument_id: str) -> dict:
    """Dokument z rozliczeniem (`Dok`), wpłatami, które go pokryły,
    i historią zmian (od najstarszej)."""
    wynik, pokrycie = _dok_z_rozliczeniem(dokument_id)
    wpisy = query_all(
        "SELECT akcja, opis, przed, po, powod, kto, kiedy FROM rozl_historia "
        "WHERE obiekt='dokument' AND obiekt_id=%s ORDER BY kiedy, id", (dokument_id,))
    return {**wynik, "pokrycie": pokrycie,
            "historia": [{**h, "kiedy": h["kiedy"].isoformat()} for h in wpisy]}


def _dok_z_rozliczeniem(dokument_id: str) -> tuple[dict, list]:
    """`Dok` (stan z bieżącego rozliczenia księgi) i lista wpłat, które go pokryły."""
    row = query_one("SELECT d.*, c.settlement_currency FROM rozl_dokumenty d "
                    "LEFT JOIN clients c ON c.id = d.client_id WHERE d.id=%s", (dokument_id,))
    if not row:
        raise HTTPException(404, "Dokument nie znaleziony")
    wynik, pokrycie = None, []
    if row["client_id"] and row["settlement_currency"]:
        k = ksiegi_klienta(row["client_id"])
        ks = k[row["ksiega"]]
        d = next((d for d in ks["dokumenty"] if d["id"] == dokument_id), None)
        if d is not None:
            wynik = _dok_json(d)
            kredyty = {kr["id"]: kr for kr in ks["kredyty"]}
            for p in d["pokrycie"]:
                kr = kredyty[p["kredyt_id"]]
                uwagi = kr["uwagi"]
                if kr["rodzaj"] != "wplata":
                    uwagi = " ".join(x for x in (kr["numer"], uwagi) if x)
                pokrycie.append({"data": _d(kr["data"]), "forma": kr["forma"],
                                 "kwota": _f(p["kwota"]), "uwagi": uwagi})
    if wynik is None:
        wynik = _dok_poza_ksiega(row)
    return wynik, pokrycie


def _dok_poza_ksiega(row: dict) -> dict:
    """Dokument, który nie bierze udziału w rozliczeniu (usunięty, anulowany,
    czeka na ceny, korekta, inna waluta, bez kontrahenta)."""
    if row["usuniety_at"] is not None:
        kod = "usuniety"
    elif row["stan_zrodla"] != "aktywny":
        kod = row["stan_zrodla"]
    elif row["settlement_currency"] and row["waluta"] != row["settlement_currency"]:
        kod = "inna_waluta"
    elif grosze(row["kwota"]) < 0:
        kod = "korekta"
    else:
        kod = "bez_kontrahenta"
    return {"id": row["id"], "numer": row["numer"], "data": _d(row["data_dok"]),
            "kwota": _f(row["kwota"]), "zaplacono": 0.0, "zostalo": 0.0,
            "termin": _d(row["termin"]), "forma": row["forma"], "uwagi": row["uwagi"] or "",
            "zrodlo": row["zrodlo"], "otwarcie": False,
            "stan": {"kod": kod, "dni": 0, "czesciowo": False},
            "zamkniety": None, "brak_vat": bool(row["brak_vat"])}


# ═══ Zapisy biura ═══════════════════════════════════════════════════════
#
# Każdy zapis i jego wiersze historii idą w jednej transakcji. Zapisy do
# `rozl_dokumenty` biorą najpierw blokadę księgi WZ — nie mogą ścigać się
# z synchronizacją. Pieniądze przychodzą jako liczby (parsowanie polskiego
# tekstu robi warstwa tras) i zamieniane są na `Decimal(str(x))`.

FORMY = ("gotowka", "przelew")
WALUTY = ("PLN", "EUR")
_MAX_KWOTA = Decimal("1e12")  # NUMERIC(14,2)


def _kwota(x: Any) -> Decimal:
    """Kwota z liczby: skończona, w groszach, mieszcząca się w NUMERIC(14,2)."""
    try:
        d = Decimal(str(x))
    except (ArithmeticError, ValueError, TypeError):
        raise HTTPException(400, "Nieprawidłowa kwota")
    if isinstance(x, bool) or not d.is_finite():
        raise HTTPException(400, "Nieprawidłowa kwota")
    d = grosze(d)
    if abs(d) >= _MAX_KWOTA:
        raise HTTPException(400, "Kwota jest za duża")
    return d


def _data(x: Any, pole: str) -> date:
    if isinstance(x, date):
        return x
    if isinstance(x, str):
        try:
            return date.fromisoformat(x)
        except ValueError:
            pass
    raise HTTPException(400, f"Nieprawidłowa data: {pole}")


def _ksiega(ksiega: str) -> str:
    if ksiega not in KSIEGI:
        raise HTTPException(400, "Księga musi być WZ albo FV")
    return ksiega


def _forma(forma: Any) -> str:
    if forma not in FORMY:
        raise HTTPException(400, "Forma płatności musi być gotówka albo przelew")
    return forma


def _pl(d: date) -> str:
    return d.strftime("%d.%m.%Y")


def _po_starcie(d: date, co: str) -> None:
    start = data_startu()
    if d < start:
        raise HTTPException(400, f"{co} sprzed daty startu rozliczeń ({_pl(start)}) "
                                 "jest już w saldzie otwarcia")


def _json(x: Any) -> Any:
    """Wartość pola do `przed/po` w historii."""
    if isinstance(x, Decimal):
        return float(x)
    if isinstance(x, date):
        return x.isoformat()
    return x


def _powod(powod: Optional[str], komunikat: str) -> str:
    powod = (powod or "").strip()
    if not powod:
        raise HTTPException(400, komunikat)
    return powod


def _dok(dokument_id: str) -> dict:
    return _dok_z_rozliczeniem(dokument_id)[0]


def _klient_cx(conn, client_id: str, zablokuj: bool = False) -> dict:
    row = cx_query_one(conn, _SQL_KLIENT + " WHERE id=%s" + (" FOR UPDATE" if zablokuj else ""),
                       (client_id,))
    if not row:
        raise HTTPException(404, "Kontrahent nie znaleziony")
    return row


def _numer_wolny(conn, client_id: str, numer: str, poza_id: str = "") -> None:
    if cx_query_one(conn, "SELECT 1 FROM rozl_dokumenty WHERE client_id=%s AND numer=%s "
                          "AND ksiega='fv' AND usuniety_at IS NULL AND id<>%s",
                    (client_id, numer, poza_id)):
        raise HTTPException(400, f"Faktura {numer} jest już wpisana temu kontrahentowi")


# ── Faktury i edycja dokumentów ─────────────────────────────────────────

def dodaj_fakture(client_id: str, *, numer: str, data: date, kwota: Any,
                  termin: Optional[date], forma: Optional[str], uwagi: str,
                  kto: str) -> dict:
    """Ręczna faktura w księdze FV (kwota ujemna = korekta). Zwraca `Dok`."""
    numer = (numer or "").strip()
    if not numer:
        raise HTTPException(400, "Podaj numer faktury")
    data = _data(data, "data faktury")
    k = _kwota(kwota)
    if k == 0:
        raise HTTPException(400, "Kwota faktury nie może być zerowa")
    _po_starcie(data, "Faktura")
    dok_id = cuid()
    with transaction() as conn:
        zablokuj_ksiege_wz(conn)
        klient = _klient_cx(conn, client_id)
        termin = (_data(termin, "termin") if termin is not None
                  else data + timedelta(days=klient["rozl_termin_fv"]))
        if termin < data:
            raise HTTPException(400, "Termin płatności nie może być przed datą faktury")
        forma = _forma(forma if forma is not None else klient["rozl_forma_fv"])
        _numer_wolny(conn, client_id, numer)
        cx_execute(
            conn,
            "INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, numer, data_dok, "
            " kwota, waluta, termin, forma, uwagi, utworzyl) "
            "VALUES (%s,%s,'fv','reczna',%s,%s,%s,%s,%s,%s,%s,%s)",
            (dok_id, client_id, numer, data, k, klient["settlement_currency"], termin, forma,
             uwagi or "", kto or ""))
        historia(conn, client_id=client_id, obiekt="dokument", obiekt_id=dok_id,
                 akcja="dodano", opis=f"dodano fakturę {numer}",
                 po={"kwota": float(k), "termin": termin.isoformat(), "forma": forma},
                 kto=kto)
    return _dok(dok_id)


_POLA_KAZDEGO = ("termin", "forma", "uwagi")
_POLA_RECZNEJ = ("kwota", "numer", "data")
_KOLUMNA = {"termin": "termin", "forma": "forma", "uwagi": "uwagi", "kwota": "kwota",
            "numer": "numer", "data": "data_dok"}
_OPIS_POLA = {"termin": "termin płatności", "forma": "forma płatności", "uwagi": "uwagi",
              "kwota": "kwota", "numer": "numer", "data": "data dokumentu"}


def edytuj_dokument(dokument_id: str, zmiany: dict, kto: str, powod: str = "") -> dict:
    """Zmiana pól dokumentu. `termin`/`forma`/`uwagi` — każdy dokument (ręczny
    termin przeżywa synchronizację WZ); `kwota`/`numer`/`data` — tylko ręczne
    (zmiana kwoty z powodem). Każde zmienione pole → wiersz historii."""
    nieznane = set(zmiany) - set(_POLA_KAZDEGO) - set(_POLA_RECZNEJ)
    if nieznane:
        raise HTTPException(400, f"Nie można zmienić pola: {', '.join(sorted(nieznane))}")
    with transaction() as conn:
        zablokuj_ksiege_wz(conn)
        dok = cx_query_one(conn, "SELECT * FROM rozl_dokumenty WHERE id=%s FOR UPDATE",
                           (dokument_id,))
        if not dok:
            raise HTTPException(404, "Dokument nie znaleziony")
        if dok["usuniety_at"] is not None:
            raise HTTPException(400, "Dokument jest usunięty")
        if dok["zrodlo"] != "reczna" and set(zmiany) & set(_POLA_RECZNEJ):
            raise HTTPException(400, "Kwotę, numer i datę WZ zmienia się w dokumentach WZ")

        nowe: dict[str, Any] = {}
        for pole, wartosc in zmiany.items():
            if pole in ("termin", "data"):
                wartosc = _data(wartosc, _OPIS_POLA[pole])
            elif pole == "forma":
                wartosc = _forma(wartosc)
            elif pole == "uwagi":
                wartosc = str(wartosc or "")
            elif pole == "numer":
                wartosc = str(wartosc or "").strip()
                if not wartosc:
                    raise HTTPException(400, "Podaj numer faktury")
            elif pole == "kwota":
                wartosc = _kwota(wartosc)
                if wartosc == 0:
                    raise HTTPException(400, "Kwota faktury nie może być zerowa")
            if wartosc != dok[_KOLUMNA[pole]]:
                nowe[pole] = wartosc
        if not nowe:
            return _dok(dokument_id)

        if "kwota" in nowe:
            powod = _powod(powod, "Podaj powód zmiany kwoty")
        if "data" in nowe:
            _po_starcie(nowe["data"], "Faktura")
        if "numer" in nowe and dok["ksiega"] == "fv":
            _numer_wolny(conn, dok["client_id"], nowe["numer"], dokument_id)
        if nowe.get("termin", dok["termin"]) < nowe.get("data", dok["data_dok"]):
            raise HTTPException(400, "Termin płatności nie może być przed datą dokumentu")

        ustaw = [f"{_KOLUMNA[p]}=%s" for p in nowe]
        if "termin" in nowe:
            ustaw.append("termin_reczny=true")
        cx_execute(conn, f"UPDATE rozl_dokumenty SET {', '.join(ustaw)} WHERE id=%s",
                   (*nowe.values(), dokument_id))
        for pole, wartosc in nowe.items():
            przed = _json(dok[_KOLUMNA[pole]])
            po = _json(wartosc)
            historia(conn, client_id=dok["client_id"], obiekt="dokument",
                     obiekt_id=dokument_id,
                     akcja=pole if pole in ("kwota", "termin", "forma", "uwagi") else "zmiana",
                     opis=f"{dok['numer']}: {_OPIS_POLA[pole]} zmieniona z {przed} na {po}",
                     przed={pole: przed}, po={pole: po}, powod=powod, kto=kto)
    return _dok(dokument_id)


def usun_dokument(dokument_id: str, powod: str, kto: str) -> None:
    """Miękkie usunięcie dokumentu wpisanego ręcznie (z powodem). Wpłaty do niego
    przypięte nie giną — w rozliczeniu idą na najstarsze otwarte dokumenty."""
    with transaction() as conn:
        zablokuj_ksiege_wz(conn)
        dok = cx_query_one(conn, "SELECT id, client_id, zrodlo, numer, kwota, usuniety_at "
                                 "FROM rozl_dokumenty WHERE id=%s FOR UPDATE", (dokument_id,))
        if not dok:
            raise HTTPException(404, "Dokument nie znaleziony")
        if dok["zrodlo"] == "mes_wz":
            raise HTTPException(400, "WZ anuluje się w dokumentach WZ")
        if dok["zrodlo"] != "reczna":
            raise HTTPException(400, "Fakturę z Subiekta poprawia się w Subiekcie")
        if dok["usuniety_at"] is not None:
            raise HTTPException(400, "Dokument jest już usunięty")
        powod = _powod(powod, "Podaj powód usunięcia")
        cx_execute(conn, "UPDATE rozl_dokumenty SET usuniety_at=now(), usuniety_przez=%s, "
                         "powod_usuniecia=%s WHERE id=%s", (kto or "", powod, dokument_id))
        historia(conn, client_id=dok["client_id"], obiekt="dokument", obiekt_id=dokument_id,
                 akcja="usunieto", opis=f"usunięto {dok['numer']}",
                 przed={"kwota": float(dok["kwota"])}, powod=powod, kto=kto)


# ── Wpłaty ──────────────────────────────────────────────────────────────

_NOWA_WPLATA = "__nowa_wplata__"


def _podglad(client_id: str, ksiega: str, kwota: Decimal, dokument_id: Optional[str],
             data: date) -> dict:
    """Co rozliczy wpłata: księga przeliczona z dopisanym hipotetycznym
    kredytem, porównana dokument po dokumencie ze stanem bieżącym."""
    teraz = ksiegi_klienta(client_id)[ksiega]
    if dokument_id is not None and dokument_id not in {d["id"] for d in teraz["dokumenty"]}:
        raise HTTPException(400, "Wskazany dokument nie należy do tej księgi kontrahenta")
    po = rozlicz_ksiege(teraz["dokumenty"], teraz["kredyty"] + [
        {"id": _NOWA_WPLATA, "data": data, "kwota": kwota, "dokument_id": dokument_id}])
    przed = {d["id"]: d["zostalo"] for d in teraz["dokumenty"]}
    przydzialy = []
    for d in po["dokumenty"]:
        roznica = przed[d["id"]] - d["zostalo"]
        if roznica > 0:
            przydzialy.append({"dokument_id": d["id"], "numer": d["numer"],
                               "kwota": _f(roznica), "zostalo_przed": _f(przed[d["id"]]),
                               "zostalo_po": _f(d["zostalo"]), "zamyka": d["zostalo"] == 0})
    # Wskazany dokument pokrywany jest pierwszy — tak też go pokazujemy.
    przydzialy.sort(key=lambda p: p["dokument_id"] != dokument_id)
    return {"przydzialy": przydzialy, "nadwyzka": _f(po["nadplata"] - teraz["nadplata"])}


def _wplata_dane(client_id: str, ksiega: str, kwota: Any, data: Any) -> tuple[Decimal, date]:
    _ksiega(ksiega)
    k = _kwota(kwota)
    if k <= 0:
        raise HTTPException(400, "Kwota wpłaty musi być większa od zera")
    data = _data(data, "data wpłaty")
    _klient(client_id)
    _po_starcie(data, "Wpłata")
    return k, data


def podglad_wplaty(client_id: str, *, ksiega: str, kwota: Any,
                   dokument_id: Optional[str] = None, data: Optional[date] = None) -> dict:
    """Podgląd rozliczenia wpłaty — bez zapisu."""
    k, data = _wplata_dane(client_id, ksiega, kwota, data or date.today())
    synchronizuj_wz()
    return _podglad(client_id, ksiega, k, dokument_id, data)


def dodaj_wplate(client_id: str, *, ksiega: str, forma: str, kwota: Any, data: date,
                 dokument_id: Optional[str], uwagi: str, kto: str) -> dict:
    """Wpłata w walucie kontrahenta. Zwraca podgląd rozliczenia i `id`."""
    k, data = _wplata_dane(client_id, ksiega, kwota, data)
    _forma(forma)
    synchronizuj_wz()
    wynik = _podglad(client_id, ksiega, k, dokument_id, data)
    wplata_id = cuid()
    with transaction() as conn:
        klient = _klient_cx(conn, client_id)
        cx_execute(
            conn,
            "INSERT INTO rozl_wplaty (id, client_id, ksiega, forma, kwota, waluta, data, "
            " dokument_id, uwagi, utworzyl) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (wplata_id, client_id, ksiega, forma, k, klient["settlement_currency"], data,
             dokument_id, uwagi or "", kto or ""))
        historia(conn, client_id=client_id, obiekt="wplata", obiekt_id=wplata_id,
                 akcja="dodano", opis=f"wpłata {grosze(k)} {klient['settlement_currency']} "
                                      f"do księgi {ksiega.upper()}",
                 po={"kwota": float(k), "ksiega": ksiega, "forma": forma,
                     "data": data.isoformat()}, kto=kto)
    return {**wynik, "id": wplata_id}


def usun_wplate(wplata_id: str, powod: str, kto: str) -> None:
    """Miękkie usunięcie wpłaty (z powodem); rozliczenie przelicza się od zera."""
    with transaction() as conn:
        w = cx_query_one(conn, "SELECT id, client_id, ksiega, kwota, usuniety_at "
                               "FROM rozl_wplaty WHERE id=%s FOR UPDATE", (wplata_id,))
        if not w:
            raise HTTPException(404, "Wpłata nie znaleziona")
        if w["usuniety_at"] is not None:
            raise HTTPException(400, "Wpłata jest już usunięta")
        powod = _powod(powod, "Podaj powód usunięcia")
        cx_execute(conn, "UPDATE rozl_wplaty SET usuniety_at=now(), usuniety_przez=%s, "
                         "powod_usuniecia=%s WHERE id=%s", (kto or "", powod, wplata_id))
        historia(conn, client_id=w["client_id"], obiekt="wplata", obiekt_id=wplata_id,
                 akcja="usunieto", opis=f"usunięto wpłatę {grosze(w['kwota'])}",
                 przed={"kwota": float(w["kwota"])}, powod=powod, kto=kto)


# ── Saldo otwarcia ──────────────────────────────────────────────────────

def ustaw_otwarcie(client_id: str, ksiega: str, *, kwota: Any, zalegle_od: Optional[date],
                   uwagi: str, kto: str) -> None:
    """Saldo otwarcia księgi (minus dług, plus nadpłata) w walucie kontrahenta.
    Każde zmienione pole → wiersz historii `zmiana`."""
    _ksiega(ksiega)
    k = _kwota(kwota)
    if zalegle_od is not None:
        zalegle_od = _data(zalegle_od, "zaległe od")
        start = data_startu()
        if zalegle_od > start:
            raise HTTPException(400, "Data „zaległe od” nie może być późniejsza niż data "
                                     f"startu rozliczeń ({_pl(start)})")
    with transaction() as conn:
        klient = _klient_cx(conn, client_id, zablokuj=True)
        stare = cx_query_one(conn, "SELECT kwota, waluta, zalegle_od, uwagi FROM rozl_otwarcia "
                                   "WHERE client_id=%s AND ksiega=%s", (client_id, ksiega))
        przed = stare or {"kwota": _ZERO, "waluta": klient["settlement_currency"],
                          "zalegle_od": None, "uwagi": ""}
        nowe = {"kwota": k, "waluta": klient["settlement_currency"], "zalegle_od": zalegle_od,
                "uwagi": uwagi or ""}
        rozne = [p for p in nowe if nowe[p] != przed[p]]
        if stare is not None and not rozne:
            return
        cx_execute(
            conn,
            "INSERT INTO rozl_otwarcia (client_id, ksiega, kwota, waluta, zalegle_od, uwagi, "
            " zmieniono, zmienil) VALUES (%s,%s,%s,%s,%s,%s,now(),%s) "
            "ON CONFLICT (client_id, ksiega) DO UPDATE SET kwota=EXCLUDED.kwota, "
            " waluta=EXCLUDED.waluta, zalegle_od=EXCLUDED.zalegle_od, uwagi=EXCLUDED.uwagi, "
            " zmieniono=now(), zmienil=EXCLUDED.zmienil",
            (client_id, ksiega, k, nowe["waluta"], zalegle_od, nowe["uwagi"], kto or ""))
        for pole in rozne:
            historia(conn, client_id=client_id, obiekt="otwarcie",
                     obiekt_id=f"otwarcie-{ksiega}", akcja="zmiana",
                     opis=f"saldo otwarcia {ksiega.upper()}: {pole} "
                          f"z {_json(przed[pole])} na {_json(nowe[pole])}",
                     przed={pole: _json(przed[pole])}, po={pole: _json(nowe[pole])}, kto=kto)


# ── Ustawienia kontrahenta ──────────────────────────────────────────────

_POLA_KLIENTA = {"waluta": "settlement_currency", "termin_wz": "rozl_termin_wz",
                 "termin_fv": "rozl_termin_fv", "forma_wz": "rozl_forma_wz",
                 "forma_fv": "rozl_forma_fv", "notatka": "rozl_notatka"}


def ustaw_klienta(client_id: str, zmiany: dict, kto: str) -> None:
    """Waluta, domyślne terminy i formy płatności, stała notatka. Nowe
    ustawienia dotyczą dokumentów dodanych później — istniejących nie rusza."""
    nieznane = set(zmiany) - set(_POLA_KLIENTA)
    if nieznane:
        raise HTTPException(400, f"Nie można zmienić pola: {', '.join(sorted(nieznane))}")
    nowe: dict[str, Any] = {}
    for pole, wartosc in zmiany.items():
        if pole == "waluta":
            if wartosc not in WALUTY:
                raise HTTPException(400, "Waluta rozliczeń musi być PLN albo EUR")
        elif pole in ("termin_wz", "termin_fv"):
            if isinstance(wartosc, bool) or not isinstance(wartosc, (int, float)) \
                    or wartosc != int(wartosc) or not 0 <= wartosc <= 365:
                raise HTTPException(400, "Termin płatności to liczba dni od 0 do 365")
            wartosc = int(wartosc)
        elif pole in ("forma_wz", "forma_fv"):
            _forma(wartosc)
        else:
            wartosc = str(wartosc or "")
        nowe[pole] = wartosc
    with transaction() as conn:
        klient = _klient_cx(conn, client_id, zablokuj=True)
        rozne = {p: v for p, v in nowe.items() if klient[_POLA_KLIENTA[p]] != v}
        if not rozne:
            return
        cx_execute(conn, "UPDATE clients SET "
                         + ", ".join(f"{_POLA_KLIENTA[p]}=%s" for p in rozne)
                         + " WHERE id=%s", (*rozne.values(), client_id))
        for pole, wartosc in rozne.items():
            przed = klient[_POLA_KLIENTA[pole]]
            historia(conn, client_id=client_id, obiekt="klient", obiekt_id=client_id,
                     akcja="zmiana", opis=f"{pole} zmienione z {przed} na {wartosc}",
                     przed={pole: przed}, po={pole: wartosc}, kto=kto)


# ── Dziennik ustaleń ────────────────────────────────────────────────────

def dodaj_wpis_dziennika(client_id: str, tresc: str, przypomnij: Optional[date],
                         kto: str) -> dict:
    """Wpis w dzienniku ustaleń; z datą przypomnienia klient jest wyróżniony
    na liście od tego dnia, dopóki wpis nie zostanie odhaczony."""
    tresc = (tresc or "").strip()
    if not tresc:
        raise HTTPException(400, "Wpisz treść ustalenia")
    if przypomnij is not None:
        przypomnij = _data(przypomnij, "przypomnij")
    _klient(client_id)
    wpis_id = cuid()
    execute("INSERT INTO rozl_dziennik (id, client_id, tresc, przypomnij, kto) "
            "VALUES (%s,%s,%s,%s,%s)", (wpis_id, client_id, tresc, przypomnij, kto or ""))
    r = query_one("SELECT id, tresc, przypomnij, odhaczono_at, kto, kiedy FROM rozl_dziennik "
                  "WHERE id=%s", (wpis_id,))
    return {"id": r["id"], "tresc": r["tresc"], "przypomnij": _d(r["przypomnij"]),
            "odhaczono": None, "kto": r["kto"], "kiedy": r["kiedy"].isoformat()}


def odhacz_wpis(wpis_id: str, kto: str) -> None:
    """Odhacza przypomnienie (ponowne odhaczenie nic nie zmienia)."""
    if not query_one("SELECT 1 FROM rozl_dziennik WHERE id=%s", (wpis_id,)):
        raise HTTPException(404, "Wpis nie znaleziony")
    execute("UPDATE rozl_dziennik SET odhaczono_at=now() "
            "WHERE id=%s AND odhaczono_at IS NULL", (wpis_id,))


# ── Wydruki: zestawienie na dzień i historia za okres ───────────────────

def _adres_klienta(client_id: str) -> str:
    """Adres z istniejących kolumn clients (brakujące pomijamy)."""
    kolumny = {r["column_name"] for r in query_all(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name='clients' "
        "  AND column_name IN ('address','postal_code','city')")}
    wybrane = [c for c in ("address", "postal_code", "city") if c in kolumny]
    if not wybrane:
        return ""
    row = query_one(f"SELECT {', '.join(wybrane)} FROM clients WHERE id=%s", (client_id,)) or {}
    ulica = (row.get("address") or "").strip()
    miasto = " ".join(x for x in ((row.get("postal_code") or "").strip(),
                                  (row.get("city") or "").strip()) if x)
    return ", ".join(x for x in (ulica, miasto) if x)


def _klient_wydruku(klient: dict) -> dict:
    return {"nazwa": _nazwa(klient), "nip": klient["nip"] or "",
            "adres": _adres_klienta(klient["id"])}


def zestawienie(client_id: str, na_dzien: Optional[date] = None,
                wz_id: Optional[str] = None) -> dict:
    """Dokumenty niezapłacone klienta wg stanu na dzień (domyślnie dziś).

    `wz_id` (id z wz_documents) oznacza pozycję powstałą z drukowanej WZ.
    """
    synchronizuj_wz()
    dzien = na_dzien or date.today()
    k = ksiegi_klienta(client_id, na_dzien=dzien, dzis=dzien)
    ten_id = None
    if wz_id:
        r = query_one("SELECT id FROM rozl_dokumenty WHERE zrodlo='mes_wz' AND source_id=%s",
                      (wz_id,))
        ten_id = r["id"] if r else None
    wynik: dict[str, Any] = {
        "klient": _klient_wydruku(k["klient"]), "waluta": k["klient"]["settlement_currency"],
        "na_dzien": dzien.isoformat(), "policzono": datetime.now().isoformat(timespec="seconds")}
    po_terminie = _ZERO
    for ks in KSIEGI:
        pozycje, razem = [], _ZERO
        for d in k[ks]["dokumenty"]:
            if d["zostalo"] <= 0:
                continue
            dni = max(0, (dzien - d["termin"]).days)
            if dni > 0:
                po_terminie += d["zostalo"]
            razem += d["zostalo"]
            pozycje.append({"numer": d["numer"], "data": _d(d["data"]), "termin": _d(d["termin"]),
                            "kwota": _f(d["kwota"]), "zaplacono": _f(d["zaplacono"]),
                            "pozostalo": _f(d["zostalo"]), "dni_po_terminie": dni,
                            "ten_dokument": ten_id is not None and d["id"] == ten_id})
        wynik[ks] = {"pozycje": pozycje, "razem": _f(razem)}
    wynik["razem"] = _f(k["wz"]["do_zaplaty"] + k["fv"]["do_zaplaty"])
    wynik["po_terminie"] = _f(po_terminie)
    wynik["nadplata_wz"] = _f(k["wz"]["nadplata"])
    wynik["nadplata_fv"] = _f(k["fv"]["nadplata"])
    return wynik


def zestawienie_dla_wz(wz_id: str) -> Optional[dict]:
    """Zestawienie na dziś dla drukowanej WZ; None dla WM, WZ bez kontrahenta
    albo sprzed daty startu (brak dokumentu w księdze)."""
    synchronizuj_wz()
    row = query_one(
        "SELECT client_id, data_dok FROM rozl_dokumenty "
        "WHERE zrodlo='mes_wz' AND source_id=%s AND usuniety_at IS NULL", (wz_id,))
    if not row or not row["client_id"] or row["data_dok"] < data_startu():
        return None
    return zestawienie(row["client_id"], wz_id=wz_id)


def _wiersze_ksiegi(k: dict, poczatek: Decimal, od: date, do: date) -> dict:
    wiersze: list[dict] = []
    for d in k["dokumenty"]:
        if od <= d["data"] <= do:
            # Księga `k` jest policzona na dzień `do` — `zostalo` to reszta
            # niezapłacona na koniec okresu; tylko wtedy dokument jest po terminie.
            dni = max(0, (do - d["termin"]).days) if d["zostalo"] > 0 else 0
            wiersze.append({"_k": (d["data"], 0, str(d["numer"]), str(d["id"])),
                            "data": d["data"], "rodzaj": "dokument", "opis": d["numer"],
                            "obciazenie": d["kwota"], "wplata": _ZERO,
                            "dni_po_terminie": dni})
    for kr in k["kredyty"]:
        if not od <= kr["data"] <= do:
            continue
        if kr["rodzaj"] == "wplata":
            opis = "Wpłata gotówką" if kr["forma"] == "gotowka" else "Wpłata przelewem"
            if kr["uwagi"]:
                opis += f" — {kr['uwagi']}"
            rodzaj = "wplata"
        elif kr["rodzaj"] == "korekta":
            opis, rodzaj = f"Korekta {kr['numer']}", "korekta"
        else:
            opis, rodzaj = "Saldo otwarcia", "dokument"
        wiersze.append({"_k": (kr["data"], 1, "", str(kr["id"])), "data": kr["data"],
                        "rodzaj": rodzaj, "opis": opis, "obciazenie": _ZERO,
                        "wplata": kr["kwota"], "dni_po_terminie": 0})
    wiersze.sort(key=lambda w: w["_k"])
    saldo, wynik = poczatek, []
    for w in wiersze:
        saldo += w["wplata"] - w["obciazenie"]
        wynik.append({"data": _d(w["data"]), "rodzaj": w["rodzaj"], "opis": w["opis"],
                      "obciazenie": _f(w["obciazenie"]), "wplata": _f(w["wplata"]),
                      "saldo": _f(saldo), "dni_po_terminie": w["dni_po_terminie"]})
    return {"saldo_poczatek": _f(poczatek), "wiersze": wynik, "saldo_koniec": _f(k["saldo"])}


def historia_okresu(client_id: str, od: date, do: date) -> dict:
    """Wyciąg rozliczeń za okres: saldo początkowe, dokumenty i wpłaty w
    kolejności dat z saldem narastającym, saldo końcowe — osobno WZ i FV."""
    if do < od:
        raise HTTPException(400, "Data „do” jest wcześniejsza niż „od”")
    synchronizuj_wz()
    przed = ksiegi_klienta(client_id, na_dzien=od - timedelta(days=1), dzis=od)
    po = ksiegi_klienta(client_id, na_dzien=do, dzis=do)
    wynik: dict[str, Any] = {"klient": _klient_wydruku(po["klient"]),
                             "waluta": po["klient"]["settlement_currency"],
                             "od": od.isoformat(), "do": do.isoformat()}
    for ks in KSIEGI:
        wynik[ks] = _wiersze_ksiegi(po[ks], przed[ks]["saldo"], od, do)
    wynik["saldo_poczatek"] = _f(przed["wz"]["saldo"] + przed["fv"]["saldo"])
    wynik["saldo_koniec"] = _f(po["wz"]["saldo"] + po["fv"]["saldo"])
    return wynik
