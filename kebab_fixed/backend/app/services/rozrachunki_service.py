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

from app.db import query_all, query_one
from app.logging_config import get_logger
from app.services.rozrachunki_saldo import (TERMINY_DOMYSLNE, dni_po_terminie,
                                            po_odcieciu, policz_saldo,
                                            termin_platnosci)

logger = get_logger(__name__)


def _klient(client_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT id, name, display_name, nip, settlement_enabled, settlement_currency "
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

    obciazenia = po_odcieciu(
        _obciazenia_z_wz(client_id) + _obciazenia_wpisane(client_id),
        odciecie, "doc_date")
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
