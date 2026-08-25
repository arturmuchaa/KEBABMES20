"""Zeskanowana sztuka wchodzi NA MAGAZYN wyrobu gotowego od razu.

Do tej pory wyrób gotowy powstawał dopiero przy potwierdzeniu dnia przez
biuro. Hala skanuje kebaby w trakcie pozycji i po niej — i tego samego dnia
pakowanie oraz wydanie pracują na tym stanie. Czekanie do wieczora oznaczało,
że system pokazuje zero tam, gdzie w chłodni stoi pół dnia produkcji.

Trzy rzeczy, o które trzeba tu zadbać:

1. **Brak podwójnego wprowadzenia.** Sztuka zaksięgowana skanem dostaje
   `stock_booked_at`, a `finish_day` dopisuje WYŁĄCZNIE resztę — per partia,
   nie zbiorczo, żeby rozbicie na partie nie rozjechało się o jedną sztukę.

2. **Skan nie rusza masowni.** Mięso przyprawione konsumuje się nadal RAZ,
   przy potwierdzeniu dnia. Skan dotyka tylko strony wyrobu gotowego.

3. **Ten sam wiersz co przy potwierdzeniu.** Księgujemy przez ten sam
   `_upsert_goods_row`, którego używa `finish_day` — inaczej ta sama produkcja
   siedziałaby w dwóch wierszach magazynu, różniących się tylko drogą zapisu.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from app.db import cx_execute, cx_query_one
from app.logging_config import get_logger
from app.utils.batch_numbers import kebab_batch_no

logger = get_logger(__name__)


def book_scanned_unit(conn, unit: Dict[str, Any]) -> str | None:
    """Zaksięguj JEDNĄ zeskanowaną sztukę na magazynie wyrobu gotowego.

    Wołane wewnątrz transakcji skanu — sztuka i stan magazynu muszą zmienić się
    razem albo wcale. Zwraca id wyrobu gotowego albo None, gdy nie ma czego
    księgować (sztuka bez linii planu, plan już zamknięty przez biuro).
    """
    # Import lokalny: finished_goods_service importuje finished_units_service,
    # a ten woła nas — na poziomie modułu powstałby cykl.
    from app.models.production import FinishDayEntry
    from app.services.finished_goods_service import _resolve_lineage, _upsert_goods_row

    plan_line_id = unit.get("plan_line_id") or ""
    if not plan_line_id or unit.get("stock_booked_at"):
        return None

    line = cx_query_one(
        conn, "SELECT * FROM production_plan_lines WHERE id=%s", (plan_line_id,)
    )
    if not line:
        return None
    plan = cx_query_one(
        conn, "SELECT * FROM production_plans WHERE id=%s FOR UPDATE",
        (line.get("plan_id"),),
    )
    if not plan:
        return None
    if plan.get("status") == "done":
        # Dzień domknięty — wyrób gotowy już powstał przy potwierdzeniu.
        # Skan zostaje skanem (status sztuki), magazynu nie ruszamy.
        return None

    # Data księgowania jak przy potwierdzeniu dnia (`finish_day` liczy od
    # dzisiaj) — dzięki temu skan i dopisana reszta trafiają w ten sam wiersz.
    today = datetime.now().date().isoformat()
    raw = (unit.get("batch_no") or "").strip()
    bno = kebab_batch_no(today, raw) if raw else kebab_batch_no(today, "")

    entry = FinishDayEntry(
        plan_line_id=plan_line_id,
        qty=1,
        kg_per_unit=float(unit.get("weight_kg") or line.get("kg_per_unit") or 0),
        product_type_id=line.get("product_type_id") or "",
        product_type_name=line.get("product_type_name") or "",
        recipe_id=line.get("recipe_id") or "",
        recipe_name=line.get("recipe_name") or "",
        packaging_id=line.get("packaging_id") or "",
        packaging_name=line.get("packaging_name") or "",
        client_order_id=line.get("client_order_id") or "",
        client_order_no=line.get("client_order_no") or "",
        client_name=line.get("client_name") or "",
        seasoned_batch_nos=[raw] if raw else [],
        worker_names=[],
    )
    kg = round(entry.qty * entry.kg_per_unit, 3)
    lineage = _resolve_lineage(conn, [raw] if raw else [])
    goods_id = _upsert_goods_row(
        conn, plan, entry, today, bno, 1, kg, [raw] if raw else [], lineage,
    )

    cx_execute(
        conn,
        "UPDATE finished_units SET source_finished_goods_id=%s, stock_booked_at=now() "
        "WHERE id=%s",
        (goods_id, unit["id"]),
    )
    logger.info(
        "finished_units.booked_to_stock",
        extra={"unit_id": unit["id"], "goods_id": goods_id, "batch_no": bno},
    )
    return goods_id


def booked_by_batch(conn, plan_line_id: str) -> Dict[str, int]:
    """Ile sztuk tej linii weszło już na magazyn skanem — per partia wsadowa.

    Per partia, nie zbiorczo: pozycja rozbita na dwie partie, z której hala
    zeskanowała sztuki tylko z jednej, musi dostać dopisaną resztę z każdej
    partii osobno.
    """
    if not plan_line_id:
        return {}
    rows = cx_query_one(
        conn,
        "SELECT jsonb_object_agg(COALESCE(batch_no,''), n) AS po_partii FROM ("
        "  SELECT batch_no, count(*) AS n FROM finished_units"
        "  WHERE plan_line_id=%s AND stock_booked_at IS NOT NULL"
        "  GROUP BY batch_no"
        ") s",
        (plan_line_id,),
    )
    po = (rows or {}).get("po_partii") or {}
    return {str(k): int(v) for k, v in po.items()}
