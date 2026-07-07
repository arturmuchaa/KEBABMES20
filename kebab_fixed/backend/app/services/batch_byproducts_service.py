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
        execute(
            "UPDATE batch_byproducts SET quarter_kg=GREATEST(COALESCE(quarter_kg,0), %s) WHERE raw_batch_id=%s",
            (quarter, raw_batch_id),
        )
    else:
        execute(
            "INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, operator) "
            "VALUES (%s,%s,%s,%s)",
            (raw_batch_id, b["internal_batch_no"], quarter, operator),
        )
    return get(raw_batch_id)


def pending() -> List[Dict[str, Any]]:
    """Partie z niedokończonym ważeniem ubocznych (grzbiety LUB kości brak).
    Bez filtra daty — przechodzą na kolejne dni (szare kafle na hali)."""
    rows = query_all(
        "SELECT * FROM batch_byproducts WHERE backs_kg IS NULL OR bones_kg IS NULL "
        "ORDER BY finished_at"
    )
    return [_row(r) for r in rows]


def record(raw_batch_id: str, kind: str, kg: float, pallets: Optional[list] = None) -> Dict[str, Any]:
    """Zapisz zważoną frakcję (backs|bones): kg + wyliczony % + szczegóły palet."""
    if kind not in ("backs", "bones"):
        raise HTTPException(400, "kind musi być 'backs' albo 'bones'")
    rec = query_one("SELECT quarter_kg FROM batch_byproducts WHERE raw_batch_id=%s", (raw_batch_id,))
    if not rec:
        raise HTTPException(404, "Partia nie została zakończona (brak rekordu ubocznych)")
    quarter = float(rec["quarter_kg"] or 0)
    pct = round(kg / quarter * 100, 2) if quarter > 0 else 0.0
    execute(
        f"UPDATE batch_byproducts SET {kind}_kg=%s, {kind}_pct=%s, {kind}_pallets=%s, "
        f"{kind}_at=now() WHERE raw_batch_id=%s",
        (round(kg, 3), pct, json.dumps(pallets or []), raw_batch_id),
    )
    return get(raw_batch_id)
