"""Dokument WZ (Wydanie Zewnętrzne) — numeracja, budowa pozycji, generowanie.

Wzorzec jak HDI: numer WZ/NN/MM/RR z MAX(seq) per year_month, idempotencja
per (source_type, source_id), druk przez headless Chrome.
"""
import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from app.db import cx_execute_returning, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.settings_service import get_company
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def format_wz_number(seq: int, year_month: str) -> str:
    # year_month = "RRMM" (np. "2606"); numer = WZ/NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"WZ/{seq}/{mm}/{yy}"


def build_wz_lines(items: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Zbuduj pozycje WZ. valued=True → cena + wartość (qty*price)."""
    lines: List[Dict[str, Any]] = []
    total = 0.0
    for it in items or []:
        qty = float(it.get("qty") or 0)
        line: Dict[str, Any] = {
            "name": it.get("name") or "",
            "qty": round(qty, 3),
            "unit": it.get("unit") or "kg",
            "batch_no": it.get("batch_no"),
            "price": None,
            "value": None,
        }
        if valued:
            price = float(it.get("price") or 0)
            value = round(qty * price, 2)
            line["price"] = round(price, 2)
            line["value"] = value
            total += value
        lines.append(line)
    return lines, round(total, 2)
