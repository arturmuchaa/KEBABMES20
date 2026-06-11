"""Traceability engine + recall + admin repair tools.

Directional tracing (``backward`` from finished_goods to raw, ``forward``
from raw to finished_goods) walks the stored lineage arrays written at
production time. Dynamic resolution kicks in only when stored lineage is
missing — that path is safe to use on older records.
"""
from typing import Any, Dict, List, Optional, Set

from app.db import (
    cx_execute,
    cx_query_all,
    cx_query_one,
    query_all,
    query_one,
    transaction,
)
from app.logging_config import get_logger
from app.services.deboning_service import _map_deboning_entry
from app.services.mixing_service import build_mixing_order

logger = get_logger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────

def _seen(lst: List[Dict]) -> Set[str]:
    return {x["id"] for x in lst if x.get("id")}


# ── Dezambiguacja gołego numeru partii ────────────────────────────────
# Ten sam numer (np. „347") bywa jednocześnie surowcem, lotem mięsa i partią
# masowania (skutek numeracji bez prefiksów). Linki w bazie idą po UUID, więc
# integralność jest OK — ale ręczny lookup po numerze musi pokazać WSZYSTKIE
# pasujące obiekty z etykietą etapu, zamiast po cichu wybierać jeden.

STAGE_LABELS = {
    "finished_goods": "Wyrób gotowy",
    "seasoned_meat": "Mięso przyprawione (masowanie)",
    "meat_lot": "Mięso po rozbiorze (lot)",
    "raw_batch": "Surowiec (przyjęcie)",
}
# Kolejność wyświetlania: od najbardziej „w dół" procesu do surowca.
_STAGE_ORDER = ["finished_goods", "seasoned_meat", "meat_lot", "raw_batch"]


def label_candidates(candidates: List[Dict]) -> List[Dict]:
    """Dodaj czytelną etykietę etapu i posortuj downstream→surowiec."""
    out = [
        {**c, "stage": STAGE_LABELS.get(c.get("type"), c.get("type"))}
        for c in (candidates or [])
    ]
    out.sort(
        key=lambda c: _STAGE_ORDER.index(c["type"])
        if c.get("type") in _STAGE_ORDER
        else len(_STAGE_ORDER)
    )
    return out


def is_ambiguous(candidates: List[Dict]) -> bool:
    """True, gdy numer wskazuje na więcej niż jeden ETAP (typ obiektu)."""
    return len({c.get("type") for c in (candidates or [])}) > 1


def _resolve_lineage(seasoned_batch_nos: List[str]) -> Dict[str, List[str]]:
    mixing_order_ids: List[str] = []
    seasoned_meat_ids: List[str] = []
    deboning_entry_ids: List[str] = []
    raw_batch_ids: List[str] = []
    supplier_ids: List[str] = []

    for bno in seasoned_batch_nos or []:
        sm = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (bno,))
        if not sm:
            continue
        if sm["id"] not in seasoned_meat_ids:
            seasoned_meat_ids.append(sm["id"])

        for did in sm.get("source_deboning_ids") or []:
            if did and did not in deboning_entry_ids:
                deboning_entry_ids.append(did)

        mo = query_one(
            "SELECT * FROM mixing_orders WHERE order_no=%s",
            (sm.get("mixing_order_no"),),
        )
        if mo and mo["id"] not in mixing_order_ids:
            mixing_order_ids.append(mo["id"])
            lots = query_all(
                """
                SELECT mol.meat_stock_id, ms.raw_batch_id, ms.deboning_session_id
                FROM mixing_order_lots mol
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                WHERE mol.order_id = %s
                """,
                (mo["id"],),
            )
            for lot in lots:
                if (
                    lot.get("deboning_session_id")
                    and lot["deboning_session_id"] not in deboning_entry_ids
                ):
                    deboning_entry_ids.append(lot["deboning_session_id"])
                if (
                    lot.get("raw_batch_id")
                    and lot["raw_batch_id"] not in raw_batch_ids
                ):
                    raw_batch_ids.append(lot["raw_batch_id"])
                    rb = query_one(
                        "SELECT supplier_id FROM raw_batches WHERE id=%s",
                        (lot["raw_batch_id"],),
                    )
                    if (
                        rb
                        and rb.get("supplier_id")
                        and rb["supplier_id"] not in supplier_ids
                    ):
                        supplier_ids.append(rb["supplier_id"])

    return {
        "mixing_order_ids": mixing_order_ids,
        "seasoned_meat_ids": seasoned_meat_ids,
        "deboning_entry_ids": deboning_entry_ids,
        "raw_batch_ids": raw_batch_ids,
        "supplier_ids": supplier_ids,
    }


# ── Backward / forward walks ──────────────────────────────────────────

def _empty_trace() -> Dict[str, List]:
    return {
        "rawBatches": [],
        "deboning": [],
        "meatLots": [],
        "mixingOrders": [],
        "seasonedBatches": [],
        "production": [],
        "finishedGoods": [],
        "suppliers": [],
    }


