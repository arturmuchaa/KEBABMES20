"""Agregacje analityki KPI (trendy). Czysty odczyt — date_trunc po okresie.

Granularity z whitelisty (anty-injection), daty jako ISO 'YYYY-MM-DD'.
"""
from typing import Dict, List

from app.db import query_all

# Whitelist: mapowanie granulacji → jednostka date_trunc.
BUCKETS: Dict[str, str] = {"day": "day", "week": "week", "month": "month"}


def _unit(granularity: str) -> str:
    return BUCKETS.get((granularity or "").lower(), "day")


def mixing_yield(date_from: str, date_to: str, granularity: str) -> List[Dict]:
    unit = _unit(granularity)
    rows = query_all(
        """
        SELECT date_trunc(%s, started_at)::date AS period,
               SUM(kg_meat)   AS kg_meat,
               SUM(kg_output) AS kg_output
        FROM mixing_sessions
        WHERE started_at::date BETWEEN %s AND %s
        GROUP BY 1 ORDER BY 1
        """,
        (unit, date_from, date_to),
    )
    out = []
    for r in rows:
        kg_meat = float(r.get("kg_meat") or 0)
        kg_output = float(r.get("kg_output") or 0)
        out.append({
            "period": str(r["period"]),
            "kgMeat": round(kg_meat, 3),
            "kgOutput": round(kg_output, 3),
            "yieldPct": round(kg_output / kg_meat * 100, 2) if kg_meat > 0 else 0.0,
        })
    return out


def volume(date_from: str, date_to: str, granularity: str) -> List[Dict]:
    unit = _unit(granularity)
    mixed = query_all(
        """
        SELECT date_trunc(%s, started_at)::date AS period, SUM(kg_output) AS kg
        FROM mixing_sessions
        WHERE started_at::date BETWEEN %s AND %s
        GROUP BY 1
        """,
        (unit, date_from, date_to),
    )
    produced = query_all(
        """
        SELECT date_trunc(%s, p.plan_date)::date AS period,
               SUM(l.qty_done)                 AS units,
               SUM(l.qty_done * l.kg_per_unit) AS kg
        FROM production_plan_lines l
        JOIN production_plans p ON p.id = l.plan_id
        WHERE p.plan_date BETWEEN %s AND %s
        GROUP BY 1
        """,
        (unit, date_from, date_to),
    )
    merged: Dict[str, Dict] = {}
    for r in mixed:
        merged.setdefault(str(r["period"]), {})["kgSeasoned"] = round(float(r.get("kg") or 0), 3)
    for r in produced:
        m = merged.setdefault(str(r["period"]), {})
        m["unitsProduced"] = int(r.get("units") or 0)
        m["kgProduced"] = round(float(r.get("kg") or 0), 3)
    return [
        {
            "period": period,
            "kgSeasoned": v.get("kgSeasoned", 0.0),
            "unitsProduced": v.get("unitsProduced", 0),
            "kgProduced": v.get("kgProduced", 0.0),
        }
        for period, v in sorted(merged.items())
    ]


def cost_trend(date_from: str, date_to: str, granularity: str) -> List[Dict]:
    unit = _unit(granularity)
    rows = query_all(
        """
        SELECT date_trunc(%s, COALESCE(received_date, created_at::date))::date AS period,
               SUM(price_per_kg * kg_received) / NULLIF(SUM(kg_received), 0) AS raw_cost
        FROM raw_batches
        WHERE price_per_kg > 0 AND kg_received > 0
          AND COALESCE(received_date, created_at::date) BETWEEN %s AND %s
        GROUP BY 1 ORDER BY 1
        """,
        (unit, date_from, date_to),
    )
    return [
        {"period": str(r["period"]), "rawCostPerKg": round(float(r.get("raw_cost") or 0), 4)}
        for r in rows
    ]
