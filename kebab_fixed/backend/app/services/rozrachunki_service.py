"""Rozrachunki z odbiorcami — karta kontrahenta i zestawienie zbiorcze.

Zastępują arkusz `PŁATNOŚCI08.04.xlsx` (27 zakładek), w którym sam
`PODSUMOWANIE` — sprzedane kg, łączny obrót, zaległości — jest w całości
`#REF!`, tak samo jak dziewięć innych zakładek.

Obciążenia mają DWA źródła: WZ zaciągane wprost z MES i faktury wpisywane
przez biuro (numer MES zna z formularza CMR). WM nie obciąża NIGDY — to
ruch magazynowy, a nie należność; gdyby obciążał, ten sam towar liczyłby
się dwa razy: raz jako wydanie, raz jako faktura.
"""
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.utils.ids import cuid
from app.services.rozrachunki_saldo import (TERMINY_DOMYSLNE, dni_po_terminie,
                                            po_odcieciu, policz_saldo,
                                            termin_platnosci)

logger = get_logger(__name__)


def _klient(client_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT id, name, display_name, nip, settlement_enabled, settlement_currency, "
        "       COALESCE(settlement_basis,'both') AS settlement_basis "
        "FROM clients WHERE id=%s", (client_id,))
    if not row:
        raise HTTPException(404, "Kontrahent nie znaleziony")
    return row


def _obciazenia_z_wz(client_id: str) -> List[Dict[str, Any]]:
    """WZ dla klienta = należność.

    Odpadają: seria WM (ruch magazynowy), dokumenty anulowane (nic nie
    wydają) i niewycenione (nie ma czego dopisać do salda).

    ⚠️ `wz_documents` NIE MA kolumny `client_id` — jest `buyer_name`.
    Przypisanie robimy w kolejności:

      1. przez ZAMÓWIENIE (`source_type='order'` → `client_orders.client_id`)
         — jedyne pewne powiązanie,
      2. dopiero potem po NAZWIE nabywcy.

    Kolejność jest istotna: w kartotece bywają DWIE karty o tej samej nazwie
    handlowej (YALCIN rozbity 27.08.2026 na YBM Gastro i Emin Handels), więc
    dopasowanie po samej nazwie potrafi wskazać nie tę spółkę. Przy saldzie
    znaczyłoby to dług dopisany obcej firmie — i nikt by tego nie zauważył
    poza samym kontrahentem.

    Daty dokumentów są TEKSTEM w formacie ISO (`2026-09-24`), więc `::date`
    jest bezpieczne, ale `NULLIF(...,'')` jest obowiązkowe: puste pole
    wywraca rzutowanie i zabiera ze sobą całe zapytanie.
    """
    return [
        {"kind": "wz", "source_id": r["id"], "number": r["number"],
         "doc_date": r["issued"], "amount": -abs(float(r["total_value"] or 0)),
         "currency": r["currency"] or "PLN", "note": ""}
        for r in query_all(
            """
            SELECT w.id, w.number, w.total_value, w.currency,
                   NULLIF(COALESCE(NULLIF(w.release_date, ''),
                                   w.issued_date), '')::date AS issued
            FROM wz_documents w
            WHERE COALESCE(w.doc_series, 'WZ') = 'WZ'
              AND COALESCE(w.status, '') <> 'anulowany'
              AND w.valued IS TRUE
              AND COALESCE(w.total_value, 0) <> 0
              AND COALESCE(
                    (SELECT o.client_id FROM client_orders o
                      WHERE w.source_type = 'order' AND o.id = w.source_id),
                    (SELECT c.id FROM clients c
                      WHERE c.name = w.buyer_name OR c.display_name = w.buyer_name
                      ORDER BY (c.name = w.buyer_name) DESC LIMIT 1),
                    '') = %s
            """, (client_id,))
        if r["issued"] is not None
    ]


