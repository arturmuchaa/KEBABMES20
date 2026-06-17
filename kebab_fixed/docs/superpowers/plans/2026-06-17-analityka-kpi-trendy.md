# Analityka KPI (trendy) MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strona `/office/analityka` z trendami: uzysk masowania %, wolumen (kg/szt), koszt mięsa/kg — granulacja dzień/tydzień/miesiąc, zakres dat, wykresy recharts + karty KPI.

**Architecture:** Backend `analytics_service` robi czyste agregacje SQL `date_trunc(granularity, data)` na istniejących tabelach (`mixing_sessions`, `production_plan_lines`+`production_plans`, `raw_batches`). Route `/api/analytics/*` (dostęp biuro). Frontend `AnalitykaPage` (recharts, już w zależnościach). Agregacje pokryte testami integracyjnymi na bazie testowej (harness z conftest).

**Tech Stack:** FastAPI + psycopg + PostgreSQL; React + TS + recharts; testy pytest (baza testowa gated `TEST_DATABASE_URL`).

## Global Constraints

- Brak nowych zależności (recharts już zainstalowany).
- Testy DB gated `TEST_DATABASE_URL` (bez niej skip); fixture `db` z `backend/tests/conftest.py` (TRUNCATE per test).
- Granularity z whitelisty: `day` | `week` | `month` (mapuje na `date_trunc`).
- `kgAvailable` z mapMeatStock to już `kg_free` — nie dotyczy tego planu (czytamy surowe tabele), ale pamiętać przy meat_stock.
- Dostęp do `/api/analytics` = biuro (default `permission_for_path` = "office", nie trzeba zmieniać uprawnień).

**Spec:** `docs/superpowers/specs/2026-06-17-analityka-kpi-trendy-design.md`

---

## File Structure

- **Create** `backend/app/services/analytics_service.py` — agregacje (bucket helper + 3 funkcje).
- **Create** `backend/tests/test_analytics_db.py` — testy agregacji.
- **Create** `backend/app/routes/analytics.py` — endpointy GET.
- **Modify** `backend/app/main.py` — import + include `analytics` w krotce routerów.
- **Modify** `src/lib/api.ts` — `analyticsApi`.
- **Create** `src/pages/office/AnalitykaPage.tsx` — strona z wykresami.
- **Modify** `src/App.tsx` — trasa `/office/analityka`.
- **Modify** `src/layouts/OfficeSidebar.tsx` — link w sekcji Produkcja.

---

## Task 1: Backend — analytics_service (agregacje) + testy

**Files:**
- Create: `backend/app/services/analytics_service.py`
- Test: `backend/tests/test_analytics_db.py`

**Interfaces:**
- Produces:
  - `mixing_yield(date_from: str, date_to: str, granularity: str) -> list[dict]` → `[{"period","kgMeat","kgOutput","yieldPct"}]`
  - `volume(date_from: str, date_to: str, granularity: str) -> list[dict]` → `[{"period","kgSeasoned","unitsProduced","kgProduced"}]`
  - `cost_trend(date_from: str, date_to: str, granularity: str) -> list[dict]` → `[{"period","rawCostPerKg"}]`
  - `BUCKETS: dict` (whitelist day/week/month)

- [ ] **Step 1: Napisz failing test** `backend/tests/test_analytics_db.py`:

