"""Per-worker weighing: persistent steps, idempotent portions, ±1% on closure.

Meat enters stock immediately (existing partial-weighing contract). Byproducts
enter stock once on settlement. batch_byproducts is their reporting aggregate,
NOT a second stock receipt. Nominal input discrepancy is never invented stock.
"""
import json
import os
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException

from app.db import transaction, cx_query_one, cx_query_all, cx_execute, query_one
from app.models.deboning_settlement import SettlementWeighing
from app.services import deboning_service as deboning
from app.utils.ids import cuid
from app.utils.stock import create_stock_movement

# Balance of the whole take (meat + backs + bones vs quarters taken), hall decision
# 2026-11-06: up to +1.5 % over (wet product, cart scale) and up to −0.5 % under.
TOLERANCE_PLUS_PCT = Decimal("1.5")
TOLERANCE_MINUS_PCT = Decimal("0.5")


def _manager_code():
    # The hall's service code (same as the kiosk service menu); checked HERE, not only on the panel.
    return os.environ.get("KIOSK_SERVICE_CODE", "0099")
STAGES = ("meat", "backs", "bones", "balance", "done")


def mass_balance(taken, meat, backs, bones):
    q, m, b, k = (Decimal(str(x or 0)) for x in (taken, meat, backs, bones))
    total = m + b + k
    plus = q * TOLERANCE_PLUS_PCT / 100
    minus = q * TOLERANCE_MINUS_PCT / 100
    over = total >= q
    return {
        "totalKg": float(total), "differenceKg": float(total - q),
        "balancePct": float(total / q * 100) if q > 0 else 0,
        "tolerancePlusPct": float(TOLERANCE_PLUS_PCT), "toleranceMinusPct": float(TOLERANCE_MINUS_PCT),
        # The side the difference is on (excess → plus, shortfall → minus): messages and the exception record.
        "tolerancePct": float(TOLERANCE_PLUS_PCT if over else TOLERANCE_MINUS_PCT),
        "toleranceKg": float(plus if over else minus),
        "minKg": float(q - minus), "maxKg": float(q + plus),
        "withinTolerance": q > 0 and q - minus <= total <= q + plus,
    }


def batch_mode(conn, batch_id):
    """Caller locks raw batch before changing the mode. Never reclassify history."""
    batch = cx_query_one(conn, "SELECT deboning_mode FROM raw_batches WHERE id=%s", (batch_id,))
    if not batch:
        raise HTTPException(404, "Partia nie istnieje")
    if batch.get("deboning_mode"):
        return batch["deboning_mode"]
    legacy = cx_query_one(conn, """
        SELECT 1 FROM deboning_entries WHERE raw_batch_id=%s
          AND COALESCE(status,'complete')='complete' AND settlement_stage IS NULL
        UNION ALL
        SELECT 1 FROM batch_byproducts WHERE raw_batch_id=%s
          AND (backs_kg IS NOT NULL OR bones_kg IS NOT NULL)
        LIMIT 1
    """, (batch_id, batch_id))
    return "legacy" if legacy else "worker"


def require_legacy_batch(conn, batch_id):
    row = cx_query_one(conn, "SELECT deboning_mode FROM raw_batches WHERE id=%s", (batch_id,))
    if row and row.get("deboning_mode") == "worker":
        raise HTTPException(409, "Partia rozliczana per pracownik — użyj rozliczenia mięso → grzbiety → kości")


def require_legacy_entry(entry):
    if entry.get("settlement_stage"):
        raise HTTPException(409, "To pobranie ma rozliczenie pracownika — popraw ważenie w jego rozliczeniu")


def _locked(conn, entry_id):
    # Same order as creation/finishing: batch, then entry. Serializes stations.
    ref = cx_query_one(conn, "SELECT raw_batch_id FROM deboning_entries WHERE id=%s", (entry_id,))
    if not ref:
        raise HTTPException(404, "Pobranie nie znalezione")
    cx_query_one(conn, "SELECT id FROM raw_batches WHERE id=%s FOR UPDATE", (ref["raw_batch_id"],))
    entry = cx_query_one(conn, "SELECT * FROM deboning_entries WHERE id=%s FOR UPDATE", (entry_id,))
    if not entry:
        raise HTTPException(404, "Pobranie nie znalezione")
    return entry


