"""Księga nośników zwrotnych — saldo pojemników E2 i palet per kontrahent.

KONWENCJA ZNAKU (jedyna, obowiązująca w całym systemie):
    qty > 0 — nośniki przyjechały DO NAS  (dostawa surowca)  → MY jesteśmy winni
    qty < 0 — nośniki wyjechały OD NAS    (WZ, zwrot pustych) → ONI są winni

Saldo = SUM(qty). Zero = rozliczone. Nie ma kolumny `direction` — kierunek to
znak, dzięki czemu saldo jest zwykłą sumą i nie da się go policzyć źle.

KSIĘGOWANIE RÓŻNICOWE: dokument źródłowy (przyjęcie, WZ) można edytować
i anulować, a inwariant „no data loss" zabrania kasowania i cichych
update'ów. Dlatego `book_target` doprowadza SUMĘ ruchów danego źródła do
zadanej wartości, DOPISUJĄC różnicę — historia zostaje w całości.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.containers import ASSET_TYPES
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

# Opis źródła ruchu na kartotece i wydruku wyciągu.
SOURCE_LABELS = {
    "raw_batch": "Przyjęcie surowca",
    "wz": "WZ towaru",
    "container_doc": "WZ na pojemniki",
    "manual": "Wpis ręczny",
}


def _zero_balance() -> Dict[str, int]:
    return {a: 0 for a in ASSET_TYPES}


# ── Księgowanie ──────────────────────────────────────────────────────
def book_target(
    conn,
    *,
    partner_id: str,
    asset_type: str,
    source_type: str,
    source_id: Optional[str],
    target_qty: int,
    movement_date: str,
    doc_id: Optional[str] = None,
    note: str = "",
    confirmed: bool = False,
    created_by: Optional[str] = None,
) -> int:
    """Doprowadza SUMĘ ruchów dla (source_type, source_id, asset_type) do
    `target_qty`, dopisując różnicę jako nowy wiersz. Zwraca dopisaną deltę.

    Idempotentne: powtórne wywołanie z tym samym `target_qty` zwraca 0
    i nie tworzy wiersza. Anulowanie źródła = wywołanie z `target_qty=0`.
    """
    if asset_type not in ASSET_TYPES:
        raise HTTPException(400, f"Nieznany rodzaj nośnika: {asset_type}")

    row = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(qty),0) AS booked FROM container_movements "
        "WHERE source_type=%s AND source_id IS NOT DISTINCT FROM %s AND asset_type=%s",
        (source_type, source_id, asset_type))
    delta = int(target_qty) - int(row["booked"] or 0)
    if delta == 0:
        return 0

    cx_execute(
        conn,
        "INSERT INTO container_movements "
        "(id, partner_id, asset_type, qty, source_type, source_id, doc_id, "
        " movement_date, confirmed, note, created_by, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (cuid(), partner_id, asset_type, delta, source_type, source_id, doc_id,
         movement_date, confirmed, note, created_by, now_iso()))
    return delta


def book_assets(
    conn,
    *,
    partner_id: str,
    source_type: str,
    source_id: Optional[str],
    targets: Dict[str, int],
    movement_date: str,
    doc_id: Optional[str] = None,
    note: str = "",
    confirmed: bool = False,
    created_by: Optional[str] = None,
) -> Dict[str, int]:
    """`book_target` dla wszystkich trzech nośników naraz. Brakujący klucz
    w `targets` znaczy 0 — dzięki temu anulowanie to `targets={}`."""
    return {
        a: book_target(
            conn, partner_id=partner_id, asset_type=a, source_type=source_type,
            source_id=source_id, target_qty=int(targets.get(a) or 0),
            movement_date=movement_date, doc_id=doc_id, note=note,
            confirmed=confirmed, created_by=created_by)
        for a in ASSET_TYPES
    }


def partner_balance_cx(conn, partner_id: str) -> Dict[str, int]:
    """Saldo partnera per nośnik — w trwającej transakcji."""
    out = _zero_balance()
    for r in cx_query_all(
        conn,
        "SELECT asset_type, COALESCE(SUM(qty),0) AS saldo FROM container_movements "
        "WHERE partner_id=%s GROUP BY asset_type",
        (partner_id,)
    ):
        out[r["asset_type"]] = int(r["saldo"] or 0)
    return out


# ── Odczyty ──────────────────────────────────────────────────────────
def balances(q: str = "", nonzero: bool = False) -> List[Dict[str, Any]]:
    """Salda wszystkich partnerów per nośnik.

    Role pobierane PODZAPYTANIEM, nie JOIN-em: partner będący i dostawcą,
    i odbiorcą zwielokrotniłby wiersze i podwoił SUM(qty).
    """
    rows = query_all(
        """SELECT p.id, p.nip, p.name, p.address,
                  COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='e2'), 0)           AS e2,
                  COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_h1'), 0)    AS pallet_h1,
                  COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_other'), 0) AS pallet_other,
                  COUNT(m.id) FILTER (WHERE NOT m.confirmed)                         AS unconfirmed,
                  MAX(m.movement_date)                                               AS last_movement,
                  (SELECT ARRAY_AGG(DISTINCT l.ref_type)
                     FROM container_partner_links l WHERE l.partner_id = p.id)       AS roles
             FROM container_partners p
             LEFT JOIN container_movements m ON m.partner_id = p.id
            WHERE p.active
            GROUP BY p.id, p.nip, p.name, p.address
            ORDER BY p.name""")
    needle = (q or "").strip().lower()
    out = []
    for r in rows:
        rec = {
            "id": r["id"], "nip": r["nip"] or "", "name": r["name"],
            "address": r["address"] or "",
            "e2": int(r["e2"]), "pallet_h1": int(r["pallet_h1"]),
            "pallet_other": int(r["pallet_other"]),
            "unconfirmed": int(r["unconfirmed"] or 0),
            "last_movement": str(r["last_movement"] or "")[:10] or None,
            "roles": sorted(r["roles"] or []),
        }
        if nonzero and not (rec["e2"] or rec["pallet_h1"] or rec["pallet_other"]):
            continue
        if needle and needle not in f"{rec['name']} {rec['nip']}".lower():
            continue
        out.append(rec)
    return out


def _movement_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["id"], "partnerId": r["partner_id"], "assetType": r["asset_type"],
        "qty": int(r["qty"]), "sourceType": r["source_type"], "sourceId": r["source_id"],
        "sourceLabel": SOURCE_LABELS.get(r["source_type"], r["source_type"]),
        "docId": r.get("doc_id"), "docNumber": r.get("doc_number"),
        "movementDate": str(r["movement_date"])[:10],
        "confirmed": bool(r["confirmed"]), "note": r.get("note") or "",
    }


def movements(
    partner_id: str = "", date_from: str = "", date_to: str = "",
    unconfirmed_only: bool = False, include_reversed: bool = False,
) -> List[Dict[str, Any]]:
    """Ruchy nośników. Domyślnie POMIJA źródła w całości odwrócone —
    anulowany WZ zostawia parę −225/+225, która nic nie wnosi do salda,
    a zaśmieca kartotekę. Wierszy NIE kasujemy (ślad audytowy zostaje);
    `include_reversed=True` pokazuje je z powrotem."""
    where, params = ["1=1"], []
    if partner_id:
        where.append("m.partner_id=%s")
        params.append(partner_id)
    if date_from:
        where.append("m.movement_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("m.movement_date <= %s")
        params.append(date_to)
    if unconfirmed_only:
        where.append("NOT m.confirmed")
    rows = query_all(
        "SELECT m.*, d.number AS doc_number, "
        "       SUM(m.qty) OVER (PARTITION BY m.source_type, m.source_id) AS src_total, "
        "       COUNT(*)   OVER (PARTITION BY m.source_type, m.source_id) AS src_count "
        "  FROM container_movements m "
        "  LEFT JOIN container_docs d ON d.id = m.doc_id "
        f" WHERE {' AND '.join(where)} "
        " ORDER BY m.movement_date, m.created_at", params)
    out = []
    for r in rows:
        is_reversed = int(r["src_total"] or 0) == 0 and int(r["src_count"] or 0) > 1
        if is_reversed and not include_reversed:
            continue
        out.append({**_movement_dto(r), "reversed": is_reversed})
    return out


def pending_groups(partner_id: str = "") -> List[Dict[str, Any]]:
    """Źródła z co najmniej jednym NIEPOTWIERDZONYM ruchem — sekcja
    „Do rozliczenia". Grupujemy po źródle, nie po wierszu: biuro przegląda
    całe przyjęcie / całe WZ, a nie pojedynczy nośnik."""
    params: List[Any] = []
    where = (
        "EXISTS (SELECT 1 FROM container_movements x "
        "         WHERE x.source_type=m.source_type "
        "           AND x.source_id IS NOT DISTINCT FROM m.source_id "
        "           AND NOT x.confirmed)")
    if partner_id:
        where += " AND m.partner_id=%s"
        params.append(partner_id)
    rows = query_all(
        "SELECT m.partner_id, m.source_type, m.source_id, "
        "       MIN(m.movement_date) AS first_date, "
        "       COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='e2'),0) AS e2, "
        "       COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_h1'),0) AS pallet_h1, "
        "       COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_other'),0) AS pallet_other, "
        "       MIN(m.note) AS note "
        f"  FROM container_movements m WHERE {where} "
        " GROUP BY m.partner_id, m.source_type, m.source_id "
        " ORDER BY MIN(m.movement_date) DESC", params)
    return [{
        "partnerId": r["partner_id"], "sourceType": r["source_type"],
        "sourceId": r["source_id"] or "",
        "sourceLabel": SOURCE_LABELS.get(r["source_type"], r["source_type"]),
        "date": str(r["first_date"])[:10], "note": r["note"] or "",
        "assets": {"e2": int(r["e2"]), "pallet_h1": int(r["pallet_h1"]),
                   "pallet_other": int(r["pallet_other"])},
    } for r in rows]


# ── Zapisy z biura ───────────────────────────────────────────────────
def correct_group(
    partner_id: str, source_type: str, source_id: str,
    targets: Dict[str, int], confirm: bool = False,
) -> Dict[str, Any]:
    """Korekta liczb z biura: ustawia sumy nośników dla źródła (append-only
    delta) i opcjonalnie potwierdza całą grupę."""
    sid = source_id or None
    with transaction() as conn:
        book_assets(conn, partner_id=partner_id, source_type=source_type, source_id=sid,
                    targets=targets, movement_date=date.today().isoformat(),
                    note="Korekta biura", confirmed=confirm)
        if confirm:
            cx_execute(
                conn,
                "UPDATE container_movements SET confirmed=true "
                "WHERE source_type=%s AND source_id IS NOT DISTINCT FROM %s",
                (source_type, sid))
        bal = partner_balance_cx(conn, partner_id)
    logger.info("containers.group.corrected",
                extra={"partner_id": partner_id, "src_type": source_type})
    return {"balance": bal}


def create_manual_movement(
    partner_id: str, asset_type: str, qty: int, movement_date: str = "", note: str = "",
) -> Dict[str, Any]:
    """Ruch ręczny (`source_type='manual'`). `qty` ZE ZNAKIEM — dodatnie
    przyjechało do nas, ujemne wyjechało. Każdy taki wpis ma własne
    `source_id`, więc nigdy nie zlewa się z innym."""
    if asset_type not in ASSET_TYPES:
        raise HTTPException(400, f"Nieznany rodzaj nośnika: {asset_type}")
    if int(qty) == 0:
        raise HTTPException(400, "Ilość ruchu nie może być zerowa")
    mid = cuid()
    with transaction() as conn:
        book_target(conn, partner_id=partner_id, asset_type=asset_type,
                    source_type="manual", source_id=mid, target_qty=int(qty),
                    movement_date=movement_date or date.today().isoformat(),
                    note=note, confirmed=True)
        bal = partner_balance_cx(conn, partner_id)
    return {"id": mid, "balance": bal}


# ── Wyciąg za okres ──────────────────────────────────────────────────
def statement(partner_id: str, date_from: str, date_to: str) -> Dict[str, Any]:
    """Potwierdzenie salda: saldo otwarcia (wszystko PRZED `date_from`),
    ruchy w oknie z saldem narastająco, saldo zamknięcia."""
    if not partner_id:
        raise HTTPException(400, "Wskaż kontrahenta")
    partner = query_one("SELECT * FROM container_partners WHERE id=%s", (partner_id,))
    if not partner:
        raise HTTPException(404, "Kontrahent pojemnikowy nie istnieje")

    opening = _zero_balance()
    if date_from:
        for r in query_all(
            "SELECT asset_type, COALESCE(SUM(qty),0) AS s FROM container_movements "
            "WHERE partner_id=%s AND movement_date < %s GROUP BY asset_type",
            (partner_id, date_from)
        ):
            opening[r["asset_type"]] = int(r["s"] or 0)

    running = dict(opening)
    rows = []
    for m in movements(partner_id=partner_id, date_from=date_from, date_to=date_to):
        running[m["assetType"]] += m["qty"]
        rows.append({**m, "balanceAfter": dict(running)})

    return {
        "partner": {"id": partner["id"], "name": partner["name"],
                    "nip": partner["nip"] or "", "address": partner["address"] or ""},
        "from": date_from, "to": date_to,
        "opening": opening, "movements": rows, "closing": running,
    }
