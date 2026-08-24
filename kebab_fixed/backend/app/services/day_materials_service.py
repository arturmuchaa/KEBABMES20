"""Materiały zużyte w dniu produkcyjnym — folia stretch i kolejne.

Po co osobna tabela, skoro `packaging` ma `kg_used`? Bo `kg_used` jest
NARASTAJĄCE i nie odpowie na pytanie „ile folii poszło 25.08", a właśnie tego
potrzebuje koszt dnia. Zapis per dzień musi też przeżyć zamknięcie planu —
koszt liczy się po fakcie, czasem po tygodniu.

Zużycie dnia = POBRANE − ZWRÓCONE. Zwrot jest ruchem magazynowym w drugą
stronę (oddaje do `kg_available`, zdejmuje z `kg_used`), więc stan zgadza się
z fizycznym bez ręcznej inwentaryzacji.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.stock import create_stock_movement

logger = get_logger(__name__)

RODZAJE = ("pobranie", "zwrot")


def _sprawdz_ilosc(qty: float) -> float:
    q = float(qty or 0)
    if q <= 0:
        raise HTTPException(400, "Ilość musi być większa od zera")
    return q


def _zapisz_ruch_dnia(conn, work_date: str, packaging_id: str, qty: float, kind: str, by: str) -> None:
    cx_execute(
        conn,
        """
        INSERT INTO production_day_materials
            (id, work_date, packaging_id, qty, kind, created_at, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (cuid(), work_date, packaging_id, qty, kind, now_iso(), by or ""),
    )


def take_material(work_date: str, packaging_id: str, qty: float, by: str = "") -> Dict[str, Any]:
    """Pobranie z magazynu — stan schodzi OD RAZU (rolki fizycznie znikają rano)."""
    q = _sprawdz_ilosc(qty)
    with transaction() as conn:
        pkg = cx_query_one(
            conn, "SELECT name, kg_available FROM packaging WHERE id=%s FOR UPDATE", (packaging_id,)
        )
        if not pkg:
            raise HTTPException(404, "Opakowanie nie znalezione")
        dostepne = float(pkg["kg_available"] or 0)
        if dostepne + 0.01 < q:
            raise HTTPException(
                400, f"Na magazynie jest {dostepne:g} — nie można pobrać {q:g}"
            )
        cx_execute(
            conn,
            "UPDATE packaging SET kg_available = kg_available - %s, kg_used = kg_used + %s WHERE id=%s",
            (q, q, packaging_id),
        )
        create_stock_movement(
            conn, product_type="packaging", batch_id=packaging_id, qty=q,
            movement_type="OUT", source_type="production_day", source_id=work_date,
        )
        _zapisz_ruch_dnia(conn, work_date, packaging_id, q, "pobranie", by)
    logger.info("day_materials.taken", extra={"work_date": work_date, "packaging_id": packaging_id, "qty": q})
    return {"ok": True}


def return_material(work_date: str, packaging_id: str, qty: float, by: str = "") -> Dict[str, Any]:
    """Zwrot niewykorzystanego — tylko w granicach tego, co TEGO DNIA pobrano."""
    q = _sprawdz_ilosc(qty)
    with transaction() as conn:
        pkg = cx_query_one(conn, "SELECT name FROM packaging WHERE id=%s FOR UPDATE", (packaging_id,))
        if not pkg:
            raise HTTPException(404, "Opakowanie nie znalezione")
        bilans = cx_query_one(
            conn,
            """
            SELECT
              COALESCE(SUM(CASE WHEN kind='pobranie' THEN qty ELSE 0 END), 0) AS pobrane,
              COALESCE(SUM(CASE WHEN kind='zwrot'    THEN qty ELSE 0 END), 0) AS zwrocone
            FROM production_day_materials
            WHERE work_date = %s AND packaging_id = %s
            """,
            (work_date, packaging_id),
        )
        pobrane = float((bilans or {}).get("pobrane") or 0)
        zwrocone = float((bilans or {}).get("zwrocone") or 0)
        # Zwrot ponad pobranie dnia podniósłby magazyn z powietrza — i zszedł
        # kosztem dnia poniżej zera.
        if q > pobrane - zwrocone + 0.01:
            raise HTTPException(
                400,
                f"Nie można zwrócić {q:g} — tego dnia pobrano {pobrane:g}"
                + (f", zwrócono już {zwrocone:g}" if zwrocone else ""),
            )
        cx_execute(
            conn,
            "UPDATE packaging SET kg_available = kg_available + %s, kg_used = GREATEST(kg_used - %s, 0) WHERE id=%s",
            (q, q, packaging_id),
        )
        create_stock_movement(
            conn, product_type="packaging", batch_id=packaging_id, qty=q,
            movement_type="IN", source_type="production_day_return", source_id=work_date,
        )
        _zapisz_ruch_dnia(conn, work_date, packaging_id, q, "zwrot", by)
    logger.info("day_materials.returned", extra={"work_date": work_date, "packaging_id": packaging_id, "qty": q})
    return {"ok": True}


def day_materials(work_date: str) -> List[Dict[str, Any]]:
    """Co poszło na produkcję danego dnia — pozycja po pozycji, z ruchami."""
    wiersze = query_all(
        """
        SELECT m.packaging_id, p.name, p.unit,
               SUM(CASE WHEN m.kind='pobranie' THEN m.qty ELSE 0 END) AS pobrane,
               SUM(CASE WHEN m.kind='zwrot'    THEN m.qty ELSE 0 END) AS zwrocone
        FROM production_day_materials m
        LEFT JOIN packaging p ON p.id = m.packaging_id
        WHERE m.work_date = %s
        GROUP BY m.packaging_id, p.name, p.unit
        ORDER BY p.name
        """,
        (work_date,),
    )
    ruchy = query_all(
        """
        SELECT packaging_id, kind, qty, created_at, created_by
        FROM production_day_materials
        WHERE work_date = %s
        ORDER BY created_at
        """,
        (work_date,),
    )
    out: List[Dict[str, Any]] = []
    for w in wiersze:
        pobrane = float(w["pobrane"] or 0)
        zwrocone = float(w["zwrocone"] or 0)
        out.append({
            "packaging_id": w["packaging_id"],
            "name": w.get("name") or "",
            "unit": w.get("unit") or "",
            "pobrane": pobrane,
            "zwrocone": zwrocone,
            "zuzyte": max(0.0, pobrane - zwrocone),
            "moves": [
                {
                    "kind": r["kind"],
                    "qty": float(r["qty"] or 0),
                    "at": r["created_at"],
                    "by": r.get("created_by") or "",
                }
                for r in ruchy if r["packaging_id"] == w["packaging_id"]
            ],
        })
    return out