def _trace_backward(batch_id: str) -> Dict[str, List]:
    result = _empty_trace()

    fg = query_one(
        "SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s",
        (batch_id, batch_id),
    )
    if fg:
        if fg["id"] not in _seen(result["finishedGoods"]):
            result["finishedGoods"].append(fg)
        for mid in fg.get("source_mixing_ids") or []:
            mo = query_one("SELECT * FROM mixing_orders WHERE id=%s", (mid,))
            if mo and mo["id"] not in _seen(result["mixingOrders"]):
                result["mixingOrders"].append(mo)
        for sid in fg.get("source_seasoned_ids") or []:
            sm = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (sid,))
            if sm and sm["id"] not in _seen(result["seasonedBatches"]):
                result["seasonedBatches"].append(sm)
        for did in fg.get("source_deboning_ids") or []:
            de = query_one("SELECT * FROM deboning_entries WHERE id=%s", (did,))
            if de and de["id"] not in _seen(result["deboning"]):
                result["deboning"].append(_map_deboning_entry(de))
        if not result["seasonedBatches"]:
            for sbn in fg.get("seasoned_batch_nos") or []:
                sm = query_one(
                    "SELECT * FROM seasoned_meat WHERE batch_no=%s", (sbn,)
                )
                if sm and sm["id"] not in _seen(result["seasonedBatches"]):
                    result["seasonedBatches"].append(sm)

    if not result["seasonedBatches"]:
        sm = query_one(
            "SELECT * FROM seasoned_meat WHERE id=%s OR batch_no=%s",
            (batch_id, batch_id),
        )
        if sm:
            result["seasonedBatches"].append(sm)

    for sm in list(result["seasonedBatches"]):
        mo_nos = {m.get("order_no") for m in result["mixingOrders"]}
        if sm.get("mixing_order_no") and sm["mixing_order_no"] not in mo_nos:
            mo = query_one(
                "SELECT * FROM mixing_orders WHERE order_no=%s",
                (sm.get("mixing_order_no"),),
            )
            if mo and mo["id"] not in _seen(result["mixingOrders"]):
                result["mixingOrders"].append(mo)

    for mo in list(result["mixingOrders"]):
        lots = query_all(
            """
            SELECT mol.*, ms.lot_no, ms.raw_batch_id, ms.raw_batch_no,
                   ms.deboning_session_id
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            WHERE mol.order_id = %s
            """,
            (mo["id"],),
        )
        # Numery partii płynące przez masowanie = loty mięsa (np. "326"),
        # NIE numer zlecenia (order_no = MAS/dd/mm/rr). Front pokazuje je w łańcuchu.
        seen_bn: list[str] = []
        for lot in lots:
            bn = lot.get("lot_no") or lot.get("raw_batch_no")
            if bn and str(bn) not in seen_bn:
                seen_bn.append(str(bn))
        mo["batch_nos"] = seen_bn
        existing_lot_ids = {x.get("meat_stock_id") for x in result["meatLots"]}
        for lot in lots:
            if (
                lot.get("meat_stock_id")
                and lot["meat_stock_id"] not in existing_lot_ids
            ):
                result["meatLots"].append(lot)
                existing_lot_ids.add(lot["meat_stock_id"])
            if (
                lot.get("deboning_session_id")
                and lot["deboning_session_id"] not in _seen(result["deboning"])
            ):
                de = query_one(
                    "SELECT * FROM deboning_entries WHERE id=%s",
                    (lot["deboning_session_id"],),
                )
                if de:
                    result["deboning"].append(_map_deboning_entry(de))
            if (
                lot.get("raw_batch_id")
                and lot["raw_batch_id"] not in _seen(result["rawBatches"])
            ):
                rb = query_one(
                    "SELECT * FROM raw_batches WHERE id=%s", (lot["raw_batch_id"],)
                )
                if rb:
                    result["rawBatches"].append(rb)
                    sup = query_one(
                        "SELECT * FROM suppliers WHERE id=%s",
                        (rb.get("supplier_id"),),
                    )
                    if sup and sup["id"] not in _seen(result["suppliers"]):
                        result["suppliers"].append(sup)

    return result


def _trace_forward(batch_id: str) -> Dict[str, List]:
    result = _empty_trace()

    rb = query_one(
        "SELECT * FROM raw_batches WHERE id=%s OR internal_batch_no=%s",
        (batch_id, batch_id),
    )
    if not rb:
        de_start = query_one("SELECT * FROM deboning_entries WHERE id=%s", (batch_id,))
        if de_start:
            rb = query_one(
                "SELECT * FROM raw_batches WHERE id=%s",
                (de_start.get("raw_batch_id"),),
            )
    if not rb:
        return result

    result["rawBatches"].append(rb)
    raw_batch_id = rb["id"]
    sup = query_one("SELECT * FROM suppliers WHERE id=%s", (rb.get("supplier_id"),))
    if sup:
        result["suppliers"].append(sup)

    entries = query_all(
        "SELECT * FROM deboning_entries WHERE raw_batch_id=%s", (raw_batch_id,)
    )
    result["deboning"] = [_map_deboning_entry(e) for e in entries]

    meat_stocks = query_all(
        "SELECT * FROM meat_stock WHERE raw_batch_id=%s", (raw_batch_id,)
    )
    for ms in meat_stocks:
        lots = query_all(
            "SELECT * FROM mixing_order_lots WHERE meat_stock_id=%s", (ms["id"],)
        )
        for lot in lots:
            mo = query_one(
                "SELECT * FROM mixing_orders WHERE id=%s", (lot.get("order_id"),)
            )
            if not mo or mo["id"] in _seen(result["mixingOrders"]):
                continue
            result["mixingOrders"].append(mo)

            sbn_list = list(mo.get("source_seasoned_batch_ids") or [])
            if not sbn_list:
                sms_fb = query_all(
                    "SELECT * FROM seasoned_meat WHERE mixing_order_no=%s",
                    (mo.get("order_no"),),
                )
                sbn_list = [s.get("batch_no") for s in sms_fb if s.get("batch_no")]

            for sbn in sbn_list:
                sm = query_one(
                    "SELECT * FROM seasoned_meat WHERE batch_no=%s", (sbn,)
                )
                if sm and sm["id"] not in _seen(result["seasonedBatches"]):
                    result["seasonedBatches"].append(sm)
                    fgs = query_all(
                        "SELECT * FROM finished_goods "
                        "WHERE %s = ANY(seasoned_batch_nos)",
                        (sbn,),
                    )
                    for fg in fgs:
                        if fg["id"] not in _seen(result["finishedGoods"]):
                            result["finishedGoods"].append(fg)

            if not result["finishedGoods"]:
                fgs_fb = query_all(
                    "SELECT * FROM finished_goods "
                    "WHERE %s = ANY(source_mixing_ids)",
                    (mo["id"],),
                )
                for fg in fgs_fb:
                    if fg["id"] not in _seen(result["finishedGoods"]):
                        result["finishedGoods"].append(fg)

    return result


