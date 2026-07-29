"""Dokument „WZ na POJEMNIKI" — zdarzenie transportowe z kontrahentem.

Jeden dokument obejmuje OBA kierunki naraz (kolumny „Dostawa / odbiór"
i „Zwrot"), bo kierowca zwykle przywozi pełne i zabiera puste w tym samym
kursie. Numeracja POJ/NN/MM/RR wzorowana na WZ (`wz_service._insert_wz`).

Saldo na dokumencie jest ZAMROŻONE w chwili wystawienia (`balance_after`) —
ponowny wydruk po kolejnych ruchach musi dać ten sam papier.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.container_ledger_service import book_assets, partner_balance_cx
from app.services.container_partners_service import resolve_partner
from app.services.settings_service import get_company
from app.utils.containers import ASSET_LABELS, ASSET_TYPES, format_container_doc_number
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _seller_block() -> Dict[str, Any]:
    """Dane naszej firmy z Ustawień firmy — NIGDY nie hardcode'ujemy ich
    w kodzie ani na wydruku (instancja MES działa u wielu klientów)."""
    co = get_company()
    return {
        "name": co.get("name", ""),
        "address": co.get("address", ""),
        "postal_code": co.get("postal_code", ""),
        "city": co.get("city", ""),
        "nip": co.get("nip", ""),
        "phone": co.get("phone", ""),
    }


def _normalize_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, int]]:
    """Wejście → kanoniczne trzy wiersze w kolejności ASSET_TYPES."""
    by_type: Dict[str, Dict[str, int]] = {}
    for raw in lines or []:
        asset = raw.get("assetType") or raw.get("asset_type")
        if asset not in ASSET_TYPES:
            raise HTTPException(400, f"Nieznany rodzaj nośnika: {asset}")
        try:
            in_qty = int(
                raw.get("inQty") if raw.get("inQty") is not None else raw.get("in_qty") or 0)
            out_qty = int(
                raw.get("outQty") if raw.get("outQty") is not None else raw.get("out_qty") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "Ilości nośników muszą być liczbami całkowitymi")
        if in_qty < 0 or out_qty < 0:
            raise HTTPException(400, "Ilości nośników nie mogą być ujemne")
        by_type[asset] = {"asset_type": asset, "in_qty": in_qty, "out_qty": out_qty}
    out = [by_type.get(a, {"asset_type": a, "in_qty": 0, "out_qty": 0}) for a in ASSET_TYPES]
    if not any(line["in_qty"] or line["out_qty"] for line in out):
        raise HTTPException(400, "Dokument musi zawierać co najmniej jedną ilość")
    return out


def create_doc(
    *,
    partner_id: str = "",
    ref_type: str = "",
    ref_id: str = "",
    doc_date: str = "",
    driver: str = "",
    vehicle: str = "",
    lines: Optional[List[Dict[str, Any]]] = None,
    notes: str = "",
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Wystawia dokument i księguje ruchy (in − out per nośnik)."""
    norm = _normalize_lines(lines or [])
    day = (doc_date or date.today().isoformat())[:10]
    ym = f"{day[2:4]}{day[5:7]}"  # 'RRMM' z daty dokumentu

    with transaction() as conn:
        pid = partner_id or resolve_partner(conn, ref_type, ref_id)
        partner = cx_query_one(conn, "SELECT * FROM container_partners WHERE id=%s", (pid,))
        if not partner:
            raise HTTPException(404, "Kontrahent pojemnikowy nie istnieje")

        seq = int(cx_query_one(
            conn, "SELECT COALESCE(MAX(seq),0)+1 AS n FROM container_docs WHERE year_month=%s",
            (ym,))["n"])
        did = cuid()
        snapshot = {"id": pid, "name": partner["name"], "nip": partner["nip"] or "",
                    "address": partner["address"] or ""}
        cx_execute(
            conn,
            "INSERT INTO container_docs "
            "(id, number, seq, year_month, partner_id, partner_snapshot, seller, doc_date, "
            " driver, vehicle, lines, balance_after, status, notes, created_by, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}','wystawiony',%s,%s,%s)",
            (did, format_container_doc_number(seq, ym), seq, ym, pid,
             json.dumps(snapshot), json.dumps(_seller_block()), day,
             driver or "", vehicle or "", json.dumps(norm), notes or "",
             created_by, now_iso()))

        book_assets(
            conn, partner_id=pid, source_type="container_doc", source_id=did,
            targets={line["asset_type"]: line["in_qty"] - line["out_qty"] for line in norm},
            movement_date=day, doc_id=did, note="WZ na pojemniki", confirmed=True,
            created_by=created_by)

        # Saldo liczone PO zaksięgowaniu i zamrożone na dokumencie.
        bal = partner_balance_cx(conn, pid)
        cx_execute(conn, "UPDATE container_docs SET balance_after=%s WHERE id=%s",
                   (json.dumps(bal), did))

    logger.info("containers.doc.created", extra={"doc_id": did, "partner_id": pid})
    return get_doc(did)


