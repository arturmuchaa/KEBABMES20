"""Ważenie zbiorcze produktów ubocznych partii (grzbiety + kości) po rozbiorze.

Osobny od byproducts_service (loty ABP / utylizacja). Tu operator hali waży
ZBIORCZO grzbiety i kości zakończonej partii — paletami na wadze najazdowej
(tara palety + pojemniki × 2 kg), a system liczy % względem ćwiartki tej partii.
Stan przeżywa zamknięcie dnia i przechodzi na kolejne dni aż do dokończenia.
"""
import json
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.logging_config import get_logger
from app.utils.ids import cuid

logger = get_logger(__name__)


def _row(r: Optional[Dict]) -> Optional[Dict[str, Any]]:
    if not r:
        return None
    return {
        "rawBatchId": r["raw_batch_id"],
        "rawBatchNo": r["raw_batch_no"],
        "quarterKg": float(r["quarter_kg"] or 0),
        "backsKg": None if r["backs_kg"] is None else float(r["backs_kg"]),
        "bonesKg": None if r["bones_kg"] is None else float(r["bones_kg"]),
        "backsPct": None if r["backs_pct"] is None else float(r["backs_pct"]),
        "bonesPct": None if r["bones_pct"] is None else float(r["bones_pct"]),
        "backsDone": r["backs_kg"] is not None,
        "bonesDone": r["bones_kg"] is not None,
        "finishedAt": r["finished_at"].isoformat() if r["finished_at"] else None,
        # Palety poprzednich ważeń — kreator doładowuje je do sumy przy
        # ważeniu w trakcie rozbioru (kolejna paleta dolicza, nie nadpisuje).
        "backsPallets": r.get("backs_pallets") or [],
        "bonesPallets": r.get("bones_pallets") or [],
    }


def get(raw_batch_id: str) -> Optional[Dict[str, Any]]:
    return _row(query_one("SELECT * FROM batch_byproducts WHERE raw_batch_id=%s", (raw_batch_id,)))


