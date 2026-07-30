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
from app.services.container_ledger_service import (
    _asset_sum_cols, book_assets, partner_balance_cx,
)
from app.services.container_partners_service import resolve_partner, resolve_partner_by_nip
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


def _normalize_lines(lines: List[Dict[str, Any]], allow_empty: bool = False) -> List[Dict[str, int]]:
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
    if not allow_empty and not any(line["in_qty"] or line["out_qty"] for line in out):
        raise HTTPException(400, "Dokument musi zawierać co najmniej jedną ilość")
    return out


def _normalize_sources(
    linked_sources: Optional[List[Dict[str, Any]]],
    linked_source_type: str = "",
    linked_source_id: str = "",
) -> List[Dict[str, str]]:
    """Lista powiązanych źródeł. Przyjmuje też stary, pojedynczy kontrakt."""
    raw = list(linked_sources or [])
    if not raw and linked_source_id:
        raw = [{"sourceType": linked_source_type or "raw_batch",
                "sourceId": linked_source_id}]
    out, seen = [], set()
    for item in raw:
        sid = (item.get("sourceId") or item.get("source_id") or "").strip()
        if not sid or sid in seen:
            continue
        seen.add(sid)
        out.append({
            "sourceType": item.get("sourceType") or item.get("source_type") or "raw_batch",
            "sourceId": sid,
        })
    return out