def traceability(batch_id: str, direction: str = "backward") -> Dict[str, List]:
    if direction == "forward":
        return _trace_forward(batch_id)
    return _trace_backward(batch_id)


# ── Recall ────────────────────────────────────────────────────────────

def find_batch_candidates(number: str) -> List[Dict]:
    """Wszystkie obiekty pasujące do gołego numeru partii, z każdego etapu.

    Dopasowanie po numerach „ludzkich" (batch_no / lot_no / internal_batch_no),
    nie po UUID — to one się kolidują. Zwraca [{type, id, number}].
    """
    n = (number or "").strip()
    if not n:
        return []
    out: List[Dict] = []
    for row in query_all(
        "SELECT id, batch_no FROM finished_goods WHERE batch_no=%s", (n,)
    ):
        out.append({"type": "finished_goods", "id": row["id"], "number": row.get("batch_no")})
    for row in query_all(
        "SELECT id, batch_no FROM seasoned_meat WHERE batch_no=%s", (n,)
    ):
        out.append({"type": "seasoned_meat", "id": row["id"], "number": row.get("batch_no")})
    for row in query_all(
        "SELECT id, lot_no FROM meat_stock WHERE lot_no=%s", (n,)
    ):
        out.append({"type": "meat_lot", "id": row["id"], "number": row.get("lot_no")})
    for row in query_all(
        "SELECT id, internal_batch_no FROM raw_batches WHERE internal_batch_no=%s", (n,)
    ):
        out.append({"type": "raw_batch", "id": row["id"], "number": row.get("internal_batch_no")})
    return out