def _active(entry):
    if entry.get("status") != "pending" or entry.get("settlement_stage") not in STAGES[:-1]:
        raise HTTPException(409, "Rozliczenie nie jest otwarte — odśwież ekran")


def _state(conn, entry):
    portions = cx_query_all(conn, "SELECT * FROM deboning_settlement_weighings WHERE entry_id=%s ORDER BY weighed_at, id", (entry["id"],))
    # Also includes partial meat weighed before this batch switched to the new UI.
    meat = deboning._sum_take_weighings(conn, entry["id"])
    sums = {kind: sum((Decimal(str(w["kg_net"])) for w in portions if w["kind"] == kind), Decimal(0)) for kind in ("backs", "bones")}
    result = deboning._map_deboning_entry(entry)
    result.update({
        "mode": batch_mode(conn, entry["raw_batch_id"]),
        "stage": entry.get("settlement_stage") or "meat",
        "meatKg": meat, "backsKg": float(sums["backs"]), "bonesKg": float(sums["bones"]),
        "weighings": [{
            "id": w["id"], "kind": w["kind"], "kgNet": float(w["kg_net"]),
            "kgGross": float(w["kg_gross"]) if w["kg_gross"] is not None else None,
            "tareCartKg": float(w["tare_cart_kg"]) if w["tare_cart_kg"] is not None else None,
            "tareE2Kg": float(w["tare_e2_kg"]) if w["tare_e2_kg"] is not None else None,
            "e2Count": w["e2_count"], "weighMode": w["weigh_mode"],
            "weighedAt": w["weighed_at"].isoformat(), "reason": w["reason"],
        } for w in portions],
    })
    result.update(mass_balance(entry["kg_quarter"], meat, sums["backs"], sums["bones"]))
    return result


def get(entry_id):
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        return _state(conn, entry)


def start(entry_id):
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        if batch_mode(conn, entry["raw_batch_id"]) == "legacy":
            return _state(conn, entry)
        if entry.get("status") != "pending":
            return _state(conn, entry)
        deboning._reattach_overnight_session(conn, entry, entry_id)
        cx_execute(conn, "UPDATE raw_batches SET deboning_mode='worker' WHERE id=%s", (entry["raw_batch_id"],))
        cx_execute(conn, "UPDATE deboning_entries SET settlement_stage=COALESCE(settlement_stage,'meat') WHERE id=%s", (entry_id,))
        entry["settlement_stage"] = entry.get("settlement_stage") or "meat"
        return _state(conn, entry)


def weigh(entry_id, dto: SettlementWeighing, subject=""):
    payload = dto.model_dump(mode="json")
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        existing = cx_query_one(conn, "SELECT entry_id, original_payload FROM deboning_settlement_weighings WHERE id=%s", (dto.request_id,))
        if existing:
            if existing["entry_id"] != entry_id or existing["original_payload"] != payload:
                raise HTTPException(409, "Identyfikator pomiaru został już użyty z innymi danymi")
            return _state(conn, entry)
        _active(entry)
        if entry["settlement_stage"] != dto.kind:
            raise HTTPException(409, "Inny etap rozliczenia — odśwież ekran")
        deboning._reattach_overnight_session(conn, entry, entry_id)
        state = _state(conn, entry)
        if dto.kind == "meat" and state["meatKg"] + dto.kg_net > float(entry["kg_quarter"]):
            raise HTTPException(400, "Suma mięsa przekracza pobranie — sprawdź tarę")
        cx_execute(conn, """INSERT INTO deboning_settlement_weighings
            (id, entry_id, kind, kg_net, kg_gross, tare_cart_kg, tare_e2_kg,
             e2_count, weigh_mode, reason, weighed_by, original_payload)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (dto.request_id, entry_id, dto.kind, dto.kg_net, dto.kg_gross,
             dto.tare_cart_kg, dto.tare_e2_kg, dto.e2_count, dto.weigh_mode,
             dto.reason.strip(), subject or "kiosk", json.dumps(payload)))
        if dto.kind == "meat":
            cx_execute(conn, """INSERT INTO deboning_take_weighings
                (id, entry_id, kg_meat, kg_gross, tare_cart_kg, tare_e2_kg, e2_count, weigh_mode, meat_type)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (dto.request_id, entry_id, dto.kg_net, dto.kg_gross, dto.tare_cart_kg,
                 dto.tare_e2_kg, dto.e2_count, dto.weigh_mode, entry.get("meat_type") or "zs"))
            deboning._add_meat_to_lot(conn, entry, dto.kg_net, entry_id, entry.get("meat_type") or "zs")
        return _state(conn, entry)


