# Raport identyfikowalności partii dla weterynarii — Plan wdrożenia (Faza 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeden wydruk na partię (goły / PP / PPP) dla inspekcji weterynaryjnej: typ partii, skład rodziców z kg, pełna trasa ćwiartka→wyrób, bilans masy.

**Architecture:** Backend dokłada czyste funkcje (`classify_batch_type`, `build_composition`) + serwis `batch_report_service` budujący raport na bazie istniejącego `traceability_service` (backward) wzbogaconego o kg-per-rodzic z `production_plan_lines.batch_allocation`. Nowy endpoint `GET /api/traceability/batch-report/{batch_no}`. Frontend: strona druku `BatchReportPage` (HTML, wzorzec jak `OrderPrintPage`/`HaccpReportPage`), wejście z `RecallPage`/„Przepływ partii”.

**Tech Stack:** Python 3 + pytest (czyste funkcje TDD; serwis/endpoint weryfikowane read-only na bazie testowej), React + react-router (strona druku, bez runnera testów → weryfikacja wizualna).

Spec: `docs/superpowers/specs/2026-06-06-identyfikowalnosc-partii-pp-ppp-raport-wet-design.md`
Gałąź: `feat/raport-partii-wet`

---

### Task 1: Czyste funkcje — typ partii i skład

**Files:**
- Modify: `backend/app/utils/batch_numbers.py`
- Create: `backend/app/services/batch_report_service.py`
- Test: `backend/tests/test_batch_report.py` (nowy)

- [ ] **Step 1: Utwórz failing test `backend/tests/test_batch_report.py`**

```python
from app.utils.batch_numbers import classify_batch_type
from app.services.batch_report_service import build_composition


def test_classify_single_batch():
    # 'ddmmrr 326' → pojedyncza
    assert classify_batch_type("060626 326") == "single"


def test_classify_mixer_combined():
    # PP = mieszalnik
    assert classify_batch_type("060626 PP1") == "mixer"


def test_classify_production_combined():
    # PPP = produkcja
    assert classify_batch_type("060626 PPP1") == "production"


def test_classify_bare_code_without_date():
    assert classify_batch_type("PPP3") == "production"
    assert classify_batch_type("PP3") == "mixer"
    assert classify_batch_type("326") == "single"


def test_build_composition_from_allocation():
    # allocation = {bno: {"kg":, "pieces":}} → lista rodziców z kg
    alloc = {"349": {"kg": 1300.0, "pieces": 26}, "PP1": {"kg": 200.0, "pieces": 4}}
    out = build_composition(["349", "PP1"], alloc)
    assert out == [
        {"batch_no": "349", "kg": 1300.0, "pieces": 26},
        {"batch_no": "PP1", "kg": 200.0, "pieces": 4},
    ]


def test_build_composition_missing_alloc_uses_zero():
    # brak alokacji dla partii → kg/pieces = None (nie zgadujemy)
    out = build_composition(["357", "358"], {})
    assert out == [
        {"batch_no": "357", "kg": None, "pieces": None},
        {"batch_no": "358", "kg": None, "pieces": None},
    ]
```

- [ ] **Step 2: Uruchom — ma NIE przejść**

Run: `cd backend && python3 -m pytest tests/test_batch_report.py -q`
Expected: ImportError (`classify_batch_type`, `build_composition` nie istnieją).

- [ ] **Step 3: Dodaj `classify_batch_type` w `backend/app/utils/batch_numbers.py`**

Po `is_production_combined` dodaj:

```python
def classify_batch_type(batch_no: Optional[str]) -> str:
    """Typ partii na podstawie numeru (akceptuje 'ddmmrr <wsad>' lub goły wsad):
    'production' (PPP), 'mixer' (PP), 'single' (pozostałe/goły numer)."""
    if not batch_no:
        return "single"
    token = batch_no.strip().split(" ")[-1]  # 'ddmmrr PPP1' -> 'PPP1'
    if is_production_combined(token):
        return "production"
    if is_combined(token):
        return "mixer"
    return "single"
```

- [ ] **Step 4: Utwórz `backend/app/services/batch_report_service.py` z `build_composition`**

```python
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
```

- [ ] **Step 5: Uruchom — ma przejść**

Run: `cd backend && python3 -m pytest tests/test_batch_report.py -q`
Expected: PASS (6 testów)

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/batch_numbers.py backend/app/services/batch_report_service.py backend/tests/test_batch_report.py
git commit -m "feat(raport): classify_batch_type + build_composition (czyste, TDD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Serwis raportu + endpoint