def _obciazenia_wpisane(client_id: str) -> List[Dict[str, Any]]:
    """Faktury wpisane przez biuro. Do czasu integracji z Subiektem to
    jedyna droga, którą faktura trafia do salda."""
    return [dict(r) for r in query_all(
        "SELECT id, kind, source_id, number, doc_date, amount, currency, note "
        "FROM client_charges WHERE client_id=%s ORDER BY doc_date, number",
        (client_id,))]


def karta_klienta(client_id: str, na_dzien: Optional[date] = None) -> Dict[str, Any]:
    """Pełna karta rozrachunków: saldo otwarcia, obciążenia, wpłaty, saldo.

    `na_dzien` steruje WYŁĄCZNIE liczeniem dni po terminie — samo saldo jest
    zawsze bieżące. Domyślnie dziś.
    """
    dzien = na_dzien or date.today()
    klient = _klient(client_id)

    otwarcie = query_one(
        "SELECT amount, currency, as_of_date, note FROM client_opening_balances "
        "WHERE client_id=%s", (client_id,))
    odciecie = otwarcie["as_of_date"] if otwarcie else None

    # CO OBCIĄŻA SALDO — ustawienie per kontrahent.
    #
    # Właściciel o TRUVIE 24.09.2026: „tam saldo nie liczymy osobno na WZ
    # i FV, tylko ogólnie". Łączne saldo jest tu od początku (jedna liczba);
    # otwarte było co innego — czy faktura opisuje TĘ SAMĄ dostawę co WZ.
    # Dane pokazują trzy wzorce: TRUVA 49 wierszy WZ i 11 faktur, YBM 14/63,
    # NAZAR 1/31. Reguła globalna byłaby więc zła dla dwóch z trzech.
    #
    # `both` odtwarza arkusz biura (`SALDO ŁĄCZNIE` sumuje obie kolumny).
    # Nieznana wartość liczy OBA: literówka w ustawieniu nie może po cichu
    # wyzerować czyjegoś długu.
    podstawa = klient["settlement_basis"]
    zrodla: List[Dict[str, Any]] = []
    if podstawa != "invoice":
        zrodla += _obciazenia_z_wz(client_id)
    if podstawa != "wz":
        zrodla += _obciazenia_wpisane(client_id)

    obciazenia = po_odcieciu(zrodla, odciecie, "doc_date")
    for o in obciazenia:
        o["termin"] = termin_platnosci(o["doc_date"], o["kind"], TERMINY_DOMYSLNE)
        o["dni_po_terminie"] = dni_po_terminie(o["termin"], dzien)
    obciazenia.sort(key=lambda o: (o["doc_date"], o.get("number") or ""))

    wplaty = po_odcieciu(
        [dict(r) for r in query_all(
            "SELECT id, paid_date, amount, currency, note FROM client_payments "
            "WHERE client_id=%s ORDER BY paid_date", (client_id,))],
        odciecie, "paid_date")

    return {
        "client": {"id": klient["id"],
                   "name": klient["display_name"] or klient["name"],
                   "nip": klient["nip"] or ""},
        "waluta": klient["settlement_currency"],
        "podstawa": podstawa,
        "otwarcie": dict(otwarcie) if otwarcie else None,
        "obciazenia": obciazenia,
        "wplaty": wplaty,
        "saldo": policz_saldo(otwarcie, obciazenia, wplaty),
        "na_dzien": dzien,
    }


def zestawienie() -> List[Dict[str, Any]]:
    """Kto ile zalega — zastępuje arkusz `PODSUMOWANIE`, który u nich jest
    w całości `#REF!`."""
    return [
        {"clientId": k["id"], "name": karta["client"]["name"],
         "waluta": karta["waluta"], "saldo": karta["saldo"]["saldo"],
         "skonfigurowane": karta["saldo"]["skonfigurowane"]}
        for k, karta in (
            (k, karta_klienta(k["id"])) for k in query_all(
                "SELECT id FROM clients WHERE settlement_enabled IS TRUE "
                "ORDER BY COALESCE(NULLIF(display_name,''), name)"))
    ]


