"""Rozrachunki z odbiorcami — karta kontrahenta, zestawienie, zapisy.

Zastępują arkusz `PŁATNOŚCI08.04.xlsx`, w którym sam `PODSUMOWANIE` jest
w całości `#REF!`.
"""
from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Query

from app.services import rozrachunki_service as svc

router = APIRouter(prefix="/api/rozrachunki", tags=["rozrachunki"])


def _data(wartosc: Any, domyslna: Optional[date] = None) -> Optional[date]:
    """Data z ciała żądania albo z parametru zapytania.

    Parsujemy WYŁĄCZNIE tekst. Wszystko inne — brak pola, `None`, a także
    domyślny obiekt `Query(...)`, który przychodzi tu przy wywołaniu funkcji
    wprost (tak robią testy) — bierze wartość domyślną. Bez tego pusty
    formularz wywracał żądanie na `fromisoformat: argument must be str`.
    """
    if isinstance(wartosc, date):
        return wartosc
    if not isinstance(wartosc, str) or not wartosc.strip():
        return domyslna
    return date.fromisoformat(wartosc.strip())


@router.get("")
def lista():
    """Kto ile zalega — zastępuje arkusz PODSUMOWANIE."""
    return svc.zestawienie()


@router.get("/{client_id}")
def karta(client_id: str, na_dzien: str = Query("")):
    return svc.karta_klienta(client_id, _data(na_dzien))


@router.post("/{client_id}/otwarcie")
def ustaw_otwarcie_klienta(client_id: str, body: Dict[str, Any]):
    return svc.ustaw_otwarcie(
        client_id, float(body.get("amount") or 0),
        _data(body.get("as_of_date"), date.today()), body.get("note") or "")


@router.post("/{client_id}/faktura")
def faktura(client_id: str, body: Dict[str, Any]):
    return svc.dodaj_fakture(
        client_id, body.get("number") or "",
        _data(body.get("doc_date"), date.today()),
        float(body.get("amount") or 0), body.get("note") or "")


@router.post("/{client_id}/wplata")
def wplata(client_id: str, body: Dict[str, Any]):
    return svc.dodaj_wplate(
        client_id, _data(body.get("paid_date"), date.today()),
        float(body.get("amount") or 0), body.get("note") or "")


@router.delete("/pozycja/{kind}/{entry_id}")
def usun(kind: str, entry_id: str):
    return svc.usun_pozycje(kind, entry_id)


@router.get("/na-dokumencie/{wz_id}")
def na_dokumencie(wz_id: str):
    """Blok „niezapłacone" drukowany na dokumencie wydania.

    Kontrahenta ustala SERWIS z dokumentu — wołający nie ma czym udowodnić,
    czyj on jest, a `wz_documents` nie ma kolumny `client_id`.
    """
    return svc.saldo_na_dokument(wz_id)


@router.post("/dostawa/{order_id}")
def dostawa(order_id: str, body: Dict[str, Any]):
    """Rozliczenie CAŁEJ dostawy — kartka dla klienta.

    Ceny za kilogram przychodzą per GRUPA (`{"KIRMIZI": 3.20, ...}`), bo tak
    je wypisuje biuro: na oryginale 3,20 / 3,40 / 3,20 na jednej dostawie.
    """
    return svc.rozliczenie_dostawy(order_id, body.get("ceny") or {})
