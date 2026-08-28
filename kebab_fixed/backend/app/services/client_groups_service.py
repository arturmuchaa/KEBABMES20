"""Grupy odbiorców — kilka spółek, jeden kontrahent.

Jeden kontrahent bywa kilkoma firmami: YALCIN to dwie spółki (YBM Gastro GmbH
i Emin Handels GmbH), odbiorca wrocławski ma pięć oddziałów. Dla hali to jeden
klient — towar zrobiony dla jednej spółki ma pokrywać zamówienia pozostałych,
zamiast leżeć obok i udawać, że nie istnieje.

Grupa łączy WYŁĄCZNIE pulę wyrobu przy liczeniu pokrycia zamówień. Dokumenty
(WZ, HDI, CMR, faktura) zostają przy KONKRETNEJ spółce — sprzedaje się firmie,
nie grupie, a odbiorca na papierze musi mieć swój NIP i adres.
"""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def _czlonkowie(group_id: str) -> List[Dict[str, Any]]:
    return query_all(
        # Nazwa prawna jako druga kolejność sortowania: spółki jednej grupy
        # zwykle MAJĄ tę samą nazwę handlową („YALCIN"), więc bez tego lista
        # ustawiałaby się losowo i za każdym wejściem inaczej.
        "SELECT id, name, display_name, nip FROM clients WHERE group_id=%s "
        "ORDER BY COALESCE(NULLIF(display_name,''), name), name",
        (group_id,),
    )


def list_groups() -> List[Dict[str, Any]]:
    grupy = query_all("SELECT id, name FROM client_groups ORDER BY name")
    return [{**g, "members": _czlonkowie(g["id"])} for g in grupy]


def create_group(name: str) -> Dict[str, Any]:
    nazwa = (name or "").strip()
    if not nazwa:
        raise HTTPException(400, "Podaj nazwę grupy")
    with transaction() as conn:
        if cx_query_one(conn, "SELECT id FROM client_groups WHERE lower(name)=lower(%s)",
                        (nazwa,)):
            raise HTTPException(409, f"Grupa „{nazwa}” już istnieje")
        gid = cuid()
        cx_execute(conn, "INSERT INTO client_groups (id, name) VALUES (%s,%s)", (gid, nazwa))
    logger.info("client_group.created", extra={"group_id": gid, "nazwa": nazwa})
    return {"id": gid, "name": nazwa, "members": []}


def rename_group(group_id: str, name: str) -> Dict[str, Any]:
    nazwa = (name or "").strip()
    if not nazwa:
        raise HTTPException(400, "Podaj nazwę grupy")
    with transaction() as conn:
        if not cx_query_one(conn, "SELECT id FROM client_groups WHERE id=%s", (group_id,)):
            raise HTTPException(404, "Grupa nie istnieje")
        cx_execute(conn, "UPDATE client_groups SET name=%s WHERE id=%s", (nazwa, group_id))
    return {"id": group_id, "name": nazwa, "members": _czlonkowie(group_id)}


def delete_group(group_id: str) -> Dict[str, bool]:
    """Rozwiąż grupę. Spółki zostają — wracają tylko do własnych pul."""
    with transaction() as conn:
        if not cx_query_one(conn, "SELECT id FROM client_groups WHERE id=%s", (group_id,)):
            raise HTTPException(404, "Grupa nie istnieje")
        cx_execute(conn, "UPDATE clients SET group_id=NULL WHERE group_id=%s", (group_id,))
        cx_execute(conn, "DELETE FROM client_groups WHERE id=%s", (group_id,))
    logger.info("client_group.deleted", extra={"group_id": group_id})
    return {"ok": True}


def set_members(group_id: str, client_ids: List[str]) -> Dict[str, Any]:
    """Ustaw skład grupy — lista jest PEŁNA, nie przyrostowa.

    Spółka należy najwyżej do jednej grupy: gdyby mogła należeć do dwóch,
    ta sama sztuka pokrywałaby zamówienia w obu i magazyn liczyłby ją dwa razy.
    """
    ids = [c for c in dict.fromkeys(client_ids or []) if c]
    with transaction() as conn:
        if not cx_query_one(conn, "SELECT id FROM client_groups WHERE id=%s", (group_id,)):
            raise HTTPException(404, "Grupa nie istnieje")
        if ids:
            znalezione = {r["id"] for r in cx_query_all(
                conn, "SELECT id FROM clients WHERE id = ANY(%s)", (ids,))}
            brakuje = [c for c in ids if c not in znalezione]
            if brakuje:
                raise HTTPException(404, f"Nie ma takich odbiorców: {', '.join(brakuje)}")
            zajete = cx_query_all(
                conn,
                "SELECT c.name, g.name AS grupa FROM clients c "
                "JOIN client_groups g ON g.id = c.group_id "
                "WHERE c.id = ANY(%s) AND c.group_id <> %s", (ids, group_id))
            if zajete:
                opis = ", ".join(f"{z['name']} (w grupie {z['grupa']})" for z in zajete)
                raise HTTPException(
                    409, f"Odbiorca może być tylko w jednej grupie: {opis}")

        cx_execute(conn, "UPDATE clients SET group_id=NULL WHERE group_id=%s", (group_id,))
        if ids:
            cx_execute(conn, "UPDATE clients SET group_id=%s WHERE id = ANY(%s)",
                       (group_id, ids))
    logger.info("client_group.members_set",
                extra={"group_id": group_id, "ile": len(ids)})
    return {"id": group_id, "members": _czlonkowie(group_id)}


def pule_klientow() -> Dict[str, str]:
    """Mapa `client_id → id puli`. Spółka w grupie dzieli pulę z resztą grupy,
    spółka bez grupy ma własną (id klienta). Używane przy liczeniu pokrycia."""
    return {
        r["id"]: (r["group_id"] or r["id"])
        for r in query_all("SELECT id, group_id FROM clients")
    }
