"""Rozliczenia z odbiorcami — odczyt: karta klienta, lista kontrahentów.

Księgi WZ i FV klienta budowane są z bazy i liczone wyłącznie przez
`rozliczenia_ksiega.rozlicz_ksiege` (jedno źródło sald dla panelu i wydruków).

Wejście księgi:
  * dokumenty — aktywne (`stan_zrodla='aktywny'`), nieusunięte, w walucie
    kontrahenta, z kwotą > 0;
  * dokument z kwotą < 0 (faktura korygująca) staje się kredytem;
  * saldo otwarcia ujemne — najstarszy dokument „Saldo otwarcia”, dodatnie —
    kredyt z datą startu;
  * wpłaty nieusunięte — kredyty.
Dokumenty, wpłaty i salda otwarcia w innej walucie niż kontrahent nie wchodzą
do sum — są zgłaszane (`inna_waluta`, z polem `rodzaj`). Niewycenione WZ trafiają na listę „czeka na ceny”.

Na granicy API kwoty to `float` zaokrąglony do 2 miejsc, daty — ISO.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException

from app.db import query_all, query_one
from app.services.rozliczenia_ksiega import (grosze, na_dzien as _na_dzien,
                                             rozlicz_ksiege, stan_dokumentu,
                                             waluta_z_nip)
from app.services.rozliczenia_wz import data_startu, synchronizuj_wz

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
    for r in query_all(_SQL_DOKUMENTY + " AND client_id IS NOT NULL"):
        dokumenty[r["client_id"]].append(r)
    wplaty: dict[str, list] = defaultdict(list)
    for r in query_all(_SQL_WPLATY):
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
            "  AND d.stan_zrodla <> 'anulowany' ORDER BY d.data_dok, d.numer")]

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
    historia = query_all(
        "SELECT akcja, opis, przed, po, powod, kto, kiedy FROM rozl_historia "
        "WHERE obiekt='dokument' AND obiekt_id=%s ORDER BY kiedy, id", (dokument_id,))
    return {**wynik, "pokrycie": pokrycie,
            "historia": [{**h, "kiedy": h["kiedy"].isoformat()} for h in historia]}


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