def recall(batch_id: str) -> Dict[str, Any]:
    trace: Dict[str, List] = _empty_trace()
    resolved_via = "string"

    # Skan pojedynczej sztuki (QR 'U|<id>' lub jej id/qr_code) → idź przez TWARDY
    # link FK source_finished_goods_id, nie przez dopasowanie tekstowego batch_no.
    from app.utils.unit_codes import parse_unit_qr

    unit_id = parse_unit_qr(batch_id) or batch_id
    unit = query_one(
        "SELECT * FROM finished_units WHERE id=%s OR qr_code=%s",
        (unit_id, batch_id),
    )
    if unit and unit.get("source_finished_goods_id"):
        trace = _trace_backward(unit["source_finished_goods_id"])
        resolved_via = "fk"
    elif unit and unit.get("batch_no"):
        # Sztuka bez twardego linku (dzień niezamknięty / sierota) — fallback
        # po numerze partii, żeby skan nadal coś zwrócił.
        batch_id = unit["batch_no"]

    fg_direct = (
        None
        if resolved_via == "fk"
        else query_one(
            "SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s",
            (batch_id, batch_id),
        )
    )
    if resolved_via == "fk":
        pass
    elif fg_direct:
        trace = _trace_backward(fg_direct["id"])
        if not trace["finishedGoods"]:
            trace["finishedGoods"] = [fg_direct]
    else:
        sm_direct = query_one(
            "SELECT * FROM seasoned_meat WHERE id=%s OR batch_no=%s",
            (batch_id, batch_id),
        )
        if sm_direct:
            sbn = sm_direct.get("batch_no") or batch_id
            fgs = query_all(
                "SELECT * FROM finished_goods WHERE %s = ANY(seasoned_batch_nos)",
                (sbn,),
            )
            if fgs:
                for fg in fgs:
                    sub = _trace_backward(fg["id"])
                    for k in trace:
                        seen_ids = _seen(trace[k])
                        for item in sub[k]:
                            if item.get("id") not in seen_ids:
                                trace[k].append(item)
                                seen_ids.add(item.get("id"))
            else:
                trace = _trace_backward(sbn)
        else:
            rb_direct = query_one(
                "SELECT * FROM raw_batches WHERE id=%s OR internal_batch_no=%s",
                (batch_id, batch_id),
            )
            if rb_direct:
                trace = _trace_forward(rb_direct["id"])
                if not trace["rawBatches"]:
                    trace["rawBatches"] = [rb_direct]
            else:
                ms_direct = query_one(
                    "SELECT * FROM meat_stock WHERE lot_no=%s OR id=%s",
                    (batch_id, batch_id),
                )
                if ms_direct and ms_direct.get("raw_batch_id"):
                    trace = _trace_forward(ms_direct["raw_batch_id"])

    total_kg = round(
        sum(float(fg.get("total_kg") or 0) for fg in trace["finishedGoods"]), 3
    )
    total_units = sum(int(fg.get("qty") or 0) for fg in trace["finishedGoods"])

    deboning_summary = {
        "totalKgMeat": round(
            sum(float(d.get("kgMeat") or 0) for d in trace["deboning"]), 3
        ),
        "totalKgBones": round(
            sum(float(d.get("kgBones") or 0) for d in trace["deboning"]), 3
        ),
        "totalKgBacks": round(
            sum(float(d.get("kgBacks") or 0) for d in trace["deboning"]), 3
        ),
        "entryCount": len(trace["deboning"]),
    }

    clients: List[Dict] = []
    seen_clients: Set[str] = set()
    for fg in trace["finishedGoods"]:
        cn = fg.get("client_name")
        key = f"{cn}||{fg.get('client_order_no')}"
        if cn and key not in seen_clients:
            seen_clients.add(key)
            clients.append(
                {
                    "clientName": cn,
                    "clientOrderNo": fg.get("client_order_no"),
                    "qty": int(fg.get("qty") or 0),
                    "totalKg": float(fg.get("total_kg") or 0),
                    "producedDate": str(fg.get("produced_date") or ""),
                    "batchNo": fg.get("batch_no"),
                }
            )

    timeline: List[Dict] = []
    for rb in trace["rawBatches"]:
        timeline.append(
            {
                "stage": "Przyjęcie surowca",
                "batchNo": rb.get("internal_batch_no"),
                "date": str(rb.get("received_date") or rb.get("created_at") or ""),
                "details": f"{rb.get('supplier_name','?')} · {rb.get('kg_received',0)} kg",
            }
        )
    for de in trace["deboning"]:
        timeline.append(
            {
                "stage": "Rozbiór",
                "batchNo": de.get("rawBatchNo"),
                "date": str(de.get("createdAt") or ""),
                "details": f"Mięso: {de.get('kgMeat',0)} kg · Wydajność: {de.get('yieldPct',0)}%",
            }
        )
    for sm in trace["seasonedBatches"]:
        timeline.append(
            {
                "stage": "Masowanie",
                "batchNo": sm.get("batch_no"),
                "date": str(sm.get("created_at") or ""),
                "details": f"{sm.get('recipe_name','?')} · {sm.get('kg_produced',0)} kg",
            }
        )
    for fg in trace["finishedGoods"]:
        timeline.append(
            {
                "stage": "Wyrób gotowy",
                "batchNo": fg.get("batch_no"),
                "date": str(fg.get("produced_date") or fg.get("created_at") or ""),
                "details": (
                    f"{fg.get('qty',0)} szt · "
                    f"{fg.get('total_kg',0)} kg → {fg.get('client_name','?')}"
                ),
            }
        )
    timeline.sort(key=lambda x: x.get("date") or "")

    documents: List[Dict] = []
    rb_ids = [rb["id"] for rb in trace["rawBatches"] if rb.get("id")]
    if rb_ids:
        invs = query_all(
            "SELECT invoice_no, invoice_date, total_gross, category FROM invoices "
            "WHERE raw_batch_id = ANY(%s::text[])",
            (rb_ids,),
        )
        for inv in invs:
            if inv.get("invoice_no"):
                documents.append(
                    {
                        "type": "Faktura zakupowa",
                        "number": inv.get("invoice_no"),
                        "date": str(inv.get("invoice_date") or ""),
                        "value": float(inv.get("total_gross") or 0),
                    }
                )
    for fg in trace["finishedGoods"]:
        if fg.get("client_order_no"):
            documents.append(
                {
                    "type": "Zamówienie klienta",
                    "number": fg.get("client_order_no"),
                    "date": str(fg.get("produced_date") or ""),
                    "value": float(fg.get("total_kg") or 0),
                }
            )

    # Dezambiguacja: czy ten numer pasuje też do innych etapów? (tylko dla
    # ścieżki po numerze — skan sztuki przez FK jest jednoznaczny).
    candidates: List[Dict] = []
    ambiguous = False
    if resolved_via != "fk":
        candidates = label_candidates(find_batch_candidates(batch_id))
        ambiguous = is_ambiguous(candidates)

    # Produkty uboczne (ABP) z partii surowca w łańcuchu — gdzie poszły kości/grzbiety/odpad.
    from app.services.byproducts_service import byproducts_for_raw_batch

    byproducts: List[Dict] = []
    for rb in trace["rawBatches"]:
        if rb.get("id"):
            byproducts.extend(byproducts_for_raw_batch(rb["id"]))

    return {
        "batchId": batch_id,
        "resolvedVia": resolved_via,
        "candidates": candidates,
        "ambiguous": ambiguous,
        "byproducts": byproducts,
        "raw_batches": trace["rawBatches"],
        "deboning": trace["deboning"],
        "deboning_summary": deboning_summary,
        "seasoned": trace["seasonedBatches"],
        "mixing_orders": trace["mixingOrders"],
        "production": trace["production"],
        "finished": trace["finishedGoods"],
        "clients": clients,
        "suppliers": trace["suppliers"],
        "total_kg": total_kg,
        "total_units": total_units,
        "timeline": timeline,
        "documents": documents,
    }


# ── Debug: chain verification for one finished_goods row ─────────────