# ── Zapis: saldo otwarcia, faktury, wpłaty ──────────────────────────────
def _waluta_klienta(client_id: str) -> str:
    """Waluta bierze się z KARTOTEKI, nie z formularza. Dwa miejsca na tę
    samą decyzję to dwa miejsca, w których da się ją ustawić inaczej —
    a wpłata zapisana w innej walucie niż obciążenia zsumowałaby się po
    cichu i zafałszowała saldo."""
    return _klient(client_id)["settlement_currency"]


def ustaw_otwarcie(client_id: str, amount: float, as_of_date,
                   note: str = "") -> Dict[str, Any]:
    """Saldo otwarcia — jednorazowe ODCIĘCIE przepisywane z arkusza.

    Właściciel 24.09.2026: „historycznie nie patrz — ja zrobię saldo na dany
    dzień i już będziemy szli od nowa na nowym systemie".
    """
    waluta = _waluta_klienta(client_id)
    execute(
        "INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date, note) "
        "VALUES (%s,%s,%s,%s,%s) "
        "ON CONFLICT (client_id) DO UPDATE SET amount=EXCLUDED.amount, "
        "  currency=EXCLUDED.currency, as_of_date=EXCLUDED.as_of_date, "
        "  note=EXCLUDED.note",
        (client_id, float(amount), waluta, as_of_date, note or ""))
    logger.info("rozrachunki.otwarcie", extra={"client_id": client_id})
    return {"clientId": client_id, "amount": float(amount), "currency": waluta}


def dodaj_fakture(client_id: str, number: str, doc_date, amount: float,
                  note: str = "") -> Dict[str, Any]:
    """Faktura wpisywana przez biuro.

    ZNAK NAKŁADA SERWIS: biuro wpisuje „2000", bo tyle jest do zapłaty,
    a w saldzie to obciążenie ujemne. Gdyby znak wpisywał człowiek, prędzej
    czy później ktoś wpisałby go odwrotnie i saldo pokazałoby nadpłatę
    zamiast długu.
    """
    numer = (number or "").strip()
    if not numer:
        raise HTTPException(400, "Podaj numer faktury")
    if query_one("SELECT 1 FROM client_charges WHERE client_id=%s AND kind='invoice' "
                 "AND number=%s", (client_id, numer)):
        raise HTTPException(409, f"Faktura {numer} jest już zapisana dla tego kontrahenta")
    cid = cuid()
    execute(
        "INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
        " currency, note) VALUES (%s,%s,'invoice',%s,%s,%s,%s,%s)",
        (cid, client_id, numer, doc_date, -abs(float(amount)),
         _waluta_klienta(client_id), note or ""))
    logger.info("rozrachunki.faktura",
                extra={"client_id": client_id, "numer_faktury": numer})
    return {"id": cid, "number": numer}


def dodaj_wplate(client_id: str, paid_date, amount: float,
                 note: str = "") -> Dict[str, Any]:
    """Wpłata idzie na WSPÓLNE saldo klienta, nie do konkretnego dokumentu —
    decyzja właściciela, zgodna z tym, jak działa ich arkusz (uwagi typu
    „2850 28.07" czy „1264+1500 husain" opisują wpłatę, nie przypisanie)."""
    cid = cuid()
    execute(
        "INSERT INTO client_payments (id, client_id, paid_date, amount, currency, note) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (cid, client_id, paid_date, -abs(float(amount)),
         _waluta_klienta(client_id), note or ""))
    logger.info("rozrachunki.wplata", extra={"client_id": client_id})
    return {"id": cid}


def usun_pozycje(kind: str, entry_id: str) -> Dict[str, Any]:
    """Usuwanie pozycji WPISANEJ RĘCZNIE. Obciążeń z WZ tą drogą usunąć się
    nie da — znikają, gdy zniknie albo zostanie anulowany sam dokument."""
    tabela = {"invoice": "client_charges", "payment": "client_payments"}.get(kind)
    if not tabela:
        raise HTTPException(400, f"Nieznany rodzaj pozycji: {kind}")
    execute(f"DELETE FROM {tabela} WHERE id=%s", (entry_id,))
    logger.info("rozrachunki.usunieto", extra={"rodzaj": kind, "pozycja_id": entry_id})
    return {"ok": True}