def advance(entry_id, dto, subject=""):
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        _active(entry)
        deboning._reattach_overnight_session(conn, entry, entry_id)
        target = STAGES[STAGES.index(dto.stage) + 1]
        if entry["settlement_stage"] == target:
            return _state(conn, entry)  # response lost; retry is safe
        if entry["settlement_stage"] != dto.stage:
            raise HTTPException(409, "Inny etap rozliczenia — odśwież ekran")
        state = _state(conn, entry)
        if state[dto.stage + "Kg"] <= 0:
            raise HTTPException(400, "Najpierw zapisz ważenie tej frakcji")
        if dto.stage == "meat":
            err = deboning.validate_yield_band(float(entry["kg_quarter"]), state["meatKg"], meat_type=entry.get("meat_type") or "zs", override=dto.override_yield)
            if err:
                raise HTTPException(400, err)
            if dto.override_yield:
                deboning._log_yield_override(conn, entry_id, float(entry["kg_quarter"]), state["meatKg"], meat_type=entry.get("meat_type") or "zs", by_subject=subject)
        cx_execute(conn, "UPDATE deboning_entries SET settlement_stage=%s WHERE id=%s", (target, entry_id))
        entry["settlement_stage"] = target
        return _state(conn, entry)


def reopen(entry_id, stage):
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        _active(entry)
        deboning._reattach_overnight_session(conn, entry, entry_id)
        if STAGES.index(stage) > STAGES.index(entry["settlement_stage"]):
            raise HTTPException(409, "Nie można pomijać etapów")
        cx_execute(conn, "UPDATE deboning_entries SET settlement_stage=%s WHERE id=%s", (stage, entry_id))
        entry["settlement_stage"] = stage
        return _state(conn, entry)


def correct(entry_id, weighing_id, dto: SettlementWeighing, subject=""):
    if len(dto.reason.strip()) < 3:
        raise HTTPException(400, "Podaj powód korekty")
    payload = dto.model_dump(mode="json")
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        row = cx_query_one(conn, "SELECT * FROM deboning_settlement_weighings WHERE id=%s AND entry_id=%s FOR UPDATE", (weighing_id, entry_id))
        if not row:
            raise HTTPException(404, "Pomiar nie znaleziony")
        for revision in row["corrections"]:
            if revision["requestId"] == dto.request_id:
                if revision["payload"] != payload:
                    raise HTTPException(409, "Identyfikator korekty został już użyty")
                return _state(conn, entry)
        _active(entry)
        deboning._reattach_overnight_session(conn, entry, entry_id)
        if dto.kind != row["kind"]:
            raise HTTPException(400, "Korekta nie zmienia rodzaju frakcji")
        delta = round(dto.kg_net - float(row["kg_net"]), 3)
        if dto.kind == "meat":
            if deboning._sum_take_weighings(conn, entry_id) + delta > float(entry["kg_quarter"]):
                raise HTTPException(400, "Suma mięsa przekracza pobranie")
            if delta > 0:
                deboning._add_meat_to_lot(conn, entry, delta, entry_id, entry.get("meat_type") or "zs")
            elif delta < 0:
                suffix = "-BS" if entry.get("meat_type") == "bs" else ""
                lot = cx_query_one(conn, "SELECT * FROM meat_stock WHERE lot_no=%s FOR UPDATE", (entry["raw_batch_no"] + suffix,))
                if not lot or float(lot["kg_available"] or 0) - float(lot.get("kg_reserved") or 0) < -delta:
                    raise HTTPException(409, "Mięso już zużyte lub zarezerwowane — korekta wymaga wyjaśnienia w biurze")
                create_stock_movement(conn, "meat", lot["id"], -delta, "OUT", "deboning_settlement_correction", dto.request_id)
                cx_execute(conn, "UPDATE meat_stock SET kg_initial=kg_initial+%s, kg_available=kg_available+%s WHERE id=%s", (delta, delta, lot["id"]))
            cx_execute(conn, """UPDATE deboning_take_weighings SET kg_meat=%s, kg_gross=%s,
                tare_cart_kg=%s, tare_e2_kg=%s, e2_count=%s, weigh_mode=%s WHERE id=%s""",
                (dto.kg_net, dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, dto.e2_count, dto.weigh_mode, weighing_id))
        audit = {"requestId": dto.request_id, "payload": payload, "before": {
            k: str(row[k]) if row[k] is not None else None for k in
            ("kg_net", "kg_gross", "tare_cart_kg", "tare_e2_kg", "e2_count", "weigh_mode", "reason")}, "by": subject or "kiosk", "at": datetime.now(timezone.utc).isoformat()}
        cx_execute(conn, """UPDATE deboning_settlement_weighings SET kg_net=%s, kg_gross=%s,
            tare_cart_kg=%s, tare_e2_kg=%s, e2_count=%s, weigh_mode=%s, reason=%s,
            corrections=corrections || %s::jsonb WHERE id=%s""",
            (dto.kg_net, dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, dto.e2_count,
             dto.weigh_mode, dto.reason.strip(), json.dumps([audit]), weighing_id))
        # A correction invalidates the old completion confirmation from this step onwards.
        stage = STAGES[min(STAGES.index(entry["settlement_stage"]), STAGES.index(dto.kind))]
        cx_execute(conn, "UPDATE deboning_entries SET settlement_stage=%s WHERE id=%s", (stage, entry_id))
        entry["settlement_stage"] = stage
        return _state(conn, entry)


