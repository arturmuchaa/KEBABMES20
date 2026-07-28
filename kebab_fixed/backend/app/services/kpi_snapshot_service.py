"""Miesięczne KPI rozbioru — migawki dla raportu zarządczego.

Po co migawki, skoro wszystko da się policzyć z `deboning_stats`? Bo korekty
wchodzą WSTECZ (storno wpisu, zmiana partii, korekty biurowe, doważenia
ubocznych). Trend liczony na żywo zmieniałby historię pod prezesem: lipiec
wydrukowany 1 sierpnia i ten sam lipiec wydrukowany we wrześniu podawałyby
inne liczby, a raport zarządczy ma być dokumentem, nie widokiem.

Zasady:
* miesiąc ZAKOŃCZONY czyta się z migawki (zamrożony),
* miesiąc BIEŻĄCY liczy się na żywo i jest oznaczony `closed: False`,
* przeliczenie zamkniętego miesiąca to świadoma decyzja (`force=True`),
* miesiąc BEZ rozbioru nie dostaje migawki — pusty słupek w trendzie
  wyglądałby jak zapaść produkcji, a był po prostu brak danych.

I rzecz, przez którą to powstało: gdy nie ma poprzedniego miesiąca, delta jest
`None`, nie zero. Dane rozbioru zaczynają się 7.07.2026 — „+0,3 p.p. vs
czerwiec" nie istnieje i raport nie ma prawa takiej liczby wydrukować.
"""
import json
from calendar import monthrange
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.utils.ids import cuid

#: Kolumny migawki ↔ klucze API (jedno źródło dla zapisu i odczytu).
_FIELDS = [
    ("kg_quarter", "kgQuarter"), ("kg_meat", "kgMeat"), ("kg_backs", "kgBacks"),
    ("kg_bones", "kgBones"), ("missing_kg", "missingKg"), ("avg_yield", "avgYield"),
    ("kg_per_hour", "kgPerHour"), ("quarter_cost", "quarterCost"),
    ("labor_cost", "laborCost"), ("byproduct_revenue", "byproductRevenue"),
    ("meat_cost_per_kg", "meatCostPerKg"), ("yield_point_value", "yieldPointValuePln"),
    ("entries", "entries"), ("batches", "batches"), ("workers", "workers"),
    ("prod_days", "prodDays"),
]
_INT_KEYS = {"entries", "batches", "workers", "prodDays"}


def month_bounds(year_month: str) -> tuple[str, str]:
    """'2026-07' → ('2026-07-01', '2026-07-31')."""
    try:
        y, m = (int(x) for x in str(year_month).split("-"))
        first = date(y, m, 1)
    except (ValueError, TypeError):
        raise HTTPException(400, f"Zły miesiąc: {year_month!r} (oczekiwano RRRR-MM)")
    return first.isoformat(), date(y, m, monthrange(y, m)[1]).isoformat()


def _today(today: Optional[str] = None) -> date:
    return date.fromisoformat(today) if today else date.today()


def build_month_kpi(year_month: str) -> Dict[str, Any]:
    """Policz KPI miesiąca z żywych danych (bez zapisu)."""
    from app.services.deboning_service import deboning_stats

    frm, to = month_bounds(year_month)
    st = deboning_stats(frm, to)
    s = st["summary"]
    cost = s.get("meatCostPerKg")

    return {
        "yearMonth": year_month,
        "kgQuarter": s["kgQuarter"],
        "kgMeat": s["kgMeat"],
        "kgBacks": s["kgBacks"],
        "kgBones": s["kgBones"],
        "missingKg": s["missingKg"],
        "avgYield": s["avgYield"],
        "kgPerHour": s["kgPerHour"],
        "quarterCost": s.get("quarterCost"),
        "laborCost": s.get("laborCost"),
        "byproductRevenue": s.get("byproductRevenue"),
        "meatCostPerKg": cost,
        # Ile złotych warte jest 0,1 p.p. uzysku w tym miesiącu. Przekłada
        # uzysk na pieniądze BEZ znajomości cen sprzedaży (te w MES nie
        # siedzą — sprzedaż idzie poza systemem), więc jest to jedyna
        # uczciwa miara „ile kosztował nas słaby rozbiór".
        "yieldPointValuePln": round(s["kgQuarter"] * 0.001 * cost, 2) if cost else None,
        "entries": s["quarters"],
        "batches": len([b for b in st["byBatch"] if b.get("yieldPct") is not None]),
        "workers": s["workers"],
        "prodDays": len(st["byDay"]),
        "suppliers": _suppliers(st, s),
    }


