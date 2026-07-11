"""Kartoteka partii magazynu surowca (styl Subiekt).

Jedna funkcja :func:`stock_card` składa komplet danych dla klikniętego
wiersza Magazynu surowca: identyfikację partii, stany, łańcuch śledzenia
(dostawca → przyjęcie → rozbiór → magazyn → wydania) oraz historię ruchów
z rejestru ``stock_movements`` z etykietami dokumentów źródłowych.

Historia ruchów bywa niepełna dla partii sprzed wprowadzenia rejestru —
frontend liczy saldo WSTECZ od bieżącego stanu, więc świeże ruchy zawsze
mają poprawny „stan po", a brak wczesnych wpisów nie kłamie zerem.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import query_all, query_one

# Nazwy dokumentów/operacji per source_type rejestru ruchów.
_SOURCE_LABELS = {
    "supplier": "Przyjęcie dostawy",
    "reception": "Przyjęcie surowca (bez rozbioru)",
    "reception_transfer": "Transfer na magazyn mięsa",
    "deboning": "Rozbiór",
    "mixing": "Masowanie",
    "wz": "WZ",
    "invoice": "Faktura",
}


def _movements(product_type: str, batch_id: str) -> List[Dict[str, Any]]:
    """Ruchy partii z etykietami dokumentów (rosnąco po dacie)."""
    rows = query_all(
        """SELECT id, qty, movement_type, source_type, source_id, created_at
           FROM stock_movements
           WHERE product_type=%s AND batch_id=%s
           ORDER BY created_at""",
        (product_type, batch_id),
    )

    # Dociągnij czytelne numery dokumentów jednym zapytaniem per typ.
    by_src: Dict[str, List[str]] = {}
    for r in rows:
        if r.get("source_id"):
            by_src.setdefault(r["source_type"], []).append(r["source_id"])

    wz_by_id: Dict[str, Dict] = {}
    if by_src.get("wz"):
        wz_by_id = {w["id"]: w for w in query_all(
            "SELECT id, number, buyer_name, issued_date FROM wz_documents "
            "WHERE id = ANY(%s::text[])", (by_src["wz"],))}
    deb_by_id: Dict[str, Dict] = {}
    if by_src.get("deboning"):
        deb_by_id = {d["id"]: d for d in query_all(
            "SELECT id, session_no, worker_name, created_at FROM deboning_entries "
            "WHERE id = ANY(%s::text[])", (by_src["deboning"],))}
    mix_by_id: Dict[str, Dict] = {}
    if by_src.get("mixing"):
        mix_by_id = {m["id"]: m for m in query_all(
            "SELECT id, order_no FROM mixing_orders WHERE id = ANY(%s::text[])",
            (by_src["mixing"],))}

    out: List[Dict[str, Any]] = []
    for r in rows:
        st, sid = r["source_type"], r.get("source_id")
        label = _SOURCE_LABELS.get(st, st or "Operacja")
        number: Optional[str] = None
        detail: Optional[str] = None
        ref_kind: Optional[str] = None   # do linku w UI
        ref_id: Optional[str] = None
        if st == "wz" and sid in wz_by_id:
            w = wz_by_id[sid]
            number = w.get("number")
            detail = w.get("buyer_name")
            ref_kind, ref_id = "wz", sid
        elif st == "deboning" and sid in deb_by_id:
            d = deb_by_id[sid]
            number = d.get("session_no")
            detail = d.get("worker_name")
        elif st == "mixing" and sid in mix_by_id:
            number = mix_by_id[sid].get("order_no")
        out.append({
            "id": r["id"],
            "date": str(r.get("created_at") or ""),
            "movement_type": r["movement_type"],
            "qty": float(r["qty"] or 0),
            "source_type": st,
            "label": label,
            "number": number,
            "detail": detail,
            "ref_kind": ref_kind,
            "ref_id": ref_id,
        })
    return out


def _deboning_entries(raw_batch_id: str) -> List[Dict[str, Any]]:
    return query_all(
        """SELECT id, session_no, kg_quarter, kg_meat, kg_backs, kg_bones,
                  yield_pct, worker_name, created_at, completed_at
           FROM deboning_entries
           WHERE raw_batch_id=%s AND COALESCE(status,'complete')='complete'
           ORDER BY created_at""",
        (raw_batch_id,),
    )


def stock_card(stock_type: str, stock_id: str) -> Dict[str, Any]:
    """Kartoteka partii dla wiersza Magazynu surowca (raw/meat/byproduct)."""
    if stock_type == "raw":
        return _card_raw(stock_id)
    if stock_type == "meat":
        return _card_meat(stock_id)
    if stock_type == "byproduct":
        return _card_byproduct(stock_id)
    raise HTTPException(400, f"Nieznany typ magazynu: {stock_type}")


def _supplier_step(rb: Dict) -> Dict[str, Any]:
    return {
        "stage": "supplier",
        "title": rb.get("supplier_name") or "Dostawca",
        "batch_no": rb.get("supplier_batch_no"),
        "date": str(rb.get("slaughter_date") or "")[:10] or None,
        "note": "ubój",
    }


def _reception_step(rb: Dict) -> Dict[str, Any]:
    return {
        "stage": "reception",
        "title": "Przyjęcie surowca",
        "batch_no": rb.get("internal_batch_no"),
        "date": str(rb.get("received_date") or "")[:10] or None,
        "kg": float(rb.get("kg_received") or 0) or None,
        "note": rb.get("invoice_no") and f"faktura {rb['invoice_no']}" or None,
    }


def _issues_step(movements: List[Dict]) -> Optional[Dict[str, Any]]:
    wz_moves = [m for m in movements if m["source_type"] == "wz" and m["qty"] < 0]
    if not wz_moves:
        return None
    return {
        "stage": "issues",
        "title": "Wydania (WZ)",
        "date": wz_moves[-1]["date"][:10] or None,
        "kg": round(sum(-m["qty"] for m in wz_moves), 3),
        "note": f"{len(wz_moves)} dok.",
    }


def _card_raw(stock_id: str) -> Dict[str, Any]:
    rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (stock_id,))
    if not rb:
        raise HTTPException(404, "Nie znaleziono partii surowca")
    movements = _movements("raw", stock_id)
    debs = _deboning_entries(stock_id)

    kg_avail = float(rb.get("kg_available") or 0)
    chain: List[Dict[str, Any]] = [
        _supplier_step(rb),
        _reception_step(rb),
    ]
    if debs:
        chain.append({
            "stage": "deboning",
            "title": "Rozbiór",
            "date": str(debs[-1].get("created_at") or "")[:10] or None,
            "kg": round(sum(float(d.get("kg_quarter") or 0) for d in debs), 1) or None,
            "note": f"{len(debs)} ważeń",
        })
    chain.append({
        "stage": "stock",
        "title": "Magazyn surowca",
        "kg": kg_avail,
        "current": True,
        "note": "stan bieżący",
    })
    issues = _issues_step(movements)
    if issues:
        chain.append(issues)

    return {
        "stock_type": "raw",
        "header": {
            "batch_no": rb.get("internal_batch_no"),
            "name": rb.get("material_name") or "Ćwiartka z kurczaka",
            "supplier_name": rb.get("supplier_name"),
        },
        "identity": {
            "supplier_batch_no": rb.get("supplier_batch_no"),
            "invoice_no": rb.get("invoice_no"),
            "slaughter_date": str(rb.get("slaughter_date") or "")[:10] or None,
            "received_date": str(rb.get("received_date") or "")[:10] or None,
            "expiry_date": str(rb.get("expiry_date") or "")[:10] or None,
            "notes": rb.get("notes") or None,
        },
        "stock": {
            "kg_initial": float(rb.get("kg_received") or 0) or None,
            "kg_available": kg_avail,
            "kg_reserved": None,
        },
        "chain": chain,
        "movements": movements,
    }


def _card_meat(stock_id: str) -> Dict[str, Any]:
    ms = query_one(
        """SELECT m.*, b.supplier_name, b.supplier_batch_no, b.slaughter_date,
                  b.received_date, b.invoice_no, b.internal_batch_no AS rb_no
           FROM meat_stock m LEFT JOIN raw_batches b ON b.id = m.raw_batch_id
           WHERE m.id=%s""",
        (stock_id,),
    )
    if not ms:
        raise HTTPException(404, "Nie znaleziono lotu mięsa")
    movements = _movements("meat", stock_id)
    debs = _deboning_entries(ms.get("raw_batch_id") or "") if ms.get("raw_batch_id") else []

    chain: List[Dict[str, Any]] = [_supplier_step(ms)]
    chain.append(_reception_step({
        "internal_batch_no": ms.get("rb_no") or ms.get("raw_batch_no"),
        "received_date": ms.get("received_date"),
        "kg_received": None,
        "invoice_no": ms.get("invoice_no"),
    }))
    if debs:
        chain.append({
            "stage": "deboning",
            "title": "Rozbiór",
            "date": str(debs[-1].get("created_at") or "")[:10] or None,
            "kg": round(sum(float(d.get("kg_meat") or 0) for d in debs), 1) or None,
            "note": debs[-1].get("yield_pct") is not None
                and f"wydajność {debs[-1]['yield_pct']}%" or None,
        })
    chain.append({
        "stage": "stock",
        "title": "Magazyn surowca",
        "kg": float(ms.get("kg_available") or 0),
        "current": True,
        "note": "stan bieżący",
    })
    issues = _issues_step(movements)
    if issues:
        chain.append(issues)

    return {
        "stock_type": "meat",
        "header": {
            "batch_no": ms.get("lot_no") or ms.get("raw_batch_no"),
            "name": ms.get("material_name") or "Mięso z/s",
            "supplier_name": ms.get("supplier_name"),
        },
        "identity": {
            "raw_batch_no": ms.get("rb_no") or ms.get("raw_batch_no"),
            "supplier_batch_no": ms.get("supplier_batch_no"),
            "invoice_no": ms.get("invoice_no"),
            "slaughter_date": str(ms.get("slaughter_date") or "")[:10] or None,
            "received_date": str(ms.get("received_date") or "")[:10] or None,
            "production_date": str(ms.get("production_date") or "")[:10] or None,
            "expiry_date": str(ms.get("expiry_date") or "")[:10] or None,
        },
        "stock": {
            "kg_initial": float(ms.get("kg_initial") or 0) or None,
            "kg_available": float(ms.get("kg_available") or 0),
            "kg_reserved": float(ms.get("kg_reserved") or 0) or None,
        },
        "chain": chain,
        "movements": movements,
    }


def _card_byproduct(stock_id: str) -> Dict[str, Any]:
    lot = query_one(
        """SELECT l.*, b.supplier_name, b.supplier_batch_no, b.slaughter_date,
                  b.received_date, b.invoice_no, b.expiry_date,
                  b.internal_batch_no AS rb_no,
                  bb.backs_at, bb.bones_at, bb.backs_kg, bb.bones_kg, bb.operator
           FROM byproduct_lots l
           LEFT JOIN raw_batches b ON b.id = l.raw_batch_id
           LEFT JOIN batch_byproducts bb ON bb.raw_batch_id = l.raw_batch_id
           WHERE l.id=%s""",
        (stock_id,),
    )
    if not lot:
        raise HTTPException(404, "Nie znaleziono lotu ubocznych")
    is_backs = lot["kind"] == "backs"
    movements = _movements("byproduct", stock_id)
    weighed_at = lot.get("backs_at") if is_backs else lot.get("bones_at")
    weighed_kg = lot.get("backs_kg") if is_backs else lot.get("bones_kg")
    kg_now = float(lot.get("kg") or 0)
    kg_out = round(sum(-m["qty"] for m in movements if m["qty"] < 0), 3)

    # Rejestr nie ma IN dla ubocznych (powstają przy ważeniu na HMI) —
    # dokładamy syntetyczny przychód, żeby historia zaczynała się od wagi.
    kg_in = float(weighed_kg or 0) or round(kg_now + kg_out, 3)
    if kg_in > 0:
        movements.insert(0, {
            "id": f"synthetic-{stock_id}",
            "date": str(weighed_at or lot.get("created_at") or ""),
            "movement_type": "IN",
            "qty": kg_in,
            "source_type": "deboning",
            "label": "Ważenie zbiorcze na rozbiorze",
            "number": None,
            "detail": lot.get("operator"),
            "ref_kind": None,
            "ref_id": None,
        })

    name = "Grzbiety z kurczaka" if is_backs else "Kości z kurczaka"
    chain: List[Dict[str, Any]] = [
        _supplier_step(lot),
        _reception_step({
            "internal_batch_no": lot.get("rb_no") or lot.get("raw_batch_no"),
            "received_date": lot.get("received_date"),
            "kg_received": None,
            "invoice_no": lot.get("invoice_no"),
        }),
        {
            "stage": "deboning",
            "title": "Rozbiór — ważenie zbiorcze",
            "date": str(weighed_at or lot.get("created_at") or "")[:10] or None,
            "kg": kg_in or None,
            "note": lot.get("operator") or None,
        },
        {
            "stage": "stock",
            "title": "Magazyn ubocznych",
            "kg": kg_now,
            "current": True,
            "note": "stan bieżący",
        },
    ]
    issues = _issues_step(movements)
    if issues:
        chain.append(issues)

    return {
        "stock_type": "byproduct",
        "header": {
            "batch_no": lot.get("raw_batch_no"),
            "name": name,
            "supplier_name": lot.get("supplier_name"),
        },
        "identity": {
            "raw_batch_no": lot.get("rb_no") or lot.get("raw_batch_no"),
            "supplier_batch_no": lot.get("supplier_batch_no"),
            "invoice_no": lot.get("invoice_no"),
            "slaughter_date": str(lot.get("slaughter_date") or "")[:10] or None,
            "received_date": str(lot.get("received_date") or "")[:10] or None,
            "weighed_at": str(weighed_at or "")[:10] or None,
            "expiry_date": str(lot.get("expiry_date") or "")[:10] or None,
        },
        "stock": {
            "kg_initial": kg_in or None,
            "kg_available": kg_now,
            "kg_reserved": None,
        },
        "chain": chain,
        "movements": movements,
    }