def _sources_sign(conn, sources: List[Dict[str, str]]) -> int:
    """Znak zwrotu = PRZECIWNY do tego, co zaksięgowały źródła.

    Dostawca (przyjęcie) wniósł nośniki na saldo (+), więc jego zwrot je
    zdejmuje (−). Odbiorca (WZ) zabrał nasze (−), więc jego zwrot je
    przywraca (+). Bez tej reguły „oddali 225" u odbiorcy zrobiłoby saldo
    −450 zamiast zera.

    Wszystkie źródła jednego druku muszą mieć TEN SAM kierunek — jeden zwrot
    nie może księgować się naraz na plus i na minus.
    """
    signs = set()
    for src in sources:
        row = cx_query_one(
            conn,
            "SELECT COALESCE(SUM(qty),0) AS s FROM container_movements "
            "WHERE source_type=%s AND source_id=%s",
            (src["sourceType"], src["sourceId"]))
        total = int(row["s"] or 0)
        if total:
            signs.add(-1 if total > 0 else 1)
    if len(signs) > 1:
        raise HTTPException(
            400, "Jeden druk nie może łączyć dostaw z wydaniami — zwrot miałby dwa kierunki")
    return signs.pop() if signs else -1


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
    linked_source_type: str = "",
    linked_source_id: str = "",
    linked_sources: Optional[List[Dict[str, Any]]] = None,
    pending_return: bool = False,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Wystawia dokument i księguje ruchy.

    BEZ powiązania: księguje `in − out` (nośniki przyjechały poza dostawą
    towaru, np. puste pojemniki podrzucone do napełnienia).

    Z powiązaniem (`linked_source_id`): kolumna „Dostawa / odbiór" jest tylko
    REFERENCJĄ — te nośniki zaksięgowało już przyjęcie surowca. Księgujemy
    WYŁĄCZNIE zwrot (`−out`), inaczej jedna fizyczna dostawa 600 sztuk
    podbiłaby saldo o 1200. Na druku obie kolumny widnieją normalnie.
    """
    norm = _normalize_lines(lines or [], allow_empty=pending_return)
    sources = _normalize_sources(linked_sources, linked_source_type, linked_source_id)
    linked = bool(sources)
    if pending_return:
        # Druk jedzie do kontrahenta z PUSTĄ kolumną zwrotu — wypełnia ją
        # on ręcznie, my wpisujemy faktyczną liczbę po powrocie kierowcy.
        for line in norm:
            line["out_qty"] = 0
    day = (doc_date or date.today().isoformat())[:10]
    ym = f"{day[2:4]}{day[5:7]}"  # 'RRMM' z daty dokumentu

    with transaction() as conn:
        pid = partner_id or resolve_partner(conn, ref_type, ref_id)
        if sources:
            _sources_sign(conn, sources)   # waliduje spójność kierunku
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
            " driver, vehicle, lines, balance_after, status, notes, "
            " linked_source_type, linked_source_id, linked_sources, "
            " created_by, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}',%s,%s,%s,%s,%s,%s,%s)",
            (did, format_container_doc_number(seq, ym), seq, ym, pid,
             json.dumps(snapshot), json.dumps(_seller_block()), day,
             driver or "", vehicle or "", json.dumps(norm),
             "oczekuje" if pending_return else "wystawiony", notes or "",
             sources[0]["sourceType"] if sources else None,
             sources[0]["sourceId"] if sources else None,
             json.dumps(sources), created_by, now_iso()))

        # Powiązana dostawa jest już zaksięgowana przez przyjęcie — z tego
        # dokumentu księgujemy wtedy sam zwrot.
        targets = {
            line["asset_type"]: (-line["out_qty"] if linked
                                 else line["in_qty"] - line["out_qty"])
            for line in norm
        }
        book_assets(
            conn, partner_id=pid, source_type="container_doc", source_id=did,
            targets=targets, movement_date=day, doc_id=did,
            note="WZ na pojemniki", confirmed=True, created_by=created_by)

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
        "linkedSourceType": row.get("linked_source_type"),
        "linkedSourceId": row.get("linked_source_id"),
        "linkedSources": (row.get("linked_sources") if isinstance(row.get("linked_sources"), list)
                          else json.loads(row.get("linked_sources") or "[]")),
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


def create_doc_from_wz(
    *, wz_id: str, driver: str = "", vehicle: str = "",
    containers: Optional[int] = None,
    pallets_h1: int = 0, pallets_other: int = 0, notes: str = "",
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Druk na pojemniki wprost z WZ towaru — kolumna „Dostawa / odbiór"
    bierze pojemniki z pozycji WZ, kolumna „Zwrot" wychodzi PUSTA.

    Kontrahent wpisuje zwrot długopisem, kierowca wraca z podpisaną kopią,
    a biuro dopisuje faktyczną liczbę przez `settle_doc`.
    """
    wz = query_one(
        "SELECT id, number, buyer_name, buyer_address, buyer_nip, lines, "
        "       pallets_other_kind, release_date, issued_date, status "
        "FROM wz_documents WHERE id=%s", (wz_id,))
    if not wz:
        raise HTTPException(404, "Dokument WZ nie istnieje")
    if wz["status"] == "anulowany":
        raise HTTPException(409, "WZ jest anulowany — nie wystawiaj do niego druku pojemników")

    lines = wz["lines"]
    if not isinstance(lines, list):
        lines = json.loads(lines or "[]")
    # Domyślnie suma pojemników z ważeń (pozycje WZ); operator mógł ją
    # poprawić w formularzu, bo tylko on widzi, co faktycznie wjechało na auto.
    if containers is not None:
        e2 = int(containers)
    else:
        e2 = 0
        for line in lines:
            try:
                e2 += int(line.get("containers") or 0)
            except (TypeError, ValueError):
                continue
    if not (e2 or pallets_h1 or pallets_other):
        raise HTTPException(400, "To WZ nie ma pojemników ani palet do rozliczenia")

    with transaction() as conn:
        partner_id = resolve_partner_by_nip(
            conn, wz.get("buyer_nip") or "", wz.get("buyer_name") or "",
            wz.get("buyer_address") or "")

    return create_doc(
        partner_id=partner_id,
        doc_date=str(wz.get("release_date") or wz.get("issued_date") or "")[:10],
        driver=driver, vehicle=vehicle, notes=notes,
        linked_source_type="wz", linked_source_id=wz_id, pending_return=True,
        lines=[{"assetType": "e2", "inQty": e2, "outQty": 0},
               {"assetType": "pallet_h1", "inQty": int(pallets_h1 or 0), "outQty": 0},
               {"assetType": (wz.get("pallets_other_kind") or "pallet_other"),
                "inQty": int(pallets_other or 0), "outQty": 0}],
        created_by=created_by)