def finish(entry_id, subject="", exception_code=None, exception_reason=None):
    with transaction() as conn:
        entry = _locked(conn, entry_id)
        if entry.get("settlement_stage") == "done":
            return _state(conn, entry)
        _active(entry)
        deboning._reattach_overnight_session(conn, entry, entry_id)
        state = _state(conn, entry)
        if entry["settlement_stage"] != "balance":
            raise HTTPException(409, "Zakończ ważenie mięsa, grzbietów i kości")
        exception = None
        if not state["withinTolerance"]:
            if exception_code is None:
                raise HTTPException(400, f"Bilans poza tolerancją (+{TOLERANCE_PLUS_PCT}% / −{TOLERANCE_MINUS_PCT}%): różnica {state['differenceKg']:.2f} kg; dopuszczalne {state['minKg']:.2f}–{state['maxKg']:.2f} kg. Popraw ważenia albo zatwierdź z wyjątkiem (wymaga kodu kierownika i powodu)")
            if exception_code != _manager_code():
                raise HTTPException(403, "Błędny kod kierownika — rozliczenie nie zostało zatwierdzone")
            reason = (exception_reason or "").strip()
            if len(reason) < 3:
                raise HTTPException(400, "Podaj powód zatwierdzenia poza tolerancją")
            exception = {
                "reason": reason, "by": subject or "kiosk", "at": datetime.now(timezone.utc).isoformat(),
                "kgTaken": float(entry["kg_quarter"]), "totalKg": state["totalKg"],
                "differenceKg": round(state["differenceKg"], 3), "toleranceKg": round(state["toleranceKg"], 3),
                "balancePct": round(state["balancePct"], 2),
            }
            # Same audit trail as the yield override; the weights stay exactly as measured.
            cx_execute(conn, "INSERT INTO deboning_entry_corrections (id, entry_id, by_subject, reason, changes) VALUES (%s,%s,%s,%s,%s)",
                       (cuid(), entry_id, subject or "kiosk", f"Zatwierdzenie bilansu poza tolerancją (kod kierownika): {reason}",
                        json.dumps(exception, ensure_ascii=False)))
        meat, backs, bones = (state[k] for k in ("meatKg", "backsKg", "bonesKg"))
        cx_execute(conn, """UPDATE deboning_entries SET status='complete', settlement_stage='done',
            completed_at=now(), kg_meat=%s, kg_backs=%s, kg_bones=%s,
            kg_remainder=%s, yield_pct=%s, kg_gross=NULL, tare_cart_kg=NULL,
            tare_e2_kg=NULL, e2_count=NULL, settlement_exception=%s WHERE id=%s""",
            (meat, backs, bones, max(0, float(entry["kg_quarter"]) - meat),
             round(meat / float(entry["kg_quarter"]) * 100, 2),
             json.dumps(exception, ensure_ascii=False) if exception else None, entry_id))
        batch_id = entry["raw_batch_id"]
        cx_execute(conn, """INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator, finished_at)
            VALUES (%s,%s,0,%s,NULL) ON CONFLICT (raw_batch_id) DO NOTHING""", (batch_id, entry["raw_batch_no"], subject))
        quarter = cx_query_one(conn, "SELECT SUM(kg_quarter) AS kg FROM deboning_entries WHERE raw_batch_id=%s AND status='complete'", (batch_id,))["kg"]
        cx_execute(conn, "UPDATE batch_byproducts SET quarter_kg=%s WHERE raw_batch_id=%s", (quarter, batch_id))
        for kind, kg in (("backs", backs), ("bones", bones)):
            portions = [w for w in state["weighings"] if w["kind"] == kind]
            pallets = [{"entryId": entry_id, "workerId": entry["worker_id"], "workerName": entry["worker_name"],
                        "weighingId": w["id"], "weighedAt": w["weighedAt"], "net": w["kgNet"],
                        "gross": w["kgGross"], "tareKg": w["tareCartKg"], "containers": w["e2Count"] or 0,
                        "tareLabel": "ręcznie" if w["weighMode"] == "manual" else "pracownik"} for w in portions]
            # Reporting only — no call to _write_fraction (it would receive stock twice).
            cx_execute(conn, f"""UPDATE batch_byproducts SET {kind}_kg=COALESCE({kind}_kg,0)+%s,
                {kind}_pallets=COALESCE({kind}_pallets,'[]') || %s::jsonb, {kind}_at=now()
                WHERE raw_batch_id=%s""", (kg, json.dumps(pallets), batch_id))
            lot_id = cuid()
            cx_execute(conn, """INSERT INTO byproduct_lots
                (id, deboning_entry_id, raw_batch_id, raw_batch_no, kind, kg, status, containers_available)
                VALUES (%s,%s,%s,%s,%s,%s,'open',%s)""",
                (lot_id, entry_id, batch_id, entry["raw_batch_no"], kind, kg, sum(p["containers"] for p in pallets)))
            create_stock_movement(conn, "byproduct", lot_id, kg, "IN", "deboning_settlement", entry_id)
        cx_execute(conn, """UPDATE batch_byproducts SET
            backs_pct=ROUND(backs_kg / NULLIF(quarter_kg,0)*100,2),
            bones_pct=ROUND(bones_kg / NULLIF(quarter_kg,0)*100,2)
            WHERE raw_batch_id=%s""", (batch_id,))
        updated = cx_query_one(conn, "SELECT * FROM deboning_entries WHERE id=%s", (entry_id,))
        result = _state(conn, updated)
    batch = query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (batch_id,))
    deboning._auto_finish_exhausted(batch_id, batch["kg_available"])
    return result