def debug_trace(finished_good_id: str) -> Dict[str, Any]:
    fg = query_one(
        "SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s",
        (finished_good_id, finished_good_id),
    )
    if not fg:
        from fastapi import HTTPException

        raise HTTPException(404, "Wyrób gotowy nie znaleziony")

    deboning: List[Dict] = []
    for did in fg.get("source_deboning_ids") or []:
        de = query_one("SELECT * FROM deboning_entries WHERE id=%s", (did,))
        if de:
            deboning.append(_map_deboning_entry(de))

    seasoned: List[Dict] = []
    for sid in fg.get("source_seasoned_ids") or []:
        sm = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (sid,))
        if sm:
            seasoned.append(sm)
    if not seasoned and fg.get("seasoned_batch_nos"):
        for bno in fg["seasoned_batch_nos"] or []:
            sm = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (bno,))
            if sm and sm["id"] not in {s["id"] for s in seasoned}:
                seasoned.append(sm)

    mixing: List[Dict] = []
    for mid in fg.get("source_mixing_ids") or []:
        mo = query_one("SELECT * FROM mixing_orders WHERE id=%s", (mid,))
        if mo:
            mixing.append(build_mixing_order(mo))

    raw_batches: List[Dict] = []
    seen_rb: Set[str] = set()
    for de in deboning:
        rb_id = de.get("rawBatchId")
        if rb_id and rb_id not in seen_rb:
            seen_rb.add(rb_id)
            rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (rb_id,))
            if rb:
                raw_batches.append(rb)

    missing_links = {
        "has_seasoned_batch_nos": bool(fg.get("seasoned_batch_nos")),
        "has_source_seasoned_ids": bool(fg.get("source_seasoned_ids")),
        "has_source_mixing_ids": bool(fg.get("source_mixing_ids")),
        "has_source_deboning_ids": bool(fg.get("source_deboning_ids")),
        "deboning_resolved": bool(deboning),
        "seasoned_resolved": bool(seasoned),
        "mixing_resolved": bool(mixing),
        "raw_batches_resolved": bool(raw_batches),
    }
    chain_complete = all(
        [
            missing_links["has_seasoned_batch_nos"],
            missing_links["seasoned_resolved"],
            missing_links["deboning_resolved"],
        ]
    )

    return {
        "finished": fg,
        "deboning": deboning,
        "seasoned": seasoned,
        "mixing": mixing,
        "raw_batches": raw_batches,
        "chain_complete": chain_complete,
        "missing_links": missing_links,
    }


# ── Admin: repair historical lineage ──────────────────────────────────

def repair_lineage() -> Dict[str, Any]:
    fixed_seasoned = 0
    fixed_finished = 0
    errors: List[str] = []

    with transaction() as conn:
        batches = cx_query_all(
            conn,
            "SELECT * FROM seasoned_meat "
            "WHERE source_deboning_ids = '{}' OR source_deboning_ids IS NULL",
        )
        for sm in batches:
            try:
                mo = cx_query_one(
                    conn,
                    "SELECT * FROM mixing_orders WHERE order_no=%s",
                    (sm.get("mixing_order_no"),),
                )
                if not mo:
                    continue
                lots = cx_query_all(
                    conn,
                    """
                    SELECT mol.meat_stock_id, ms.deboning_session_id, ms.raw_batch_id
                    FROM mixing_order_lots mol
                    LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                    WHERE mol.order_id = %s
                    """,
                    (mo["id"],),
                )
                deboning_ids = list(
                    {
                        lt["deboning_session_id"]
                        for lt in lots
                        if lt.get("deboning_session_id")
                    }
                )
                if deboning_ids:
                    cx_execute(
                        conn,
                        """
                        UPDATE seasoned_meat
                        SET source_deboning_ids = %s::text[]
                        WHERE id = %s
                          AND (source_deboning_ids = '{}' OR source_deboning_ids IS NULL)
                        """,
                        (deboning_ids, sm["id"]),
                    )
                    fixed_seasoned += 1
                cx_execute(
                    conn,
                    """
                    UPDATE mixing_orders
                    SET source_seasoned_batch_ids = (
                        SELECT ARRAY(SELECT DISTINCT unnest(
                            COALESCE(source_seasoned_batch_ids,'{}') || ARRAY[%s]
                        ))
                    )
                    WHERE id = %s
                    """,
                    (sm["batch_no"], mo["id"]),
                )
            except Exception as e:
                errors.append(f"seasoned_meat {sm.get('batch_no')}: {e}")

        fgs = cx_query_all(
            conn,
            """
            SELECT * FROM finished_goods
            WHERE (source_mixing_ids = '{}' OR source_mixing_ids IS NULL)
              AND seasoned_batch_nos IS NOT NULL
              AND array_length(seasoned_batch_nos, 1) > 0
            """,
        )

    # Resolve lineage outside the write transaction to avoid long locks
    for fg in fgs:
        try:
            lin = _resolve_lineage(fg.get("seasoned_batch_nos") or [])
            if not lin["mixing_order_ids"] and not lin["deboning_entry_ids"]:
                continue
            with transaction() as conn2:
                cx_execute(
                    conn2,
                    """
                    UPDATE finished_goods
                    SET source_mixing_ids   = %s::text[],
                        source_seasoned_ids = %s::text[],
                        source_deboning_ids = %s::text[]
                    WHERE id = %s
                    """,
                    (
                        lin["mixing_order_ids"],
                        lin["seasoned_meat_ids"],
                        lin["deboning_entry_ids"],
                        fg["id"],
                    ),
                )
            fixed_finished += 1
        except Exception as e:
            errors.append(f"finished_goods {fg.get('batch_no')}: {e}")

    logger.info(
        "admin.repair_lineage",
        extra={
            "fixed_seasoned": fixed_seasoned,
            "fixed_finished": fixed_finished,
            "errors": len(errors),
        },
    )
    return {
        "fixed_seasoned_meat": fixed_seasoned,
        "fixed_finished_goods": fixed_finished,
        "errors": errors,
        "total_seasoned_checked": len(batches),
        "total_finished_checked": len(fgs),
    }


