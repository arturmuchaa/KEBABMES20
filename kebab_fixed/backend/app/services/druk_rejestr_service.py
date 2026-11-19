"""Rejestr wydruków — co, kto, na jakim komputerze i drukarce wydrukował.

19.11.2026 (TRUVA/Z/2/11/26): nie było widać, czy kartki palet P14 i P15
w ogóle wydrukowano. Wpis nadaje id po stronie klienta (`klientId`), żeby
ponowienie z kolejki offline nie dublowało wydruku.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def _iso(v: Any) -> Any:
    return v.isoformat() if hasattr(v, "isoformat") else v


def zapisz(wpis: Dict[str, Any], operator: str) -> Dict[str, Any]:
    rodzaj = (wpis.get("rodzaj") or "").strip()
    if not rodzaj:
        raise HTTPException(400, "Brak rodzaju wydruku")
    wid = (wpis.get("klientId") or "").strip() or cuid()
    pallet_ids = [str(p) for p in (wpis.get("palletIds") or []) if p]
    kopie = max(1, int(wpis.get("kopie") or 1))
    execute(
        """INSERT INTO print_log (id, rodzaj, tytul, order_id, pallet_ids, dokument_id,
                                  drukarka, zasobnik, kopie, stron, komputer, operator)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (id) DO NOTHING""",
        (wid, rodzaj, wpis.get("tytul") or "", wpis.get("orderId") or None, pallet_ids,
         wpis.get("dokumentId") or None, wpis.get("drukarka") or "", wpis.get("zasobnik") or "",
         kopie, wpis.get("stron"), wpis.get("komputer") or "", operator or ""))
    logger.info("druk.zapisany", extra={
        "rodzaj": rodzaj, "order_id": wpis.get("orderId"), "pallet_ids": pallet_ids,
        "drukarka": wpis.get("drukarka"), "zasobnik": wpis.get("zasobnik"), "kopie": kopie,
        "komputer": wpis.get("komputer"), "operator": operator or ""})
    return _publiczny(query_one("SELECT * FROM print_log WHERE id=%s", (wid,)))


def _publiczny(r: Dict[str, Any] | None) -> Dict[str, Any]:
    if not r:
        return {}
    return {**r, "at": _iso(r.get("at")), "pallet_ids": list(r.get("pallet_ids") or [])}


def lista(order_id: str) -> List[Dict[str, Any]]:
    return [_publiczny(r) for r in query_all(
        "SELECT * FROM print_log WHERE order_id=%s ORDER BY at DESC", (order_id,))]


def ostatnie_wydruki_palet(pallet_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Dla każdej palety: kiedy i kto drukował ostatnio, ile razy."""
    if not pallet_ids:
        return {}
    rows = query_all(
        """SELECT DISTINCT ON (pid) pid, at, operator, COUNT(*) OVER (PARTITION BY pid) AS n
           FROM (SELECT unnest(pallet_ids) AS pid, at, operator FROM print_log
                 WHERE pallet_ids && %s::text[]) x
           WHERE pid = ANY(%s)
           ORDER BY pid, at DESC""", (pallet_ids, pallet_ids))
    return {r["pid"]: {"at": _iso(r["at"]), "kto": r["operator"] or "", "n": int(r["n"])} for r in rows}
