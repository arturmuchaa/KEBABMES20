"""Usunięte wpisy rozbioru — lista dla biura i przywrócenie (także na innego pracownika).

Prod 2026-11-07: pobranie RAJA 5 usunięte na hali, bo było na złym pracowniku;
odtworzenie na IVAN 8 wymagało szukania śladu w bazie i ręcznego przejścia
rozliczenia. Ślad usunięcia (deboning_entry_corrections.changes.usuniety) ma
komplet wag, więc przywrócenie idzie TĄ SAMĄ drogą co hala — pobranie, mięso,
grzbiety, kości, zamknięcie — i przelicza stany oraz akord jak zwykłe ważenie.

Przywracamy tylko do OTWARTEJ zmiany z dnia pobrania: zmiana zamknięta to
dzień domknięty (raport, karty), a wpis wstecz robi się korektą biura.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.db import query_all, query_one, transaction, cx_query_one, cx_execute
from app.models.deboning import DeboningEntryCreate, DeboningTakeCreate
from app.models.deboning_settlement import SettlementAdvance, SettlementWeighing
from app.utils.ids import cuid

WARSAW = ZoneInfo("Europe/Warsaw")
# Wpis utworzony przez przywrócenie, które padło w połowie i zostało sprzątnięte —
# nie pokazujemy go jako „usuniętego" (to nie była praca hali).
PRZERWANE = "Przywrócenie przerwane — wpis sprzątnięty automatycznie"


def _snapshot(row) -> Dict[str, Any]:
    ch = row["changes"] if isinstance(row["changes"], dict) else json.loads(row["changes"] or "{}")
    return ch.get("usuniety") or {}


def _work_date(snap: Dict[str, Any], deleted_at: datetime) -> str:
    """Dzień pracy pobrania: z pierwszego ważenia (jest w śladzie), inaczej dzień usunięcia."""
    ws = snap.get("weighings") or []
    if ws:
        return datetime.fromisoformat(ws[0]["weighedAt"]).astimezone(WARSAW).date().isoformat()
    return deleted_at.astimezone(WARSAW).date().isoformat()


def _restored(entry_id: str) -> Optional[Dict[str, Any]]:
    return query_one(
        "SELECT c.entry_id, e.worker_name FROM deboning_entry_corrections c "
        "LEFT JOIN deboning_entries e ON e.id = c.entry_id "
        "WHERE c.changes->'przywrocony'->>'fromEntryId' = %s ORDER BY c.at DESC LIMIT 1",
        (entry_id,),
    )


def list_deleted(days: int = 14) -> List[Dict[str, Any]]:
    days = max(1, min(int(days or 14), 90))
    rows = query_all(
        "SELECT id, entry_id, at, by_subject, reason, changes FROM deboning_entry_corrections "
        "WHERE changes ? 'usuniety' AND at >= now() - make_interval(days => %s) AND reason <> %s "
        "ORDER BY at DESC",
        (days, PRZERWANE),
    )
    out = []
    for r in rows:
        s = _snapshot(r)
        back = _restored(r["entry_id"])
        out.append({
            "id": r["id"], "entryId": r["entry_id"],
            "deletedAt": r["at"].isoformat(), "bySubject": r.get("by_subject") or "",
            "reason": r.get("reason") or "",
            "workerName": s.get("worker") or "", "rawBatchNo": s.get("rawBatchNo") or "",
            "sessionNo": s.get("sessionNo") or "",
            "kgQuarter": float(s.get("kgQuarter") or 0), "kgMeat": float(s.get("kgMeat") or 0),
            "kgBacks": float(s.get("kgBacks") or 0), "kgBones": float(s.get("kgBones") or 0),
            "settlement": bool(s.get("weighings") is not None or s.get("stage")),
            "workDate": _work_date(s, r["at"]),
            "restoredEntryId": back["entry_id"] if back else None,
            "restoredWorkerName": (back or {}).get("worker_name"),
            "restorable": back is None and float(s.get("kgQuarter") or 0) > 0,
        })
    return out


def _session_for(snap: Dict[str, Any], work_date: str) -> str:
    sid = snap.get("sessionId")
    if sid:
        row = query_one("SELECT status FROM production_sessions WHERE id=%s", (sid,))
        if row and row["status"] == "open":
            return sid
    row = query_one(
        "SELECT id FROM production_sessions WHERE process_type='deboning' AND status='open' "
        "AND session_date=%s ORDER BY started_at DESC LIMIT 1", (work_date,))
    if not row:
        raise HTTPException(409, f"Zmiana rozbioru z dnia {work_date} jest już zamknięta — "
                                 "przywrócenie niemożliwe, dopisz wpis korektą biura")
    return row["id"]


def restore(entry_id: str, worker_id: str, reason: str, by_subject: str = "") -> Dict[str, Any]:
    from app.services import deboning_service as deb
    from app.services import take_settlement_service as ts

    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(400, "Podaj powód przywrócenia")
    row = query_one(
        "SELECT id, entry_id, at, changes FROM deboning_entry_corrections "
        "WHERE entry_id=%s AND changes ? 'usuniety' ORDER BY at DESC LIMIT 1", (entry_id,))
    if not row:
        raise HTTPException(404, "Nie ma śladu usunięcia tego wpisu")
    if _restored(entry_id):
        raise HTTPException(409, "Ten wpis został już przywrócony")
    snap = _snapshot(row)
    worker = query_one("SELECT id, name FROM workers WHERE id=%s", (worker_id,))
    if not worker:
        raise HTTPException(400, "Pracownik nie istnieje")
    kg_quarter = float(snap.get("kgQuarter") or 0)
    if kg_quarter <= 0:
        raise HTTPException(409, "Ślad usunięcia nie ma ilości pobrania — przywrócenie niemożliwe")
    batch = query_one("SELECT id, kg_available, deboning_mode FROM raw_batches WHERE internal_batch_no::text=%s",
                      (str(snap.get("rawBatchNo") or ""),))
    if not batch:
        raise HTTPException(404, f"Partia {snap.get('rawBatchNo')} nie istnieje")
    # Sprawdzenia PRZED pierwszym zapisem — każdy krok to osobna transakcja.
    session_id = _session_for(snap, _work_date(snap, row["at"]))
    if kg_quarter > float(batch["kg_available"] or 0) + 0.01:
        raise HTTPException(400, f"W partii {snap.get('rawBatchNo')} zostało {float(batch['kg_available'] or 0):g} kg — "
                                 f"za mało, by przywrócić pobranie {kg_quarter:g} kg")

    note = f"Przywrócenie pobrania usuniętego z {snap.get('worker') or '—'}: {reason}"[:500]
    weighings = snap.get("weighings")
    meat_type = snap.get("meatType") or "zs"

    if weighings is None and float(snap.get("kgMeat") or 0) > 0:
        # Wpis sprzed rozliczenia per pracownik — jedna operacja korekty biura.
        if batch.get("deboning_mode") == "worker":
            raise HTTPException(409, "Ślad nie ma wag grzbietów i kości, a partia jest rozliczana per pracownik — "
                                     "przywrócenie niemożliwe")
        created = deb.create_deboning_entry(DeboningEntryCreate(
            rawBatchId=batch["id"], sessionId=session_id, workerId=worker["id"], workerName=worker["name"],
            kgQuarter=kg_quarter, kgMeat=float(snap["kgMeat"]),
            kgBacks=float(snap.get("kgBacks") or 0), kgBones=float(snap.get("kgBones") or 0),
        ), by_subject, office_correction=True, reason=note)
        new_id = created["id"]
    else:
        new_id = deb.create_deboning_take(DeboningTakeCreate(
            rawBatchId=batch["id"], sessionId=session_id, workerId=worker["id"], workerName=worker["name"],
            kgTaken=kg_quarter, perWorker=True, meatType=meat_type))["id"]
        try:
            if weighings:
                ts.start(new_id)
                exc = snap.get("exception") or None
                for kind in ("meat", "backs", "bones"):
                    for i, w in enumerate(x for x in weighings if x["kind"] == kind):
                        ts.weigh(new_id, SettlementWeighing(
                            requestId=f"restore-{new_id}-{kind}-{i}", kind=kind, kgNet=float(w["kgNet"]),
                            weighMode="manual", reason=note), by_subject)
                    override = kind == "meat" and bool(deb.validate_yield_band(
                        kg_quarter, float(snap.get("kgMeat") or 0), meat_type=meat_type))
                    ts.advance(new_id, SettlementAdvance(stage=kind, overrideYield=override), by_subject)
                ts.finish(new_id, by_subject,
                          exception_code=ts._manager_code() if exc else None,
                          exception_reason=f"Przywrócenie — pierwotnie zatwierdzone poza tolerancją: {exc.get('reason', '')}" if exc else None)
        except Exception:
            # Pół wpisu (pobranie bez wag) byłoby gorsze niż brak wpisu — sprzątamy.
            deb.delete_deboning_entry(new_id, office_correction=True, by_subject=by_subject or "biuro", reason=PRZERWANE)
            raise

    with transaction() as conn:
        cx_execute(conn, "INSERT INTO deboning_entry_corrections (id, entry_id, by_subject, reason, changes) "
                         "VALUES (%s,%s,%s,%s,%s)",
                   (cuid(), new_id, by_subject or "biuro", reason,
                    json.dumps({"przywrocony": {"fromEntryId": entry_id, "fromWorker": snap.get("worker"),
                                                "toWorker": worker["name"],
                                                "at": datetime.now(timezone.utc).isoformat()}}, ensure_ascii=False)))
    out = query_one("SELECT * FROM deboning_entries WHERE id=%s", (new_id,))
    return deb._map_deboning_entry(out)