def lineage_health(limit: int = 200) -> Dict[str, Any]:
    """Wykryj finished_goods z niekompletnym łańcuchem śledzenia.

    Pierwsze ``limit`` rekordów, gdzie brakuje któregokolwiek z:
        * seasoned_batch_nos
        * source_seasoned_ids
        * source_mixing_ids
        * source_deboning_ids

    Przeznaczone do uruchamiania z cron/systemd-timera; brak alarmu
    (broken_count == 0) oznacza, że łańcuch jest spójny.
    """
    limit = max(1, min(int(limit), 1000))
    broken_rows = query_all(
        """
        SELECT id, batch_no, produced_date,
               COALESCE(array_length(seasoned_batch_nos, 1), 0)   AS seasoned_nos_count,
               COALESCE(array_length(source_seasoned_ids, 1), 0)  AS seasoned_ids_count,
               COALESCE(array_length(source_mixing_ids, 1), 0)    AS mixing_ids_count,
               COALESCE(array_length(source_deboning_ids, 1), 0)  AS deboning_ids_count
        FROM finished_goods
        WHERE COALESCE(array_length(seasoned_batch_nos, 1), 0) = 0
           OR COALESCE(array_length(source_seasoned_ids, 1), 0) = 0
           OR COALESCE(array_length(source_mixing_ids, 1), 0) = 0
           OR COALESCE(array_length(source_deboning_ids, 1), 0) = 0
        ORDER BY produced_date DESC NULLS LAST, batch_no DESC
        LIMIT %s
        """,
        (limit,),
    )
    total_finished = query_one("SELECT count(*) AS n FROM finished_goods")

    # ── Detektor sierot: sztuki bez twardego linku do wyrobu gotowego ──
    # Sierota = sztuka, której linia planu MA już finished_goods (przez junction
    # finished_goods_sessions), ale source_finished_goods_id jest NULL. Sztuki
    # linii bez finished_goods (dzień niezamknięty) to stan oczekujący, NIE sierota.
    units_stats = query_one(
        """
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE source_finished_goods_id IS NOT NULL) AS linked,
          count(*) FILTER (
            WHERE source_finished_goods_id IS NULL
              AND EXISTS (
                SELECT 1 FROM finished_goods_sessions s
                WHERE s.plan_line_id = finished_units.plan_line_id
              )
          ) AS orphans,
          count(*) FILTER (
            WHERE source_finished_goods_id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM finished_goods_sessions s
                WHERE s.plan_line_id = finished_units.plan_line_id
              )
          ) AS pending
        FROM finished_units
        """
    ) or {}
    orphan_units = query_all(
        """
        SELECT id, qr_code, batch_no, plan_line_id, status
        FROM finished_units fu
        WHERE source_finished_goods_id IS NULL
          AND EXISTS (
            SELECT 1 FROM finished_goods_sessions s
            WHERE s.plan_line_id = fu.plan_line_id
          )
        ORDER BY produced_date DESC NULLS LAST
        LIMIT %s
        """,
        (limit,),
    )
    orphan_count = int(units_stats.get("orphans") or 0)

    # Otwarte loty ABP (kości/grzbiety/odpad bez zarejestrowanej utylizacji).
    from app.services.byproducts_service import open_byproducts_summary

    abp = open_byproducts_summary()

    return {
        "broken_count": len(broken_rows),
        "total_finished": int((total_finished or {}).get("n") or 0),
        "broken": broken_rows,
        "units": {
            "total": int(units_stats.get("total") or 0),
            "linked": int(units_stats.get("linked") or 0),
            "orphans": orphan_count,
            "pending": int(units_stats.get("pending") or 0),
            "orphan_sample": orphan_units,
        },
        "byproducts_open": abp,
        "ok": len(broken_rows) == 0 and orphan_count == 0,
    }


def recalculate_recipe_yields() -> Dict[str, int]:
    with transaction() as conn:
        recipes = cx_query_all(conn, "SELECT * FROM recipes")
        updated = 0
        for r in recipes:
            ings = cx_query_all(
                conn,
                "SELECT qty_per_100kg FROM recipe_ingredients WHERE recipe_id=%s",
                (r["id"],),
            )
            auto_output = round(
                100.0 + sum(float(i.get("qty_per_100kg") or 0) for i in ings), 3
            )
            if abs(auto_output - float(r.get("total_output_per_100kg") or 100)) > 0.01:
                cx_execute(
                    conn,
                    "UPDATE recipes SET total_output_per_100kg=%s WHERE id=%s",
                    (auto_output, r["id"]),
                )
                updated += 1
    logger.info(
        "admin.recalculate_recipe_yields",
        extra={"updated": updated, "total": len(recipes)},
    )
    return {"updated_recipes": updated, "total": len(recipes)}


# ── Drzewo śledzenia surowca (panel „Śledzenie surowca") ─────────────
# Pełny przepływ partii w przód i w tył jako drzewo:
# przyjęcie → rozbiór → masowanie → mięso przyprawione → wyrób gotowy,
# z dokumentami do druku per węzeł (faktura, raport partii, zamówienie,
# HDI, WZ, CMR, etykiety).

def _tree_node(ntype: str, row_id: str, batch_no: str, title: str,
               subtitle: str = "", date: str = "", kg=None, qty=None,
               docs=None) -> Dict[str, Any]:
    return {
        "type": ntype,
        "id": row_id,
        "batchNo": batch_no or "",
        "title": title or "",
        "subtitle": subtitle or "",
        "date": str(date or ""),
        "kg": kg,
        "qty": qty,
        "highlight": False,
        "docs": docs or [],
        "children": [],
    }