def require_service_code(code):
    """Hall-side change of a settled/settling take: the same code as the manager exception."""
    if not code:
        raise HTTPException(400, "Ta zmiana wymaga kodu serwisowego")
    if str(code) != _manager_code():
        raise HTTPException(403, "Błędny kod serwisowy — nic nie zmieniono")


def cancel_settlement_entry(conn, entry, by_subject="", reason=""):
    """Removes a per-worker take (open or settled) as if it had never been taken.

    Called inside delete_deboning_entry's transaction, with the batch and the
    entry already locked. Follows the existing undo convention (rows and their
    movements go, kilograms go back), with physical guards: meat already used
    or reserved, backs/bones already issued. The full snapshot (weighings,
    exception) stays in deboning_entry_corrections.
    """
    eid = entry["id"]
    weighings = cx_query_all(conn, "SELECT * FROM deboning_settlement_weighings WHERE entry_id=%s ORDER BY weighed_at, id FOR UPDATE", (eid,))
    meat = deboning._sum_take_weighings(conn, eid)
    if meat > 0:
        suffix = deboning.MEAT_TYPES[entry.get("meat_type") or "zs"][2]
        lot = cx_query_one(conn, "SELECT * FROM meat_stock WHERE lot_no=%s FOR UPDATE", (entry["raw_batch_no"] + suffix,))
        free = float(lot["kg_available"] or 0) - float(lot.get("kg_reserved") or 0) if lot else 0
        if free + 0.001 < meat:
            raise HTTPException(409, "Mięso z tego pobrania już zużyte lub zarezerwowane — usunięcie wymaga wyjaśnienia w biurze")
        if float(lot["kg_initial"] or 0) - meat <= 0.001:
            cx_execute(conn, "DELETE FROM meat_stock WHERE id=%s", (lot["id"],))
        else:
            cx_execute(conn, "UPDATE meat_stock SET kg_initial=kg_initial-%s, kg_available=GREATEST(0, kg_available-%s) WHERE id=%s",
                       (meat, meat, lot["id"]))
    settled = entry.get("status") == "complete"
    if settled:
        lots = cx_query_all(conn, "SELECT * FROM byproduct_lots WHERE deboning_entry_id=%s FOR UPDATE", (eid,))
        if any(l["status"] != "open" or l.get("destination") or l.get("disposed_at") for l in lots):
            raise HTTPException(409, "Grzbiety lub kości z tego pobrania już wydane — usunięcie niemożliwe")
        cx_execute(conn, "DELETE FROM byproduct_lots WHERE deboning_entry_id=%s", (eid,))
        for kind in ("backs", "bones"):
            kg = float(entry.get(f"kg_{kind}") or 0)
            cx_execute(conn, f"""UPDATE batch_byproducts SET {kind}_kg=GREATEST(0, COALESCE({kind}_kg,0)-%s),
                {kind}_pallets=COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(COALESCE({kind}_pallets,'[]'::jsonb)) p
                                         WHERE p->>'entryId' IS DISTINCT FROM %s), '[]'::jsonb)
                WHERE raw_batch_id=%s""", (kg, eid, entry["raw_batch_id"]))
    cx_execute(conn, "UPDATE raw_batches SET kg_available=COALESCE(kg_available,0)+%s WHERE id=%s",
               (float(entry["kg_quarter"]), entry["raw_batch_id"]))
    correction_ids = [rev["requestId"] for w in weighings for rev in (w.get("corrections") or []) if rev.get("requestId")]
    cx_execute(conn, """DELETE FROM stock_movements WHERE source_id=%s
        AND source_type IN ('deboning','deboning_correction','deboning_settlement')""", (eid,))
    if correction_ids:
        cx_execute(conn, "DELETE FROM stock_movements WHERE source_type='deboning_settlement_correction' AND source_id = ANY(%s)", (correction_ids,))
    snapshot = {"usuniety": {
        "sessionNo": entry.get("session_no"), "rawBatchNo": entry.get("raw_batch_no"),
        "worker": entry.get("worker_name"), "kgQuarter": float(entry.get("kg_quarter") or 0),
        "kgMeat": meat, "kgBacks": float(entry.get("kg_backs") or 0), "kgBones": float(entry.get("kg_bones") or 0),
        "status": entry.get("status"), "stage": entry.get("settlement_stage"),
        "exception": entry.get("settlement_exception"),
        "weighings": [{"id": w["id"], "kind": w["kind"], "kgNet": float(w["kg_net"]),
                       "weighMode": w["weigh_mode"], "weighedAt": w["weighed_at"].isoformat()} for w in weighings],
    }}
    cx_execute(conn, "INSERT INTO deboning_entry_corrections (id, entry_id, by_subject, reason, changes) VALUES (%s,%s,%s,%s,%s)",
               (cuid(), eid, by_subject or "kiosk", (reason or "Usunięte kodem serwisowym").strip(),
                json.dumps(snapshot, ensure_ascii=False, default=str)))
    cx_execute(conn, "DELETE FROM deboning_settlement_weighings WHERE entry_id=%s", (eid,))
    cx_execute(conn, "DELETE FROM deboning_take_weighings WHERE entry_id=%s", (eid,))
    cx_execute(conn, "DELETE FROM deboning_entries WHERE id=%s", (eid,))
    if settled:
        cx_execute(conn, """UPDATE batch_byproducts SET
            quarter_kg=COALESCE((SELECT SUM(kg_quarter) FROM deboning_entries WHERE raw_batch_id=%s AND status='complete'),0),
            backs_pct=ROUND(backs_kg / NULLIF(quarter_kg,0)*100,2),
            bones_pct=ROUND(bones_kg / NULLIF(quarter_kg,0)*100,2)
            WHERE raw_batch_id=%s""", (entry["raw_batch_id"], entry["raw_batch_id"]))