```python
"""Testy integracyjne agregacji analityki (SQL na bazie testowej)."""
from app.db import execute
from app.services.analytics_service import mixing_yield, volume, cost_trend


def _seed_session(order_id, kg_meat, kg_output, day):
    # mixing_sessions wymaga order_id (FK do mixing_orders)
    execute(
        "INSERT INTO mixing_orders (id, order_no, status) VALUES (%s,%s,'done') "
        "ON CONFLICT (id) DO NOTHING",
        (order_id, f"MAS/{order_id}"),
    )
    execute(
        "INSERT INTO mixing_sessions (id, order_id, machine_id, kg_meat, kg_output, batch_no, started_at) "
        "VALUES (%s,%s,1,%s,%s,'b', %s::timestamptz)",
        (f"s-{order_id}-{day}-{kg_output}", order_id, kg_meat, kg_output, f"{day} 10:00:00+00"),
    )


def test_mixing_yield_groups_by_day_and_computes_pct(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    _seed_session("o2", 200, 240, "2026-06-10")   # ten sam dzień → sumuje
    _seed_session("o3", 100, 110, "2026-06-11")
    rows = mixing_yield("2026-06-01", "2026-06-30", "day")
    by = {str(r["period"]): r for r in rows}
    assert float(by["2026-06-10"]["kgMeat"]) == 300.0
    assert float(by["2026-06-10"]["kgOutput"]) == 365.0
    assert round(float(by["2026-06-10"]["yieldPct"]), 2) == round(365 / 300 * 100, 2)
    assert "2026-06-11" in by


def test_mixing_yield_month_bucket_merges_days(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    _seed_session("o2", 100, 130, "2026-06-20")
    rows = mixing_yield("2026-06-01", "2026-06-30", "month")
    assert len(rows) == 1
    assert float(rows[0]["kgOutput"]) == 255.0


def test_volume_counts_mixed_and_produced(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    execute("INSERT INTO production_plans (id, plan_no, plan_date) VALUES ('p1','PL/1','2026-06-10')")
    execute(
        "INSERT INTO production_plan_lines (id, plan_id, qty, qty_done, kg_per_unit, total_kg, worker_entries, line_status) "
        "VALUES ('l1','p1',10,8,40,320,'[]'::jsonb,'DONE')",
    )
    rows = volume("2026-06-01", "2026-06-30", "day")
    by = {str(r["period"]): r for r in rows}
    assert float(by["2026-06-10"]["kgSeasoned"]) == 125.0
    assert int(by["2026-06-10"]["unitsProduced"]) == 8
    assert float(by["2026-06-10"]["kgProduced"]) == 320.0   # 8 * 40


def test_cost_trend_weighted_avg_raw_price(db):
    execute("INSERT INTO raw_batches (id, internal_batch_no, price_per_kg, kg_received, received_date) "
            "VALUES ('r1','RB1',10,100,'2026-06-10')")
    execute("INSERT INTO raw_batches (id, internal_batch_no, price_per_kg, kg_received, received_date) "
            "VALUES ('r2','RB2',20,300,'2026-06-10')")   # ważona: (10*100+20*300)/400 = 17.5
    rows = cost_trend("2026-06-01", "2026-06-30", "day")
    by = {str(r["period"]): r for r in rows}
    assert round(float(by["2026-06-10"]["rawCostPerKg"]), 2) == 17.5


def test_invalid_granularity_defaults_to_day(db):
    _seed_session("o1", 100, 125, "2026-06-10")
    rows = mixing_yield("2026-06-01", "2026-06-30", "nonsense")
    assert len(rows) == 1   # potraktowane jak day
```

- [ ] **Step 2: Uruchom — FAIL (brak modułu)**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
PW=$(docker exec kebab-op env 2>/dev/null | grep POSTGRES_PASSWORD | cut -d= -f2)
TEST_DATABASE_URL="postgresql://postgres:${PW}@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_analytics_db.py -q 2>&1 | tail -5
```
Expected: błąd importu `analytics_service`.

- [ ] **Step 3: Utwórz `backend/app/services/analytics_service.py`**

```python
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
```

- [ ] **Step 4: Uruchom — PASS**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
PW=$(docker exec kebab-op env 2>/dev/null | grep POSTGRES_PASSWORD | cut -d= -f2)
TEST_DATABASE_URL="postgresql://postgres:${PW}@localhost:55437/kebab_mes_test" python3 -m pytest tests/test_analytics_db.py -q 2>&1 | tail -4
```
Expected: 5 passed.

- [ ] **Step 5: Pełny pytest (bez bazy — DB skip) + commit**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q 2>&1 | tail -2`
Expected: brak FAILED (testy analityki skipped bez TEST_DATABASE_URL).

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/analytics_service.py backend/tests/test_analytics_db.py
git commit -m "feat(analytics): agregacje KPI (uzysk masowania/wolumen/koszt) + testy"
```

---

## Task 2: Backend — route /api/analytics/* + rejestracja

**Files:**
- Create: `backend/app/routes/analytics.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `analytics_service.mixing_yield/volume/cost_trend` (Task 1).
- Produces: `GET /api/analytics/mixing-yield|volume|cost-trend?from&to&granularity`.

- [ ] **Step 1: Utwórz `backend/app/routes/analytics.py`**

```python
"""Analityka KPI (trendy). Dostęp: biuro (default permission)."""
from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.services import analytics_service as svc

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _default_range(date_from: str, date_to: str) -> tuple[str, str]:
    today = date.today()
    to = date_to or today.isoformat()
    frm = date_from or (today - timedelta(days=30)).isoformat()
    return frm, to


@router.get("/mixing-yield")
def mixing_yield(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    granularity: str = Query("day"),
):
    frm, t = _default_range(from_, to)
    return svc.mixing_yield(frm, t, granularity)


@router.get("/volume")
def volume(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    granularity: str = Query("day"),
):
    frm, t = _default_range(from_, to)
    return svc.volume(frm, t, granularity)


@router.get("/cost-trend")
def cost_trend(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
    granularity: str = Query("day"),
):
    frm, t = _default_range(from_, to)
    return svc.cost_trend(frm, t, granularity)
