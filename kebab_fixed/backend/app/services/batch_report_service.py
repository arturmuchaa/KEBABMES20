"""Budowa raportu identyfikowalności partii dla inspekcji weterynaryjnej."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def build_composition(
    parent_batch_nos: List[str],
    allocation: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Lista rodziców partii z kg/szt z alokacji planu.

    ``allocation`` = {batch_no: {"kg": float, "pieces": int}} (z
    production_plan_lines.batch_allocation). Brak wpisu → kg/pieces None
    (NIE zgadujemy — uczciwość wobec inspektora)."""
    alloc = allocation if isinstance(allocation, dict) else {}
    out: List[Dict[str, Any]] = []
    for bno in parent_batch_nos or []:
        a = alloc.get(bno) if isinstance(alloc.get(bno), dict) else {}
        out.append({
            "batch_no": bno,
            "kg": a.get("kg") if a else None,
            "pieces": a.get("pieces") if a else None,
        })
    return out