def finish_batch(raw_batch_id: str, operator: str = "") -> Dict[str, Any]:
    """Zakończ rozbiór partii → rekord oczekujący na ważenie ubocznych.
    quarter_kg = suma ćwiartki tej partii (baza procentu). Idempotentne —
    ponowne wywołanie nie kasuje już zważonych frakcji."""
    b = query_one("SELECT internal_batch_no FROM raw_batches WHERE id=%s", (raw_batch_id,))
    if not b:
        raise HTTPException(404, "Partia nie istnieje")
    q = query_one(
        "SELECT COALESCE(SUM(kg_quarter),0) AS s FROM deboning_entries WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    quarter = float(q["s"] or 0)
    existing = query_one("SELECT raw_batch_id FROM batch_byproducts WHERE raw_batch_id=%s", (raw_batch_id,))
    if existing:
        # Rekord mógł powstać przy ważeniu W TRAKCIE rozbioru (finished_at
        # NULL) — teraz partia się kończy: stempluj finished_at i przelicz
        # procenty względem pełnej ćwiartki (baza z ważeń w trakcie była
        # częściowa).
        execute(
            "UPDATE batch_byproducts SET "
            "  quarter_kg = GREATEST(COALESCE(quarter_kg,0), %s), "
            "  finished_at = COALESCE(finished_at, now()) "
            "WHERE raw_batch_id=%s",
            (quarter, raw_batch_id),
        )
        execute(
            "UPDATE batch_byproducts SET "
            "  backs_pct = CASE WHEN backs_kg IS NOT NULL AND quarter_kg > 0 "
            "    THEN ROUND(backs_kg / quarter_kg * 100, 2) ELSE backs_pct END, "
            "  bones_pct = CASE WHEN bones_kg IS NOT NULL AND quarter_kg > 0 "
            "    THEN ROUND(bones_kg / quarter_kg * 100, 2) ELSE bones_pct END "
            "WHERE raw_batch_id=%s",
            (raw_batch_id,),
        )
    else:
        execute(
            "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator) "
            "VALUES (%s,%s,%s,%s)",
            (raw_batch_id, b["internal_batch_no"], quarter, operator),
        )
    return get(raw_batch_id)


def ensure_record(raw_batch_id: str, operator: str = "") -> Dict[str, Any]:
    """Rekord ubocznych do ważenia W TRAKCIE rozbioru partii (przytrzymanie
    kafelka na HMI). NIE oznacza partii jako zakończonej — finished_at zostaje
    NULL aż do finish_batch, więc partia nie trafia na szare kafle pending()
    i auto-zakończenie przy wyczerpaniu ćwiartki działa normalnie."""
    existing = get(raw_batch_id)
    if existing:
        return existing
    b = query_one("SELECT internal_batch_no FROM raw_batches WHERE id=%s", (raw_batch_id,))
    if not b:
        raise HTTPException(404, "Partia nie istnieje")
    q = query_one(
        "SELECT COALESCE(SUM(kg_quarter),0) AS s FROM deboning_entries WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    execute(
        "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator, finished_at) "
        "VALUES (%s,%s,%s,%s,NULL)",
        (raw_batch_id, b["internal_batch_no"], float(q["s"] or 0), operator),
    )
    return get(raw_batch_id)


def pending() -> List[Dict[str, Any]]:
    """ZAKOŃCZONE partie z niedokończonym ważeniem ubocznych (grzbiety LUB
    kości brak). Bez filtra daty — przechodzą na kolejne dni (szare kafle).
    Rekordy ważenia w trakcie rozbioru (finished_at NULL) nie wchodzą —
    partia jest wtedy nadal aktywnym kaflem."""
    rows = query_all(
        "SELECT * FROM batch_byproducts "
        "WHERE finished_at IS NOT NULL AND (backs_kg IS NULL OR bones_kg IS NULL) "
        "ORDER BY finished_at"
    )
    return [_row(r) for r in rows]


def today_totals() -> Dict[str, float]:
    """Suma zbiorczo zważonych grzbietów/kości z DZISIAJ (czas PL) — pasek
    dolny HMI. Frakcja liczy się w dniu jej zważenia (backs_at/bones_at)."""
    r = query_one(
        "SELECT "
        "  COALESCE(SUM(backs_kg) FILTER (WHERE (backs_at AT TIME ZONE 'Europe/Warsaw')::date "
        "    = (now() AT TIME ZONE 'Europe/Warsaw')::date), 0) AS backs, "
        "  COALESCE(SUM(bones_kg) FILTER (WHERE (bones_at AT TIME ZONE 'Europe/Warsaw')::date "
        "    = (now() AT TIME ZONE 'Europe/Warsaw')::date), 0) AS bones "
        "FROM batch_byproducts"
    )
    return {"backsKg": float(r["backs"] or 0), "bonesKg": float(r["bones"] or 0)}


def record(raw_batch_id: str, kind: str, kg: float, pallets: Optional[list] = None) -> Dict[str, Any]:
    """Zapisz zważoną frakcję (backs|bones): kg + wyliczony % + szczegóły palet."""
    if kind not in ("backs", "bones"):
        raise HTTPException(400, "kind musi być 'backs' albo 'bones'")
    rec = query_one(
        "SELECT quarter_kg, raw_batch_no FROM batch_byproducts WHERE raw_batch_id=%s",
        (raw_batch_id,),
    )
    if not rec:
        raise HTTPException(404, "Partia nie została zakończona (brak rekordu ubocznych)")
    quarter = float(rec["quarter_kg"] or 0)
    pct = round(kg / quarter * 100, 2) if quarter > 0 else 0.0
    execute(
        f"UPDATE batch_byproducts SET {kind}_kg=%s, {kind}_pct=%s, {kind}_pallets=%s, "
        f"{kind}_at=now() WHERE raw_batch_id=%s",
        (round(kg, 3), pct, json.dumps(pallets or []), raw_batch_id),
    )
    # Lot ABP w magazynie produktów ubocznych — żeby zważone zbiorczo grzbiety/
    # kości trafiły do MES z traceability partii (partia→lot→utylizacja przez
    # /api/byproducts). Lot zbiorczy: deboning_entry_id NULL, powiązany z partią.
    # Idempotentne: nadpisujemy poprzedni otwarty lot tej partii+frakcji.
    execute(
        "DELETE FROM byproduct_lots WHERE raw_batch_id=%s AND kind=%s "
        "AND deboning_entry_id IS NULL AND status='open'",
        (raw_batch_id, kind),
    )
    if kg > 0:
        execute(
            "INSERT INTO byproduct_lots (id, deboning_entry_id, raw_batch_id, "
            "raw_batch_no, kind, kg, status, created_at) "
            "VALUES (%s, NULL, %s, %s, %s, %s, 'open', now())",
            (cuid(), raw_batch_id, rec["raw_batch_no"], kind, round(kg, 3)),
        )
    return get(raw_batch_id)