```

- [ ] **Step 2: Zarejestruj w `backend/app/main.py`**

W bloku `from app.routes import (` dodaj `analytics,` (zaraz po `audit,`):

```python
    from app.routes import (  # noqa: E402
        app_users,
        audit,
        analytics,
        auth,
```

W krotce includowanej (gdzie jest `vies.gus_router, audit, traceability`) dodaj `analytics,`:

```python
        vies.gus_router,
        audit,
        analytics,
        traceability,
```

- [ ] **Step 3: Syntax + rejestracja trasy**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -c "import ast; ast.parse(open('app/routes/analytics.py').read()); ast.parse(open('app/main.py').read()); print('syntax OK')"
python3 -c "from app.routes import analytics; print('prefix', analytics.router.prefix, [r.path for r in analytics.router.routes])"
```
Expected: `syntax OK`; prefix `/api/analytics` z trasami `/mixing-yield`, `/volume`, `/cost-trend`.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/routes/analytics.py backend/app/main.py
git commit -m "feat(analytics): route /api/analytics/* (mixing-yield/volume/cost-trend)"
```

---

## Task 3: Frontend — analyticsApi + strona AnalitykaPage + trasa + sidebar

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/pages/office/AnalitykaPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/layouts/OfficeSidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/analytics/*` (Task 2).

- [ ] **Step 1: Dodaj `analyticsApi` w `src/lib/api.ts`** (obok `auditApi`):

```ts
export const analyticsApi = {
  mixingYield: (from: string, to: string, g: string) =>
    get<any[]>(`/analytics/mixing-yield?from=${from}&to=${to}&granularity=${g}`),
  volume: (from: string, to: string, g: string) =>
    get<any[]>(`/analytics/volume?from=${from}&to=${to}&granularity=${g}`),
  costTrend: (from: string, to: string, g: string) =>
    get<any[]>(`/analytics/cost-trend?from=${from}&to=${to}&granularity=${g}`),
}
```

- [ ] **Step 2: Utwórz `src/pages/office/AnalitykaPage.tsx`**

```tsx
/**
 * AnalitykaPage — trendy KPI: uzysk masowania %, wolumen (kg/szt), koszt mięsa/kg.
 * Zakres dat + granulacja dzień/tydzień/miesiąc. Wykresy: recharts.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { analyticsApi } from '@/lib/apiClient'
import { fmtKg, cn } from '@/lib/utils'
import { BarChart3, TrendingUp, Coins, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'

type Gran = 'day' | 'week' | 'month'
const GRANS: { key: Gran; label: string }[] = [
  { key: 'day', label: 'Dzień' }, { key: 'week', label: 'Tydzień' }, { key: 'month', label: 'Miesiąc' },
]

function isoDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function sum(rows: any[], key: string): number {
  return (rows || []).reduce((s, r) => s + Number(r[key] || 0), 0)
}

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-surface-4 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2 text-ink-3 text-[12px] font-semibold">
        <span className="text-brand">{icon}</span>{label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-3 mt-0.5">{sub}</div>}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-4 bg-white p-4 shadow-card">
      <div className="text-[13px] font-bold text-ink mb-3">{title}</div>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>{children as any}</ResponsiveContainer>
      </div>
    </div>
  )
}

export function AnalitykaPage() {
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [g, setG] = useState<Gran>('day')

  const yieldQ = useApi<any[]>(() => analyticsApi.mixingYield(from, to, g), [from, to, g])
  const volQ = useApi<any[]>(() => analyticsApi.volume(from, to, g), [from, to, g])
  const costQ = useApi<any[]>(() => analyticsApi.costTrend(from, to, g), [from, to, g])

  const yieldRows = yieldQ.data || []
  const volRows = volQ.data || []
  const costRows = costQ.data || []

  const avgYield = useMemo(() => {
    const m = sum(yieldRows, 'kgMeat'); const o = sum(yieldRows, 'kgOutput')
    return m > 0 ? (o / m) * 100 : 0
  }, [yieldRows])
  const totalSeasoned = sum(volRows, 'kgSeasoned')
  const totalUnits = sum(volRows, 'unitsProduced')
  const lastCost = costRows.length ? Number(costRows[costRows.length - 1].rawCostPerKg) : 0

  return (
    <div className="min-h-full bg-surface-2">
      <div className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur border-b border-surface-4 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
              <BarChart3 size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-ink leading-tight">Analityka</h1>
              <p className="text-[12px] text-ink-3">Trendy: uzysk masowania, wolumen, koszt mięsa/kg</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Data od" className="h-8 w-36 bg-white text-[12px]" />
            <span className="text-ink-4">—</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Data do" className="h-8 w-36 bg-white text-[12px]" />
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-3 border border-surface-4">
              {GRANS.map(t => (
                <button key={t.key} type="button" aria-pressed={g === t.key} onClick={() => setG(t.key)}
                  className={cn('h-7 px-3 rounded-md text-[12px] font-semibold cursor-pointer transition-colors',
                    g === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* Karty KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard icon={<TrendingUp size={15} />} label="Śr. uzysk masowania" value={`${avgYield.toFixed(1)} %`} sub="w wybranym zakresie" />
          <KpiCard icon={<Layers size={15} />} label="Wyprodukowane" value={`${fmtKg(totalSeasoned, 0)} kg`} sub={`${totalUnits} szt wyrobu`} />
          <KpiCard icon={<Coins size={15} />} label="Koszt mięsa/kg (ost.)" value={`${lastCost.toFixed(2)} zł`} sub="ważona cena surowca" />
        </div>

        {/* Wykresy */}
        <ChartCard title="Uzysk masowania % w czasie">
          <LineChart data={yieldRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" />
            <Tooltip />
            <Line type="monotone" dataKey="yieldPct" name="Uzysk %" stroke="#1D4ED8" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>

        <ChartCard title="Wolumen — kg przyprawionego / szt wyrobu">
          <BarChart data={volRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="kgSeasoned" name="kg przyprawione" fill="#1D4ED8" radius={[3, 3, 0, 0]} />
            <Bar dataKey="unitsProduced" name="szt wyrobu" fill="#D97706" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Koszt mięsa/kg (ważona cena surowca)">
          <LineChart data={costRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" zł" />
            <Tooltip />
            <Line type="monotone" dataKey="rawCostPerKg" name="zł/kg" stroke="#059669" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Trasa w `src/App.tsx`**

Dodaj import obok innych stron biura:
```tsx
import { AnalitykaPage } from '@/pages/office/AnalitykaPage'
```
Dodaj trasę (po `historia-produkcji`):
```tsx
        <Route path="analityka"             element={<AnalitykaPage />} />
```

- [ ] **Step 4: Link w `src/layouts/OfficeSidebar.tsx`** (sekcja Produkcja, po „Historia produkcji"; `BarChart3` zaimportuj z lucide-react w istniejącym imporcie):

```tsx
    { to: '/office/analityka',            label: 'Analityka',          icon: <BarChart3 size={15} /> },
```
W imporcie lucide-react dodaj `BarChart3` (jeśli go nie ma).

- [ ] **Step 5: Typecheck + commit**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck 2>&1 | tail -4`
Expected: PASS.

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/lib/api.ts src/pages/office/AnalitykaPage.tsx src/App.tsx src/layouts/OfficeSidebar.tsx
git commit -m "feat(analytics): strona /office/analityka (recharts: uzysk/wolumen/koszt)"
```

---

## Task 4: Deploy + weryfikacja

**Files:** brak.

- [ ] **Step 1: Deploy backend + frontend skryptem**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && ./deploy/deploy.sh all 2>&1 | tail -8`
Expected: `backend OK — health true`, `frontend OK — serwowany: main-...js`, `deploy (all) zakończony`.

- [ ] **Step 2: Smoke endpointu (po zalogowaniu wymagane; bez auth oczekuj 401, NIE 404)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8010/api/analytics/mixing-yield?from=2026-06-01&to=2026-06-30&granularity=day"`
Expected: `401` (trasa istnieje, wymaga sesji) — NIE 404.

- [ ] **Step 3: Weryfikacja wizualna na :8080**

Zaloguj biuro → sidebar „Analityka" (`/office/analityka`). Sprawdź: 3 karty KPI, 3 wykresy renderują się, przełącznik Dzień/Tydzień/Miesiąc zmienia agregację, zakres dat działa, stan pusty gdy brak danych w zakresie.

---

## Notatki / ryzyka

- `date_trunc(%s, ...)` z parametrem jednostki — `_unit()` mapuje na whitelistę (day/week/month), więc brak ryzyka injection; nieznana wartość → 'day'.
- Wolumen łączy dwa źródła o różnych datach (masowanie `started_at` vs plan `plan_date`) — scalane po okresie w Pythonie; OK że niektóre okresy mają tylko jedną serię.
- `useApi` musi przyjmować tablicę zależności `[from,to,g]` do refetchu — jeśli sygnatura inna, sprawdź `src/hooks/useApi.ts` i dostosuj wywołanie (np. klucz). Potwierdź w Task 3 Step 5 (typecheck) i wizualnie.
- recharts pierwszy raz użyty — `ResponsiveContainer` wymaga rodzica o ustalonej wysokości (jest: `height: 240`).
```
