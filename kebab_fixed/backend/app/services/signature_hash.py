"""Kanoniczna treść podpisywanego dokumentu i jej sha256.

Po co: podpis elektroniczny bez związania z treścią to obrazek, który da
się przykleić do czegokolwiek. Hash liczony przy składaniu podpisu i
porównywany przy każdej zmianie wpisu sprawia, że poprawienie temperatury
po podpisaniu UNIEWAŻNIA podpis, zamiast po cichu zmienić to, pod czym
ktoś się podpisał. To pierwsza rzecz, o którą zapyta audytor.

Kanonizacja musi być STABILNA: 2.5, "2.50" i Decimal("2.5") to ten sam
pomiar. Gdyby hash zależał od zapisu liczby, unieważniałby poprawne
podpisy przy każdym przejściu danych przez JSON albo psycopg2.
"""
import hashlib
from decimal import Decimal, InvalidOperation
from typing import Any, Dict

#: Kolejność jest częścią kanonu — nie sortujemy alfabetycznie, żeby tekst
#: dało się przeczytać okiem w tej samej kolejności co kolumny karty 1.1.1.
_POLA_DOSTAWY = ("reception_no", "supplier_name", "received_date", "kg_total")
_POLA_KONTROLI = ("visual", "temp_chamber", "temp_meat", "kg_match",
                  "notes", "verdict", "nc_description", "nc_action", "nc_at")
#: Pola liczbowe normalizowane do stałej liczby miejsc po przecinku.
_MIEJSCA = {"kg_total": 3, "temp_chamber": 1, "temp_meat": 1}


def _norm(klucz: str, wartosc: Any) -> str:
    """Brak wartości to PUSTY napis — i musi różnić się od zera.
    „Nie zmierzono" i „zmierzono 0 °C" to dwa różne zdarzenia."""
    if wartosc is None:
        return ""
    if klucz in _MIEJSCA:
        try:
            return f"{Decimal(str(wartosc)):.{_MIEJSCA[klucz]}f}"
        except (InvalidOperation, ValueError):
            return str(wartosc)
    return str(wartosc)


def canonical_payload(reception: Dict[str, Any], check: Dict[str, Any]) -> str:
    """Podpisywana treść jako czytelny tekst `klucz=wartość` w stałej kolejności.

    Czytelny celowo: przy sporze ma się dać obejrzeć okiem, co dokładnie
    zostało podpisane — a nie odszyfrowywać strukturę binarną.
    """
    linie = [f"{k}={_norm(k, reception.get(k))}" for k in _POLA_DOSTAWY]
    linie += [f"{k}={_norm(k, check.get(k))}" for k in _POLA_KONTROLI]
    return "\n".join(linie)


def content_hash(reception: Dict[str, Any], check: Dict[str, Any]) -> str:
    return hashlib.sha256(
        canonical_payload(reception, check).encode("utf-8")).hexdigest()