def _doc_dto(row: Dict[str, Any]) -> Dict[str, Any]:
    lines = row.get("lines")
    if not isinstance(lines, list):
        lines = json.loads(lines or "[]")
    bal = row.get("balance_after")
    if not isinstance(bal, dict):
        bal = json.loads(bal or "{}")
    snapshot = row.get("partner_snapshot")
    if not isinstance(snapshot, dict):
        snapshot = json.loads(snapshot or "{}")
    seller = row.get("seller")
    if not isinstance(seller, dict):
        seller = json.loads(seller or "{}")
    return {
        "id": row["id"], "number": row["number"], "status": row["status"],
        "partner": snapshot, "partnerId": row["partner_id"], "seller": seller,
        "docDate": str(row["doc_date"])[:10],
        "driver": row.get("driver") or "", "vehicle": row.get("vehicle") or "",
        "notes": row.get("notes") or "",
        "balanceAfter": {a: int(bal.get(a) or 0) for a in ASSET_TYPES},
        "lines": [{
            "assetType": line["asset_type"], "label": ASSET_LABELS[line["asset_type"]],
            "inQty": int(line["in_qty"]), "outQty": int(line["out_qty"]),
            "balance": int(bal.get(line["asset_type"]) or 0),
        } for line in lines],
    }


def get_doc(doc_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM container_docs WHERE id=%s", (doc_id,))
    if not row:
        raise HTTPException(404, "Dokument pojemnikowy nie istnieje")
    return _doc_dto(row)


def list_docs(partner_id: str = "") -> List[Dict[str, Any]]:
    if partner_id:
        rows = query_all("SELECT * FROM container_docs WHERE partner_id=%s "
                         "ORDER BY doc_date DESC, created_at DESC", (partner_id,))
    else:
        rows = query_all("SELECT * FROM container_docs ORDER BY doc_date DESC, created_at DESC")
    return [_doc_dto(r) for r in rows]


def cancel_doc(doc_id: str) -> Dict[str, Any]:
    """Anulowanie: ruchy dokumentu doprowadzone do zera, dokument ZOSTAJE
    w bazie ze statusem 'anulowany' (wzorzec cancel_wz — nie kasujemy)."""
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT id, partner_id, status, doc_date "
                                 "FROM container_docs WHERE id=%s FOR UPDATE", (doc_id,))
        if not row:
            raise HTTPException(404, "Dokument pojemnikowy nie istnieje")
        if row["status"] == "anulowany":
            raise HTTPException(409, "Dokument jest już anulowany")
        book_assets(conn, partner_id=row["partner_id"], source_type="container_doc",
                    source_id=doc_id, targets={}, movement_date=str(row["doc_date"])[:10],
                    doc_id=doc_id, note="Anulowanie dokumentu", confirmed=True)
        cx_execute(conn, "UPDATE container_docs SET status='anulowany' WHERE id=%s", (doc_id,))
    logger.info("containers.doc.cancelled", extra={"doc_id": doc_id})
    return get_doc(doc_id)
