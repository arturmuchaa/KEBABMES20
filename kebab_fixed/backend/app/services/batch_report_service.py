"""Budowa raportu identyfikowalności partii dla inspekcji weterynaryjnej."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.db import query_all, query_one
from app.services import traceability_service as trace
from app.utils.batch_numbers import classify_batch_type


def build_composition(
    parent_batch_nos: List[str],
    allocation: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Lista rodziców partii z kg/szt z alokacji planu.

    ``allocation`` = {batch_no: {"kg": float, "pieces": int}} (z
    production_plan_lines.batch_allocation). Kubełek sztuk mieszanych
    (PM{n}, kg w ``parts``) dolicza kg do partii źródłowych. Brak wpisu →
    kg/pieces None (NIE zgadujemy — uczciwość wobec inspektora)."""
    alloc = allocation if isinstance(allocation, dict) else {}
    mixed_kg: Dict[str, float] = {}
    for a in alloc.values():
        if isinstance(a, dict) and isinstance(a.get("parts"), dict):
            for p_no, p in a["parts"].items():
                if isinstance(p, dict) and float(p.get("kg") or 0) > 0:
                    mixed_kg[p_no] = mixed_kg.get(p_no, 0.0) + float(p["kg"])
    out: List[Dict[str, Any]] = []
    for bno in parent_batch_nos or []:
        a = alloc.get(bno) if isinstance(alloc.get(bno), dict) else {}
        kg = a.get("kg") if a else None
        if mixed_kg.get(bno):
            kg = round(float(kg or 0) + mixed_kg[bno], 3)
        out.append({
            "batch_no": bno,
            "kg": kg,
            "pieces": a.get("pieces") if a else None,
        })
    return out


def batch_report(batch_no: str) -> Dict[str, Any]:
    """Komplet danych raportu identyfikowalności dla partii (goły/PP/PPP)."""
    tr = trace.traceability(batch_no, "backward")

    fg = query_one(
        "SELECT * FROM finished_goods WHERE batch_no=%s OR id=%s",
        (batch_no, batch_no),
    )

    # Skład rodziców z kg — dla wyrobu z alokacji planu (production_plan_lines).
    composition: List[Dict[str, Any]] = []
    if fg:
        alloc: Dict[str, Any] = {}
        if fg.get("plan_no"):
            for ln in query_all(
                "SELECT pl.batch_allocation FROM production_plan_lines pl "
                "JOIN production_plans p ON p.id=pl.plan_id WHERE p.plan_no=%s",
                (fg["plan_no"],),
            ):
                ba = ln.get("batch_allocation") or {}
                if isinstance(ba, dict):
                    for k, v in ba.items():
                        alloc.setdefault(k, v)
        composition = build_composition(fg.get("seasoned_batch_nos") or [], alloc)

    header_batch = (fg or {}).get("batch_no") or batch_no
    return {
        "batchNo": header_batch,
        "batchType": classify_batch_type(header_batch),
        "finishedGood": fg,
        "composition": composition,
        "trace": tr,
        "seasonedBalance": [
            {
                "batch_no": s.get("batch_no"),
                "kg_produced": s.get("kg_produced"),
                "kg_used": s.get("kg_used"),
                "kg_available": s.get("kg_available"),
            }
            for s in tr.get("seasonedBatches", [])
        ],
    }
