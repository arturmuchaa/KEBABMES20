"""Kartoteka kontrahentów pojemnikowych — JEDNA tożsamość dla dostawcy
i odbiorcy tej samej firmy (scalanie po NIP).

`suppliers` i `clients` zostają nietknięte: to warstwa tożsamości wyłącznie
na potrzeby salda nośników zwrotnych. Fuzja tamtych tabel dotknęłaby przyjęć,
zamówień, WZ, HDI i CMR — nieproporcjonalne ryzyko do rozwiązywanego problemu.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one
from app.logging_config import get_logger
from app.utils.containers import normalize_name, normalize_nip
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

# ref_type → tabela źródłowa. Rozszerzenie o kolejny typ wymaga TYLKO wpisu tutaj.
_SOURCE_TABLES = {"supplier": "suppliers", "client": "clients"}


def _find_or_create(conn, *, nip: str, name: str, address: str = "") -> str:
    """Partner po NIP-ie, a gdy NIP pusty — po znormalizowanej nazwie
    WYŁĄCZNIE wśród partnerów też bez NIP-u (firma z NIP-em ma już swoją
    tożsamość i nie wolno do niej przykleić anonimowego wpisu)."""
    if nip:
        row = cx_query_one(conn, "SELECT id FROM container_partners WHERE nip=%s", (nip,))
        if row:
            return row["id"]
    else:
        target = normalize_name(name)
        for row in cx_query_all(
            conn, "SELECT id, name FROM container_partners WHERE COALESCE(nip,'')=''"
        ):
            if normalize_name(row["name"]) == target:
                return row["id"]

    pid = cuid()
    cx_execute(
        conn,
        "INSERT INTO container_partners (id, nip, name, address, created_at) "
        "VALUES (%s,%s,%s,%s,%s)",
        (pid, nip or None, (name or "").strip() or "(bez nazwy)", address or "", now_iso()))
    logger.info("containers.partner.created", extra={"partner_id": pid, "partner_nip": nip})
    return pid


def resolve_partner(conn, ref_type: str, ref_id: str) -> str:
    """Id partnera pojemnikowego dla dostawcy/odbiorcy z kartoteki.
    Tworzy partnera, gdy jeszcze nie istnieje."""
    table = _SOURCE_TABLES.get(ref_type)
    if not table or not ref_id:
        raise HTTPException(400, "Nieznany typ kontrahenta")

    link = cx_query_one(
        conn,
        "SELECT partner_id FROM container_partner_links WHERE ref_type=%s AND ref_id=%s",
        (ref_type, ref_id))
    if link:
        return link["partner_id"]

    src = cx_query_one(conn, f"SELECT * FROM {table} WHERE id=%s", (ref_id,))
    if not src:
        raise HTTPException(404, "Kontrahent nie istnieje")

    address = ", ".join(p for p in [src.get("address") or "", src.get("city") or ""] if p)
    pid = _find_or_create(
        conn,
        nip=normalize_nip(src.get("nip")),
        name=src.get("display_name") or src.get("name") or "",
        address=address)
    cx_execute(
        conn,
        "INSERT INTO container_partner_links (partner_id, ref_type, ref_id) VALUES (%s,%s,%s) "
        "ON CONFLICT (ref_type, ref_id) DO NOTHING",
        (pid, ref_type, ref_id))
    return pid


def resolve_partner_by_nip(conn, nip: str, name: str, address: str = "") -> str:
    """Partner dla kontrahenta spoza kartoteki — ręczne WZ podaje samego
    kupującego (nazwa + NIP w nagłówku), bez id klienta."""
    return _find_or_create(conn, nip=normalize_nip(nip), name=name, address=address)


def get_partner(partner_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM container_partners WHERE id=%s", (partner_id,))
    if not row:
        raise HTTPException(404, "Kontrahent pojemnikowy nie istnieje")
    roles = [r["ref_type"] for r in query_all(
        "SELECT DISTINCT ref_type FROM container_partner_links WHERE partner_id=%s",
        (partner_id,))]
    return {**row, "roles": sorted(roles)}


def list_partners() -> List[Dict[str, Any]]:
    """Lista partnerów z rolami. Role z podzapytania, NIE z JOIN-a — JOIN
    zwielokrotniłby wiersze przy partnerze będącym i dostawcą, i odbiorcą."""
    return query_all(
        """SELECT p.*,
                  (SELECT ARRAY_AGG(DISTINCT l.ref_type)
                     FROM container_partner_links l WHERE l.partner_id = p.id) AS roles
           FROM container_partners p
           WHERE p.active
           ORDER BY p.name""")