def trace_tree(q: str) -> Dict[str, Any]:
    base = recall(q)

    raw_rows = base["raw_batches"]
    deb_rows = base["deboning"]          # camelCase (_map_deboning_entry)
    mix_rows = base["mixing_orders"]
    sea_rows = base["seasoned"]
    fg_rows = base["finished"]
    suppliers = {s["id"]: s for s in base["suppliers"] if s.get("id")}

    nq = (q or "").strip()

    def hl(batch_no) -> bool:
        if not nq or not batch_no:
            return False
        s = str(batch_no)
        return nq == s or nq in s.split(" ")

    # ── Dokumenty per encja ──
    rb_ids = [r["id"] for r in raw_rows if r.get("id")]
    invoices_by_rb: Dict[str, List[Dict]] = {}
    if rb_ids:
        for inv in query_all(
            "SELECT raw_batch_id, invoice_no, invoice_date FROM invoices "
            "WHERE raw_batch_id = ANY(%s::text[])",
            (rb_ids,),
        ):
            invoices_by_rb.setdefault(inv["raw_batch_id"], []).append(inv)

    order_ids: Dict[str, str] = {}
    order_nos = sorted({
        fg.get("client_order_no") for fg in fg_rows if fg.get("client_order_no")
    })
    if order_nos:
        for o in query_all(
            "SELECT id, order_no FROM client_orders WHERE order_no = ANY(%s::text[])",
            (list(order_nos),),
        ):
            order_ids[o["order_no"]] = o["id"]

    docs_by_order: Dict[str, List[Dict]] = {}
    oid_list = list(order_ids.values())
    if oid_list:
        for h in query_all(
            "SELECT id, number, order_id, issue_date FROM hdi_documents "
            "WHERE order_id = ANY(%s::text[])",
            (oid_list,),
        ):
            docs_by_order.setdefault(h["order_id"], []).append({
                "kind": "hdi", "label": "HDI", "number": h.get("number"),
                "refId": h["id"], "date": str(h.get("issue_date") or ""),
            })
        for w in query_all(
            "SELECT id, number, source_id, issued_date FROM wz_documents "
            "WHERE source_type='order' AND source_id = ANY(%s::text[])",
            (oid_list,),
        ):
            docs_by_order.setdefault(w["source_id"], []).append({
                "kind": "wz", "label": "WZ", "number": w.get("number"),
                "refId": w["id"], "date": str(w.get("issued_date") or ""),
            })
        for c in query_all(
            "SELECT id, number, order_id, issue_date FROM cmr_documents "
            "WHERE order_id = ANY(%s::text[])",
            (oid_list,),
        ):
            docs_by_order.setdefault(c["order_id"], []).append({
                "kind": "cmr", "label": "CMR", "number": c.get("number"),
                "refId": c["id"], "date": str(c.get("issue_date") or ""),
            })

    # plan_line dla etykiet (junction finished_goods_sessions)
    fg_ids = [f["id"] for f in fg_rows if f.get("id")]
    plan_line_by_goods: Dict[str, str] = {}
    if fg_ids:
        for r in query_all(
            "SELECT goods_id, plan_line_id FROM finished_goods_sessions "
            "WHERE goods_id = ANY(%s::text[])",
            (fg_ids,),
        ):
            if r.get("plan_line_id"):
                plan_line_by_goods.setdefault(r["goods_id"], r["plan_line_id"])

    # ── Węzły per etap ──
    raw_nodes: Dict[str, Dict] = {}
    for rb in raw_rows:
        docs = [{
            "kind": "invoice", "label": "Faktura zakupowa",
            "number": inv.get("invoice_no"),
            "date": str(inv.get("invoice_date") or ""),
        } for inv in invoices_by_rb.get(rb["id"], []) if inv.get("invoice_no")]
        if rb.get("internal_batch_no"):
            docs.append({
                "kind": "batch_report", "label": "Raport partii",
                "number": rb["internal_batch_no"],
                "refNo": rb["internal_batch_no"], "date": "",
            })
        sup = suppliers.get(rb.get("supplier_id") or "")
        n = _tree_node(
            "raw", rb["id"], rb.get("internal_batch_no"), "Przyjęcie surowca",
            subtitle=(sup or {}).get("name") or rb.get("supplier_name") or "",
            date=rb.get("received_date") or rb.get("created_at"),
            kg=float(rb.get("kg_received") or 0), docs=docs,
        )
        n["highlight"] = hl(rb.get("internal_batch_no"))
        raw_nodes[rb["id"]] = n

    deb_nodes: Dict[str, Dict] = {}
    for de in deb_rows:
        n = _tree_node(
            "deboning", de["id"], de.get("meatLotNo") or de.get("rawBatchNo"),
            "Rozbiór",
            subtitle=(
                f"mięso {de.get('kgMeat', 0)} kg · wydajność {de.get('yieldPct', 0)}%"
            ),
            date=de.get("sessionDate") or de.get("createdAt"),
            kg=float(de.get("kgMeat") or 0),
        )
        n["highlight"] = hl(de.get("meatLotNo"))
        deb_nodes[de["id"]] = n

    mix_nodes: Dict[str, Dict] = {}
    for mo in mix_rows:
        n = _tree_node(
            "mixing", mo["id"], mo.get("order_no"), "Masowanie",
            subtitle=mo.get("recipe_name") or "",
            date=str(mo.get("created_at") or ""),
            kg=float(mo.get("kg_actual") or mo.get("kg_planned") or 0),
        )
        n["highlight"] = hl(mo.get("order_no"))
        mix_nodes[mo["id"]] = n

    sea_nodes: Dict[str, Dict] = {}
    for sm in sea_rows:
        docs = []
        if sm.get("batch_no"):
            docs.append({
                "kind": "batch_report", "label": "Raport partii",
                "number": sm["batch_no"], "refNo": sm["batch_no"], "date": "",
            })
        n = _tree_node(
            "seasoned", sm["id"], sm.get("batch_no"), "Mięso przyprawione",
            subtitle=sm.get("recipe_name") or "",
            date=str(sm.get("completed_at") or sm.get("created_at") or ""),
            kg=float(sm.get("kg_produced") or 0), docs=docs,
        )
        n["highlight"] = hl(sm.get("batch_no"))
        sea_nodes[sm["id"]] = n

    fg_nodes: Dict[str, Dict] = {}
    for fg in fg_rows:
        docs = []
        ono = fg.get("client_order_no")
        oid = order_ids.get(ono or "")
        if oid:
            docs.append({
                "kind": "order", "label": "Zamówienie", "number": ono,
                "refId": oid, "date": "",
            })
            docs.extend(docs_by_order.get(oid, []))
        pl_id = plan_line_by_goods.get(fg["id"])
        if pl_id:
            docs.append({
                "kind": "labels", "label": "Etykiety", "number": "",
                "refId": pl_id, "date": "",
            })
        if fg.get("batch_no"):
            docs.append({
                "kind": "batch_report", "label": "Raport partii",
                "number": fg["batch_no"], "refNo": fg["batch_no"], "date": "",
            })
        n = _tree_node(
            "finished", fg["id"], fg.get("batch_no"), "Wyrób gotowy",
            subtitle=" · ".join(
                str(x) for x in [fg.get("client_name"), ono] if x
            ),
            date=str(fg.get("produced_date") or fg.get("created_at") or ""),
            kg=float(fg.get("total_kg") or 0), qty=int(fg.get("qty") or 0),
            docs=docs,
        )
        n["highlight"] = hl(fg.get("batch_no"))
        fg_nodes[fg["id"]] = n

    # ── Krawędzie (dziecko może mieć wielu rodziców — pokazujemy pod każdym) ──
    attached: Set[str] = set()
    pairs: Set[str] = set()

    def attach(parent: Dict, child_key: str, child: Dict) -> None:
        pk = f"{parent['type']}|{parent['id']}|{child_key}"
        if pk in pairs:
            return
        pairs.add(pk)
        parent["children"].append(child)
        attached.add(child_key)

    # rozbiór → przyjęcie
    for de in deb_rows:
        parent = raw_nodes.get(de.get("rawBatchId") or "")
        if parent is not None:
            attach(parent, f"deboning|{de['id']}", deb_nodes[de["id"]])

    # masowanie → rozbiór (lub wprost przyjęcie, gdy brak wpisu rozbioru)
    for mo in mix_rows:
        rows = query_all(
            """
            SELECT ms.raw_batch_id, ms.deboning_session_id
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            WHERE mol.order_id = %s
            """,
            (mo["id"],),
        )
        for r in rows:
            child_key = f"mixing|{mo['id']}"
            de_id = r.get("deboning_session_id") or ""
            rb_id = r.get("raw_batch_id") or ""
            if de_id in deb_nodes:
                attach(deb_nodes[de_id], child_key, mix_nodes[mo["id"]])
            elif rb_id in raw_nodes:
                attach(raw_nodes[rb_id], child_key, mix_nodes[mo["id"]])

    # mięso przyprawione → masowanie
    mo_by_no = {m.get("order_no"): m["id"] for m in mix_rows if m.get("order_no")}
    for sm in sea_rows:
        child_key = f"seasoned|{sm['id']}"
        mo_id = sm.get("mixing_order_id") or mo_by_no.get(sm.get("mixing_order_no") or "")
        if mo_id and mo_id in mix_nodes:
            attach(mix_nodes[mo_id], child_key, sea_nodes[sm["id"]])

    # wyrób gotowy → mięso przyprawione (po id źródłowych, fallback po numerze)
    sea_by_no = {s.get("batch_no"): s["id"] for s in sea_rows if s.get("batch_no")}
    for fg in fg_rows:
        child_key = f"finished|{fg['id']}"
        sids = [s for s in (fg.get("source_seasoned_ids") or []) if s in sea_nodes]
        if not sids:
            sids = [
                sea_by_no[bn] for bn in (fg.get("seasoned_batch_nos") or [])
                if bn in sea_by_no
            ]
        for sid in sids:
            attach(sea_nodes[sid], child_key, fg_nodes[fg["id"]])

    # ── Korzenie: przyjęcia + wszystko, co nie ma rodzica ──
    roots: List[Dict] = list(raw_nodes.values())
    for kind, nodes in (
        ("deboning", deb_nodes), ("mixing", mix_nodes),
        ("seasoned", sea_nodes), ("finished", fg_nodes),
    ):
        for nid, node in nodes.items():
            if f"{kind}|{nid}" not in attached:
                roots.append(node)

    return {
        "query": q,
        "resolvedVia": base.get("resolvedVia"),
        "ambiguous": base.get("ambiguous", False),
        "candidates": base.get("candidates", []),
        "roots": roots,
        "summary": {
            "totalKg": base.get("total_kg", 0),
            "totalUnits": base.get("total_units", 0),
            "rawBatches": len(raw_rows),
            "deboning": len(deb_rows),
            "mixing": len(mix_rows),
            "seasoned": len(sea_rows),
            "finished": len(fg_rows),
            "suppliers": [s.get("name") for s in base["suppliers"] if s.get("name")],
            "clients": base.get("clients", []),
        },
        "byproducts": base.get("byproducts", []),
    }
