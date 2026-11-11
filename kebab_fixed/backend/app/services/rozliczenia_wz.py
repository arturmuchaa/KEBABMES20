"""Rozliczenia z odbiorcami — synchronizacja WZ z MES do księgi.

Wycenione WZ z `wz_documents` przepisywane są do `rozl_dokumenty`
(`zrodlo='mes_wz'`, `ksiega='wz'`). Synchronizacja jest idempotentna:
zapisuje tylko różnice, a każda zmiana kwoty, anulowanie i wycena zostawia
wiersz w `rozl_historia` (`kto='MES'`). Dokumentów z księgi nie usuwa się
nigdy — anulowany WZ zostaje z `stan_zrodla='anulowany'` i kwotą 0.

Do księgi trafia tylko seria WZ (nigdy WM — to ruch magazynowy) z datą
>= data startu rozliczeń. Data dokumentu to `release_date`, gdy pusta —
`issued_date`; obie są TEKSTEM ISO, więc `NULLIF(...,'')` przed `::date`
jest obowiązkowe.

Pola, które ustawia biuro (`uwagi`, `forma`, `termin_reczny`, ręczne
przypisanie kontrahenta), nie są przez synchronizację nadpisywane.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import HTTPException

from app.db import (cx_execute, cx_query_all, cx_query_one, execute,
                    query_one, transaction)
from app.logging_config import get_logger
from app.services.rozliczenia_ksiega import brutto_wz, grosze, ma_vat, nip_krajowy
from app.utils.ids import cuid

logger = get_logger(__name__)

START_KEY = "rozliczenia_start"
START_DOMYSLNY = date(2026, 11, 9)
KTO_MES = "MES"

# Rzutujemy tylko tekst w kształcie daty ISO — jedna literówka w polu daty
# nie może wywrócić całej synchronizacji (taki WZ jest po prostu pomijany).
_ISO = r"'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'"
_DATA_WZ = (f"COALESCE(CASE WHEN w.release_date ~ {_ISO} THEN w.release_date::date END, "
            f"CASE WHEN w.issued_date ~ {_ISO} THEN w.issued_date::date END)")


# ── Blokada księgi WZ ──────────────────────────────────────────────────

def zablokuj_ksiege_wz(conn) -> None:
    """Blokada doradcza księgi WZ do końca transakcji. Biorą ją synchronizacja
    i KAŻDY zapis biura do dokumentów `mes_wz` — inaczej synchronizacja,
    która przeczytała wiersz przed zapisem biura, nadpisałaby go."""
    cx_execute(conn, "SELECT pg_advisory_xact_lock(hashtext('rozliczenia_wz'))")


# ── Historia ────────────────────────────────────────────────────────────

def historia(conn_or_none, *, client_id: Optional[str], obiekt: str, obiekt_id: str,
             akcja: str, opis: str, przed: Any = None, po: Any = None,
             powod: str = "", kto: str = "") -> None:
    """Jedyny zapis do `rozl_historia`. Z połączeniem — w transakcji
    wywołującego; z `None` — we własnej."""
    sql = ("INSERT INTO rozl_historia (id, client_id, obiekt, obiekt_id, akcja, opis, "
           " przed, po, powod, kto) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s)")
    params = (cuid(), client_id, obiekt, obiekt_id or "", akcja, opis,
              None if przed is None else json.dumps(przed),
              None if po is None else json.dumps(po), powod or "", kto or "")
    if conn_or_none is None:
        execute(sql, params)
    else:
        cx_execute(conn_or_none, sql, params)


# ── Data startu ─────────────────────────────────────────────────────────

def _na_date(wartosc: Any) -> date:
    if isinstance(wartosc, str) and wartosc:
        try:
            return date.fromisoformat(wartosc[:10])
        except ValueError:
            pass
    return START_DOMYSLNY


def data_startu() -> date:
    """Data startu rozliczeń (`app_settings`), domyślnie 09.11.2026."""
    row = query_one("SELECT value FROM app_settings WHERE key=%s", (START_KEY,))
    return _na_date(row["value"] if row else None)


def _data_startu_cx(conn) -> date:
    row = cx_query_one(conn, "SELECT value FROM app_settings WHERE key=%s", (START_KEY,))
    return _na_date(row["value"] if row else None)


def ustaw_date_startu(d: date, kto: str) -> None:
    """Zmienia datę startu rozliczeń; zmiana trafia do historii."""
    with transaction() as conn:
        przed = _data_startu_cx(conn)
        cx_execute(
            conn,
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES (%s, %s::jsonb, now())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
            (START_KEY, json.dumps(d.isoformat())))
        historia(conn, client_id=None, obiekt="klient", obiekt_id=START_KEY,
                 akcja="zmiana",
                 opis=f"data startu rozliczeń zmieniona z {przed.isoformat()} na {d.isoformat()}",
                 przed={"data_startu": przed.isoformat()}, po={"data_startu": d.isoformat()},
                 kto=kto)
    logger.info("rozliczenia.start.zmiana", extra={"data": d.isoformat()})


# ── Dopasowanie kontrahenta ─────────────────────────────────────────────

def _nip_norm(nip: Optional[str]) -> str:
    """NIP do porównań: bez spacji i myślników, wielkie litery, bez prefiksu PL."""
    czysty = "".join(str(nip or "").split()).replace("-", "").upper()
    return czysty[2:] if czysty.startswith("PL") else czysty


class _Kartoteka:
    def __init__(self, klienci: list[dict]):
        self.po_id = {k["id"]: k for k in klienci}
        self.po_nip: dict[str, list[str]] = {}
        self.po_nazwie: dict[str, set[str]] = {}
        for k in klienci:
            nip = _nip_norm(k["nip"])
            if nip:
                self.po_nip.setdefault(nip, []).append(k["id"])
            for nazwa in {k["name"], k["display_name"]}:
                if nazwa:
                    self.po_nazwie.setdefault(nazwa, set()).add(k["id"])

    def dopasuj(self, wz: dict) -> Optional[str]:
        """Zamówienie → jedyny klient po NIP → jedyny klient po nazwie.

        Niejednoznaczność daje `None`: w kartotece bywają dwie karty o tej
        samej nazwie handlowej (YALCIN), a dług dopisany obcej spółce jest
        gorszy niż dokument czekający na ręczne przypisanie.
        """
        if wz["order_client_id"] in self.po_id:
            return wz["order_client_id"]
        nip = _nip_norm(wz["buyer_nip"])
        if nip and len(self.po_nip.get(nip, [])) == 1:
            return self.po_nip[nip][0]
        nazwa = wz["buyer_name"]
        if nazwa and len(self.po_nazwie.get(nazwa, set())) == 1:
            return next(iter(self.po_nazwie[nazwa]))
        return None

    def termin(self, client_id: Optional[str], data_dok: date) -> date:
        dni = self.po_id[client_id]["rozl_termin_wz"] if client_id in self.po_id else 0
        return data_dok + timedelta(days=dni or 0)


# ── Synchronizacja ──────────────────────────────────────────────────────

def _stan(wz: dict, kwota) -> str:
    if (wz["status"] or "") == "anulowany":
        return "anulowany"
    if wz["valued"] is not True or kwota == 0:
        return "czeka_na_ceny"
    return "aktywny"


def _kwota_txt(k) -> str:
    return str(grosze(k))


def synchronizuj_wz() -> dict:
    """Przepisuje WZ z MES do `rozl_dokumenty`. Idempotentna, w jednej
    transakcji pod blokadą doradczą (dwie równoległe synchronizacje nie
    dodadzą tego samego WZ dwa razy)."""
    wynik = {"dodane": 0, "zmienione": 0, "anulowane": 0}
    with transaction() as conn:
        zablokuj_ksiege_wz(conn)
        start = _data_startu_cx(conn)
        kartoteka = _Kartoteka(cx_query_all(
            conn, "SELECT id, name, display_name, nip, rozl_termin_wz, rozl_forma_wz "
                  "FROM clients"))
        istniejace = {r["source_id"]: r for r in cx_query_all(
            conn,
            "SELECT id, source_id, client_id, przypisano_recznie, numer, data_dok, kwota, forma, "
            "       waluta, termin, termin_reczny, stan_zrodla, brak_vat "
            "FROM rozl_dokumenty WHERE zrodlo='mes_wz'")}
        dokumenty_wz = cx_query_all(
            conn,
            f"""SELECT w.id, w.number, w.status, w.valued, w.lines, w.currency,
                       w.buyer_name, w.buyer_nip, {_DATA_WZ} AS data_dok,
                       o.client_id AS order_client_id
                FROM wz_documents w
                LEFT JOIN client_orders o
                       ON w.source_type = 'order' AND o.id = w.source_id
                WHERE COALESCE(w.doc_series, 'WZ') = 'WZ'
                  AND ({_DATA_WZ} >= %s
                       OR w.id IN (SELECT source_id FROM rozl_dokumenty
                                   WHERE zrodlo = 'mes_wz'))
                ORDER BY w.id""",
            (start,))

        for wz in dokumenty_wz:
            stary = istniejace.get(wz["id"])
            if stary is None:
                _dodaj(conn, wz, kartoteka)
                wynik["dodane"] += 1
            else:
                zmiana = _aktualizuj(conn, wz, stary, kartoteka)
                if zmiana:
                    wynik[zmiana] += 1
    logger.info("rozliczenia.wz.sync", extra=wynik)
    return wynik


def _wylicz(wz: dict, client_id: Optional[str], kartoteka: _Kartoteka) -> dict:
    lines = wz["lines"] or []
    brutto = brutto_wz(lines)
    stan = _stan(wz, brutto)
    klient = kartoteka.po_id.get(client_id)
    return {
        "numer": wz["number"],
        "kwota": brutto if stan == "aktywny" else grosze(0),
        "waluta": wz["currency"] or "PLN",
        "stan_zrodla": stan,
        "brak_vat": bool(klient is not None and nip_krajowy(klient["nip"])
                         and not ma_vat(lines) and stan == "aktywny"),
    }


def _dodaj(conn, wz: dict, kartoteka: _Kartoteka) -> None:
    client_id = kartoteka.dopasuj(wz)
    nowe = _wylicz(wz, client_id, kartoteka)
    klient = kartoteka.po_id.get(client_id)
    dok_id = cuid()
    cx_execute(
        conn,
        "INSERT INTO rozl_dokumenty (id, client_id, ksiega, zrodlo, source_id, numer, "
        " data_dok, kwota, waluta, termin, forma, stan_zrodla, brak_vat, utworzyl) "
        "VALUES (%s,%s,'wz','mes_wz',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (dok_id, client_id, wz["id"], nowe["numer"], wz["data_dok"], nowe["kwota"],
         nowe["waluta"], kartoteka.termin(client_id, wz["data_dok"]),
         klient["rozl_forma_wz"] if klient else "gotowka", nowe["stan_zrodla"],
         nowe["brak_vat"], KTO_MES))
    historia(conn, client_id=client_id, obiekt="dokument", obiekt_id=dok_id,
             akcja="dodano", opis=f"dodano {nowe['numer']} z MES",
             po={"kwota": float(nowe["kwota"]), "stan": nowe["stan_zrodla"]}, kto=KTO_MES)


def _aktualizuj(conn, wz: dict, stary: dict, kartoteka: _Kartoteka) -> Optional[str]:
    """Zapisuje różnice; zwraca klucz licznika (`zmienione`/`anulowane`) albo None."""
    client_id = stary["client_id"] if stary["przypisano_recznie"] else kartoteka.dopasuj(wz)
    data_dok = wz["data_dok"] or stary["data_dok"]
    nowe = _wylicz(wz, client_id, kartoteka)
    nowe["client_id"] = client_id
    nowe["data_dok"] = data_dok
    if not stary["termin_reczny"]:
        nowe["termin"] = kartoteka.termin(client_id, data_dok)
    if stary["client_id"] is None and client_id in kartoteka.po_id:
        # Pierwszy kontrahent: domyślne „gotówka" nie było wyborem biura.
        nowe["forma"] = kartoteka.po_id[client_id]["rozl_forma_wz"]

    rozne = {k: v for k, v in nowe.items() if stary[k] != v}
    if not rozne:
        return None
    # Druga linia obrony: ręczne przypisanie i ręczny termin nie do nadpisania,
    # nawet gdyby wiersz zmienił się od odczytu.
    straz = {"client_id": "przypisano_recznie", "termin": "termin_reczny"}
    ustaw = ", ".join(
        f"{k}=CASE WHEN {straz[k]} THEN {k} ELSE %s END" if k in straz else f"{k}=%s"
        for k in rozne)
    cx_execute(conn, f"UPDATE rozl_dokumenty SET {ustaw} WHERE id=%s",
               (*rozne.values(), stary["id"]))

    def wpis(akcja: str, opis: str, przed=None, po=None) -> None:
        historia(conn, client_id=client_id, obiekt="dokument", obiekt_id=stary["id"],
                 akcja=akcja, opis=opis, przed=przed, po=po, kto=KTO_MES)

    kwota_przed = {"kwota": float(stary["kwota"])}
    kwota_po = {"kwota": float(nowe["kwota"])}
    if "client_id" in rozne:
        wpis("przypisano", f"kontrahent dopasowany z MES dla {nowe['numer']}",
             {"client_id": stary["client_id"]}, {"client_id": client_id})
    if nowe["stan_zrodla"] == "anulowany" and stary["stan_zrodla"] != "anulowany":
        wpis("anulowano", f"{nowe['numer']} anulowany w MES", kwota_przed, kwota_po)
        return "anulowane"
    if stary["stan_zrodla"] == "czeka_na_ceny" and nowe["stan_zrodla"] == "aktywny":
        wpis("wycena", f"{nowe['numer']} wyceniony: {_kwota_txt(nowe['kwota'])}",
             kwota_przed, kwota_po)
    elif "kwota" in rozne:
        wpis("kwota", f"kwota zmieniona z {_kwota_txt(stary['kwota'])} "
                      f"na {_kwota_txt(nowe['kwota'])}", kwota_przed, kwota_po)
    return "zmienione"


# ── Ręczne przypisanie ──────────────────────────────────────────────────

def przypisz_wz(dokument_id: str, client_id: str, kto: str) -> None:
    """Ręczne przypisanie kontrahenta do dokumentu; synchronizacja go nie zmienia."""
    with transaction() as conn:
        zablokuj_ksiege_wz(conn)
        dok = cx_query_one(
            conn, "SELECT id, client_id, zrodlo, numer, data_dok, forma, termin, "
                  "       termin_reczny "
                  "FROM rozl_dokumenty WHERE id=%s FOR UPDATE", (dokument_id,))
        if not dok:
            raise HTTPException(404, "Dokument nie znaleziony")
        if dok["zrodlo"] != "mes_wz":
            raise HTTPException(400, "Przypisać kontrahenta można tylko do WZ z MES")
        klient = cx_query_one(conn, "SELECT id, name, rozl_termin_wz, rozl_forma_wz "
                                    "FROM clients WHERE id=%s", (client_id,))
        if not klient:
            raise HTTPException(404, "Kontrahent nie znaleziony")
        termin = dok["termin"] if dok["termin_reczny"] else \
            dok["data_dok"] + timedelta(days=klient["rozl_termin_wz"] or 0)
        forma = klient["rozl_forma_wz"] if dok["client_id"] is None else dok["forma"]
        cx_execute(conn, "UPDATE rozl_dokumenty SET client_id=%s, przypisano_recznie=true, "
                         "termin=%s, forma=%s WHERE id=%s",
                   (client_id, termin, forma, dokument_id))
        historia(conn, client_id=client_id, obiekt="dokument", obiekt_id=dokument_id,
                 akcja="przypisano", opis=f"{dok['numer']} przypisany do {klient['name']}",
                 przed={"client_id": dok["client_id"]}, po={"client_id": client_id}, kto=kto)