**Files:**
- Modify: `backend/app/services/batch_report_service.py`
- Modify: `backend/app/routes/traceability.py`
- Test: weryfikacja read-only na bazie (DB), brak harnessu unit dla DB.

- [ ] **Step 1: Dodaj `batch_report(batch_no)` w `batch_report_service.py`**

Dopisz na końcu pliku (importy u góry: dołóż `from app.db import query_one, query_all`, `from app.services import traceability_service as trace`, `from app.utils.batch_numbers import classify_batch_type`):

```python
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
                "SELECT batch_allocation FROM production_plan_lines pl "
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
        "trace": tr,                       # rawBatches/deboning/meatLots/mixingOrders/seasonedBatches/...
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
```

- [ ] **Step 2: Dodaj endpoint w `backend/app/routes/traceability.py`**

Po istniejącym `traceability` dodaj:

```python
@router.get("/api/traceability/batch-report/{batch_no:path}")
def batch_report(batch_no: str):
    from app.services import batch_report_service as brs
    return brs.batch_report(batch_no)
```

(`:path` — numer partii kebaba zawiera spacje/slashe, np. „060626 PPP1”.)

- [ ] **Step 3: Restartuj backend i zweryfikuj na realnej partii (read-only)**

```bash
sudo systemctl restart kebab-mes && sleep 2
# weź istniejącą partię łączoną z bazy:
set -a; . /opt/kebab/config/.env; set +a
B=$(psql "$DATABASE_URL" -At -c "SELECT batch_no FROM finished_goods WHERE batch_no LIKE '%PP%' LIMIT 1;")
curl -s "http://127.0.0.1:8010/api/traceability/batch-report/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$B")" | python3 -m json.tool | head -40
```
Expected: JSON z `batchType`, `composition` (rodzice + kg), `trace`, `seasonedBalance`.
(Uwaga: restart wymaga sudo — jeśli brak uprawnień, poproś użytkownika o `! sudo systemctl restart kebab-mes`.)

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/batch_report_service.py backend/app/routes/traceability.py
git commit -m "feat(raport): endpoint /api/traceability/batch-report/{batch_no}

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Strona druku BatchReportPage + routing + wejście

**Files:**
- Create: `src/pages/office/BatchReportPage.tsx`
- Modify: `src/lib/api.ts` (dodać `traceabilityApi.batchReport`)
- Modify: `src/App.tsx` (route druku)
- Modify: `src/pages/office/RecallPage.tsx` (przycisk „Raport partii”)

- [ ] **Step 1: Dodaj metodę API w `src/lib/api.ts` (w obiekcie `traceabilityApi`, ~1589)**

```typescript
  batchReport: (batchNo: string) =>
    get<any>(`/traceability/batch-report/${encodeURIComponent(batchNo)}`),
```

- [ ] **Step 2: Utwórz `src/pages/office/BatchReportPage.tsx`**