def settle_doc(
    doc_id: str, returns: Dict[str, int], created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Wpisuje FAKTYCZNY zwrot po powrocie kierowcy i księguje go.

    Dokument zamyka się przy każdej wpisanej liczbie — także przy zwrocie
    częściowym albo zerowym. Reszta zostaje na saldzie kontrahenta
    i rozliczy się przy kolejnym kursie (decyzja produktowa 2026-07-29).
    """
    with transaction() as conn:
        row = cx_query_one(
            conn,
            "SELECT id, partner_id, status, doc_date, lines, linked_sources "
            "FROM container_docs WHERE id=%s FOR UPDATE", (doc_id,))
        if not row:
            raise HTTPException(404, "Dokument pojemnikowy nie istnieje")
        if row["status"] != "oczekuje":
            raise HTTPException(409, "Ten dokument nie czeka na wpisanie zwrotu")

        lines = row["lines"]
        if not isinstance(lines, list):
            lines = json.loads(lines or "[]")

        srcs = row["linked_sources"]
        if not isinstance(srcs, list):
            srcs = json.loads(srcs or "[]")
        sign = _sources_sign(conn, srcs) if srcs else -1

        targets: Dict[str, int] = {}
        for line in lines:
            asset = line["asset_type"]
            try:
                qty = int(returns.get(asset) or 0)
            except (TypeError, ValueError):
                raise HTTPException(400, "Ilości zwrotu muszą być liczbami całkowitymi")
            if qty < 0:
                raise HTTPException(400, "Ilość zwrotu nie może być ujemna")
            line["out_qty"] = qty
            targets[asset] = sign * qty

        book_assets(
            conn, partner_id=row["partner_id"], source_type="container_doc",
            source_id=doc_id, targets=targets, movement_date=str(row["doc_date"])[:10],
            doc_id=doc_id, note="Zwrot nośników", confirmed=True, created_by=created_by)

        bal = partner_balance_cx(conn, row["partner_id"])
        cx_execute(
            conn,
            "UPDATE container_docs SET lines=%s, balance_after=%s, status='rozliczony' "
            "WHERE id=%s",
            (json.dumps(lines), json.dumps(bal), doc_id))

    logger.info("containers.doc.settled", extra={"doc_id": doc_id})
    return get_doc(doc_id)


def cancel_docs_for_source(source_type: str, source_id: str) -> int:
    """Anuluje druki pojemnikowe powiązane ze źródłem (np. anulowanym WZ).

    Bez tego druk wisiał ze statusem „czeka na zwrot" mimo że towar nigdy
    nie wyjechał — kierowca nie ma czego oddawać. Anulowanie cofa też
    ewentualnie wpisany już zwrot (cancel_doc zeruje ruchy dokumentu).
    """
    rows = query_all(
        "SELECT id FROM container_docs "
        "WHERE status <> 'anulowany' AND linked_sources @> %s::jsonb",
        (json.dumps([{"sourceId": source_id}]),))
    for r in rows:
        cancel_doc(r["id"])
    return len(rows)


def partner_deliveries(partner_id: str, include_settled: bool = False) -> List[Dict[str, Any]]:
    """Dostawy tego kontrahenta do wskazania na dokumencie pojemnikowym.

    Źródłem są ruchy z przyjęć surowca (`source_type='raw_batch'`), bo to one
    wnoszą nośniki na saldo. `settled` oznacza, że do tej dostawy wystawiono
    już dokument — nie blokujemy wyboru (bywają zwroty w kilku turach),
    tylko oznaczamy w UI.
    """
    rows = query_all(
        f"""SELECT m.source_type, m.source_id,
                  MIN(m.movement_date) AS first_date,
                  -- Opis z PIERWSZEGO ruchu, nie MIN() alfabetycznie: po korekcie
                  -- biura dostawa nazywała się „Korekta biura" zamiast „Przyjęcie 453".
                  (array_agg(m.note ORDER BY m.created_at))[1] AS note,
                  {_asset_sum_cols()},
                  EXISTS (SELECT 1 FROM container_docs d
                           WHERE d.status <> 'anulowany'
                             AND d.linked_sources @> jsonb_build_array(
                                   jsonb_build_object('sourceId', m.source_id)))    AS settled
             FROM container_movements m
            WHERE m.partner_id = %s AND m.source_type IN ('raw_batch','wz')
            GROUP BY m.source_type, m.source_id
           -- Netto 0 = źródło w całości odwrócone (anulowany WZ zostawia parę
           -- −225/+225). Nie ma czego rozliczać, więc nie zaśmieca pickera.
           HAVING SUM(m.qty) <> 0
            ORDER BY MIN(m.movement_date) DESC""",
        (partner_id,))
    out = []
    for r in rows:
        qty = {a: int(r[a]) for a in ASSET_TYPES}
        total = sum(qty.values())
        # Kierunek bierzemy ze ZNAKU księgowania; w pickerze pokazujemy same
        # ilości, bo operator myśli „225 pojemników", nie „−225".
        direction = "out" if total < 0 else "in"
        if bool(r["settled"]) and not include_settled:
            continue
        out.append({
            "sourceType": r["source_type"],
            "sourceId": r["source_id"] or "",
            "date": str(r["first_date"])[:10],
            "label": r["note"] or ("WZ towaru" if r["source_type"] == "wz"
                                   else "Przyjęcie surowca"),
            "direction": direction,
            "settled": bool(r["settled"]),
            "assets": {a: abs(v) for a, v in qty.items()},
        })
    return out


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