def _suppliers(st: Dict[str, Any], summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Uzysk per dostawca + odchylenie od średniej zakładu W ZŁOTÓWKACH.

    Procenty nikogo nie poruszają; „ten dostawca kosztował nas 15 tys. zł"
    poruszy. Liczone tak samo jak wartość 0,1 p.p.: różnica punktów
    procentowych × kg ćwiartki × koszt 1 kg mięsa.
    """
    avg = summary.get("avgYield") or 0.0
    cost = summary.get("meatCostPerKg")
    agg: Dict[str, Dict[str, float]] = {}
    for b in st["byBatch"]:
        name = b.get("supplierName")
        if not name or b.get("yieldPct") is None:
            continue
        cur = agg.setdefault(name, {"kgQuarter": 0.0, "kgMeat": 0.0, "batches": 0})
        cur["kgQuarter"] += b["kgQuarter"]
        cur["kgMeat"] += b["kgMeat"]
        cur["batches"] += 1

    out = []
    for name, v in agg.items():
        y = v["kgMeat"] / v["kgQuarter"] * 100 if v["kgQuarter"] else 0.0
        delta_pp = y - avg
        out.append({
            "name": name,
            "batches": int(v["batches"]),
            "kgQuarter": round(v["kgQuarter"], 1),
            "kgMeat": round(v["kgMeat"], 1),
            "avgYield": round(y, 1),
            "deltaPp": round(delta_pp, 2),
            "deltaPln": round(delta_pp / 100 * v["kgQuarter"] * cost, 2) if cost else None,
        })
    out.sort(key=lambda x: -x["kgQuarter"])
    return out


def _row_to_kpi(r: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"yearMonth": r["year_month"], "closed": True,
                           "closedAt": r["closed_at"].isoformat() if r["closed_at"] else None,
                           "closedBy": r.get("closed_by") or ""}
    for col, key in _FIELDS:
        v = r.get(col)
        out[key] = None if v is None else (int(v) if key in _INT_KEYS else float(v))
    sup = r.get("suppliers")
    out["suppliers"] = json.loads(sup) if isinstance(sup, str) else (sup or [])
    return out


def close_month(year_month: str, closed_by: str = "", force: bool = False) -> Dict[str, Any]:
    """Zamroź KPI miesiąca. Bez `force` nie rusza istniejącej migawki, więc
    można bezpiecznie wołać przy każdym otwarciu raportu."""
    existing = query_one("SELECT * FROM kpi_monthly_snapshots WHERE year_month=%s", (year_month,))
    if existing and not force:
        return _row_to_kpi(existing)

    k = build_month_kpi(year_month)
    cols = [c for c, _ in _FIELDS]
    vals = [k[key] for _, key in _FIELDS]
    execute(
        f"INSERT INTO kpi_monthly_snapshots (id, year_month, closed_by, suppliers, {', '.join(cols)}) "
        f"VALUES (%s,%s,%s,%s,{', '.join(['%s'] * len(cols))}) "
        "ON CONFLICT (year_month) DO UPDATE SET closed_at=now(), closed_by=EXCLUDED.closed_by, "
        "suppliers=EXCLUDED.suppliers, "
        + ", ".join(f"{c}=EXCLUDED.{c}" for c in cols),
        [cuid(), year_month, closed_by, json.dumps(k["suppliers"], ensure_ascii=False), *vals],
    )
    return get_month_kpi(year_month)


def get_month_kpi(year_month: str, today: Optional[str] = None) -> Dict[str, Any]:
    """Zamknięty miesiąc z migawki; bieżący (i każdy niezamknięty) na żywo."""
    row = query_one("SELECT * FROM kpi_monthly_snapshots WHERE year_month=%s", (year_month,))
    if row:
        return _row_to_kpi(row)
    k = build_month_kpi(year_month)
    k.update({"closed": False, "closedAt": None, "closedBy": ""})
    return k


def ensure_closed_months(today: Optional[str] = None) -> List[str]:
    """Domknij każdy ZAKOŃCZONY miesiąc, w którym był rozbiór, a którego
    jeszcze nie zamknięto. Idempotentne — wołane przy wejściu w raport,
    żeby nikt nie musiał pamiętać o „zamknięciu miesiąca"."""
    now = _today(today)
    current = f"{now.year:04d}-{now.month:02d}"
    have = {r["year_month"] for r in query_all("SELECT year_month FROM kpi_monthly_snapshots")}
    months = query_all(
        "SELECT DISTINCT to_char((created_at AT TIME ZONE 'Europe/Warsaw'), 'YYYY-MM') AS ym "
        "FROM deboning_entries WHERE COALESCE(status,'complete')='complete' ORDER BY 1"
    )
    closed: List[str] = []
    for m in months:
        ym = m["ym"]
        if ym >= current or ym in have:
            continue
        close_month(ym, closed_by="auto")
        closed.append(ym)
    return closed


def list_kpi_months(limit: int = 12, today: Optional[str] = None) -> List[Dict[str, Any]]:
    """Trend: zamknięte miesiące + bieżący na żywo, od najstarszego.

    `deltaYieldPp` / `deltaMeatCostPerKg` liczą się WYŁĄCZNIE względem
    miesiąca bezpośrednio poprzedzającego. Brak poprzednika → None, żeby
    raport napisał „brak danych porównawczych" zamiast zmyślić zmianę.
    """
    ensure_closed_months(today)
    now = _today(today)
    current = f"{now.year:04d}-{now.month:02d}"

    rows = query_all(
        "SELECT * FROM kpi_monthly_snapshots ORDER BY year_month DESC LIMIT %s", (max(1, limit),))
    out = [_row_to_kpi(r) for r in reversed(rows)]
    if not any(m["yearMonth"] == current for m in out):
        live = get_month_kpi(current, today)
        if live["entries"]:
            out.append(live)

    for i, m in enumerate(out):
        prev = out[i - 1] if i > 0 else None
        # Poprzednik musi być SĄSIEDNIM miesiącem — dziura w danych nie może
        # udawać ciągłości (porównanie lipca z kwietniem to nie trend).
        if prev and _is_prev_month(prev["yearMonth"], m["yearMonth"]):
            m["deltaYieldPp"] = _delta(m["avgYield"], prev["avgYield"])
            m["deltaMeatCostPerKg"] = _delta(m["meatCostPerKg"], prev["meatCostPerKg"])
            m["deltaKgPerHour"] = _delta(m["kgPerHour"], prev["kgPerHour"])
        else:
            m["deltaYieldPp"] = m["deltaMeatCostPerKg"] = m["deltaKgPerHour"] = None
    return out


def _is_prev_month(a: str, b: str) -> bool:
    ya, ma = (int(x) for x in a.split("-"))
    yb, mb = (int(x) for x in b.split("-"))
    return (yb * 12 + mb) - (ya * 12 + ma) == 1


def _delta(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
    if cur is None or prev is None:
        return None
    return round(cur - prev, 2)