```tsx
import { useParams } from 'react-router-dom'
import { traceabilityApi } from '@/lib/apiClient'
import { useApi } from '@/hooks/useApi'
import { fmtKg, fmtDatePl } from '@/lib/utils'

const TYPE_LABEL: Record<string, string> = {
  single: 'Partia pojedyncza',
  mixer: 'Partia łączona w mieszalniku (PP)',
  production: 'Partia łączona na produkcji (PPP)',
}

export function BatchReportPage() {
  const { batchNo = '' } = useParams()
  const decoded = decodeURIComponent(batchNo)
  const res = useApi(() => traceabilityApi.batchReport(decoded), [decoded])
  const d: any = res.data || {}
  const tr: any = d.trace || {}

  return (
    <div className="bg-white p-6 text-sm text-slate-900">
      <div className="mb-4 border-b border-black pb-2">
        <div className="text-lg font-black">RAPORT IDENTYFIKOWALNOŚCI PARTII</div>
        <div className="font-mono text-base font-bold">{d.batchNo || decoded}</div>
        <div className="text-xs">{TYPE_LABEL[d.batchType] || '—'} · wydruk {fmtDatePl(new Date().toISOString())}</div>
      </div>

      {res.loading && <div>Ładowanie…</div>}

      {!res.loading && (
        <>
          <section className="mb-4">
            <div className="font-bold uppercase text-xs mb-1">Skład partii (z czego powstała)</div>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="border border-black p-1 text-left">Partia wsadowa</th>
                <th className="border border-black p-1 text-right">kg</th>
                <th className="border border-black p-1 text-right">szt.</th>
              </tr></thead>
              <tbody>
                {(d.composition || []).map((c: any, i: number) => (
                  <tr key={i}>
                    <td className="border border-black p-1 font-mono">{c.batch_no}</td>
                    <td className="border border-black p-1 text-right">{c.kg != null ? fmtKg(c.kg, 1) : '—'}</td>
                    <td className="border border-black p-1 text-right">{c.pieces != null ? c.pieces : '—'}</td>
                  </tr>
                ))}
                {(d.composition || []).length === 0 && (
                  <tr><td colSpan={3} className="border border-black p-1 text-slate-500">Partia pojedyncza — bez łączenia.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="mb-4">
            <div className="font-bold uppercase text-xs mb-1">Trasa: ćwiartka → wyrób</div>
            <div className="text-xs space-y-1">
              <div><b>Ćwiartki:</b> {(tr.rawBatches || []).map((r: any) => `${r.internal_batch_no} (${r.supplier_name || ''}${r.slaughter_date ? ', ubój ' + fmtDatePl(r.slaughter_date) : ''})`).join('; ') || '—'}</div>
              <div><b>Rozbiór:</b> {(tr.deboning || []).map((x: any) => x.sessionNo || x.session_no).filter(Boolean).join('; ') || '—'}</div>
              <div><b>Masowanie:</b> {(tr.mixingOrders || []).map((m: any) => m.order_no).join('; ') || '—'}</div>
              <div><b>Mięso przyprawione:</b> {(tr.seasonedBatches || []).map((s: any) => s.batch_no).join('; ') || '—'}</div>
              <div><b>Wyrób gotowy:</b> {(tr.finishedGoods || []).map((f: any) => f.batch_no).join('; ') || '—'}</div>
            </div>
          </section>

          <section className="mb-4">
            <div className="font-bold uppercase text-xs mb-1">Bilans masy partii zamarynowanych</div>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="border border-black p-1 text-left">Partia</th>
                <th className="border border-black p-1 text-right">Wyprodukowano</th>
                <th className="border border-black p-1 text-right">Zużyto</th>
                <th className="border border-black p-1 text-right">Dostępne</th>
              </tr></thead>
              <tbody>
                {(d.seasonedBalance || []).map((b: any, i: number) => (
                  <tr key={i}>
                    <td className="border border-black p-1 font-mono">{b.batch_no}</td>
                    <td className="border border-black p-1 text-right">{fmtKg(Number(b.kg_produced || 0), 1)}</td>
                    <td className="border border-black p-1 text-right">{fmtKg(Number(b.kg_used || 0), 1)}</td>
                    <td className="border border-black p-1 text-right">{fmtKg(Number(b.kg_available || 0), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Dodaj import + route druku w `src/App.tsx`**

Import obok innych `*PrintPage` (~26):
```tsx
import { BatchReportPage } from '@/pages/office/BatchReportPage'
```
Route w bloku „Standalone print pages” (~82):
```tsx
<Route path="/office/partia/:batchNo/raport" element={<BatchReportPage />} />
```

- [ ] **Step 4: Dodaj przycisk „Raport partii” w `src/pages/office/RecallPage.tsx`**

Znajdź miejsce, gdzie wyświetlany jest numer partii (np. nagłówek wyniku recall) i dodaj link otwierający raport w nowej karcie:
```tsx
<a
  href={`/office/partia/${encodeURIComponent(batchNo)}/raport`}
  target="_blank" rel="noreferrer"
  className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
>Raport partii (PDF)</a>
```
(`batchNo` = zmienna z numerem partii w RecallPage; jeśli nazywa się inaczej, użyj istniejącej.)

- [ ] **Step 5: Build frontu — bez nowych błędów**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vite build 2>&1 | tail -5
# (opcjonalnie) tsc diff jak wcześniej: liczba błędów nie rośnie
```
Expected: build EXIT 0.

- [ ] **Step 6: Weryfikacja wizualna**

Otwórz w przeglądarce `http://<host>:8080/office/partia/<numer%20partii>/raport` dla partii PP/PPP z bazy.
Expected: nagłówek z typem (PP/PPP), tabela składu z kg, trasa, bilans masy.

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/BatchReportPage.tsx src/lib/api.ts src/App.tsx src/pages/office/RecallPage.tsx
git commit -m "feat(raport): strona druku BatchReportPage + route + wejście z Recall

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Po wdrożeniu

Deploy całości (Faza 1 + Faza 2) na web: backend (kopiowanie zmienionych plików +
restart `kebab-mes`) oraz dist (`vite build` + rsync do `/opt/kebab/app/dist`),
backup przed nadpisaniem, weryfikacja health 200. Następnie merge do `main` + push.
