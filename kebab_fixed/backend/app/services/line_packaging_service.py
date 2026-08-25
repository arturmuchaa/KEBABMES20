"""Tuleje zdejmowane NA BIEŻĄCO, przy zapisie sztuk.

Do tej pory tuleje schodziły ze stanu dopiero przy potwierdzeniu dnia przez
biuro (`finish_day`). Hala chce widzieć magazyn zgodny z rzeczywistością
w ciągu dnia — jedna sztuka to jedna tuleja, więc zdejmujemy je razem
z zapisem postępu.

Dwie rzeczy, o które trzeba tu zadbać:

1. **Brak podwójnego zdjęcia.** Linia pamięta w `packaging_used`, ile tulei
   już z niej zeszło. `finish_day` konsumuje wyłącznie resztę (`qty − used`),
   więc dni sprzed zmiany i dni prowadzone bez kiosku działają jak dotąd.

2. **Brak tulei NIE blokuje zapisu sztuk.** Hala zapisuje pracę, która
   fizycznie się wydarzyła; zablokowanie jej z powodu nieaktualnego stanu
   w biurze kończy się omijaniem systemu. Zdejmujemy tyle, ile jest na stanie,
   resztę dobierze `finish_day` — i dopiero tam biuro zobaczy, że musi przyjąć
   tuleje.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one
from app.logging_config import get_logger
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)


def _take(conn, packaging_id: str, ile: int, source_id: str) -> int:
    """Zdejmij ze stanu do `ile` sztuk. Zwraca, ile faktycznie zeszło."""
    if not packaging_id or ile <= 0:
        return 0
    pkg = cx_query_one(
        conn, "SELECT name, kg_available FROM packaging WHERE id=%s FOR UPDATE", (packaging_id,)
    )
    if not pkg:
        return 0            # kartoteka skasowana — nie blokujemy hali
    dostepne = int(float(pkg.get("kg_available") or 0))
    faktycznie = max(0, min(ile, dostepne))
    if faktycznie == 0:
        logger.warning(
            "line_packaging.brak_na_stanie",
            extra={"packaging_id": packaging_id, "potrzeba": ile},
        )
        return 0
    cx_execute(
        conn,
        "UPDATE packaging SET kg_available = kg_available - %s, "
        "kg_used = COALESCE(kg_used,0) + %s WHERE id=%s",
        (faktycznie, faktycznie, packaging_id),
    )
    create_stock_movement(
        conn, product_type="packaging", batch_id=packaging_id, qty=float(faktycznie),
        movement_type="OUT", source_type="plan_line", source_id=source_id,
    )
    return faktycznie


def _give_back(conn, packaging_id: str, ile: int, source_id: str) -> int:
    """Oddaj tuleje na magazyn (korekta w dół, zmiana rodzaju tulei)."""
    if not packaging_id or ile <= 0:
        return 0
    pkg = cx_query_one(conn, "SELECT name FROM packaging WHERE id=%s FOR UPDATE", (packaging_id,))
    if not pkg:
        return 0
    cx_execute(
        conn,
        "UPDATE packaging SET kg_available = kg_available + %s, "
        "kg_used = GREATEST(COALESCE(kg_used,0) - %s, 0) WHERE id=%s",
        (ile, ile, packaging_id),
    )
    create_stock_movement(
        conn, product_type="packaging", batch_id=packaging_id, qty=float(ile),
        movement_type="IN", source_type="plan_line_return", source_id=source_id,
    )
    return ile


def sync_line_packaging(conn, line: Dict[str, Any], qty_done: int) -> int:
    """Dociągnij zużycie tulei linii do `qty_done`. Zwraca nowe `packaging_used`.

    Wołane wewnątrz TRWAJĄCEJ transakcji zapisu postępu — stan tulei i postęp
    linii muszą zmienić się razem albo wcale.
    """
    packaging_id = line.get("packaging_id") or ""
    uzyte = int(line.get("packaging_used") or 0)
    if not packaging_id:
        return uzyte                      # pozycja bez tulei (np. na magazyn)

    roznica = int(qty_done) - uzyte
    if roznica > 0:
        uzyte += _take(conn, packaging_id, roznica, str(line.get("id") or ""))
    elif roznica < 0:
        uzyte -= _give_back(conn, packaging_id, -roznica, str(line.get("id") or ""))
    return max(0, uzyte)


def change_line_packaging(plan_id: str, line_id: str, packaging_id: str) -> Dict[str, Any]:
    """Zmień tuleję pozycji z poziomu hali (np. METAL 65 → KARTON 65).

    Jeśli część tulei już zeszła ze stanu, zamiana ODDAJE stare i pobiera nowe
    w jednej transakcji. Bez tego zmiana rodzaju po 10 sztukach zostawiałaby
    10 metalowych zdjętych z magazynu na zawsze.
    """
    from app.db import transaction

    with transaction() as conn:
        line = cx_query_one(
            conn,
            "SELECT id, plan_id, qty_done, packaging_id, packaging_used "
            "FROM production_plan_lines WHERE id=%s AND plan_id=%s FOR UPDATE",
            (line_id, plan_id),
        )
        if not line:
            raise HTTPException(404, "Linia planu nie znaleziona")
        stara = line.get("packaging_id") or ""
        if stara == packaging_id:
            return {"ok": True, "unchanged": True}

        nowa = cx_query_one(
            conn, "SELECT id, name FROM packaging WHERE id=%s FOR UPDATE", (packaging_id,)
        ) if packaging_id else None
        if packaging_id and not nowa:
            raise HTTPException(404, "Tuleja nie znaleziona")

        uzyte = int(line.get("packaging_used") or 0)
        if uzyte > 0 and stara:
            _give_back(conn, stara, uzyte, line_id)
        nowe_uzyte = _take(conn, packaging_id, uzyte, line_id) if packaging_id else 0

        cx_execute(
            conn,
            "UPDATE production_plan_lines SET packaging_id=%s, packaging_name=%s, "
            "packaging_used=%s WHERE id=%s",
            (packaging_id or None, (nowa or {}).get("name") or None, nowe_uzyte, line_id),
        )
    logger.info(
        "line_packaging.changed",
        extra={"line_id": line_id, "z": stara, "na": packaging_id, "przeniesione": uzyte},
    )
    return {"ok": True, "packagingId": packaging_id, "moved": uzyte}
