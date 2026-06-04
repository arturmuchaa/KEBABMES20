# Etykiety Zebra (ZPL) + druk BrowserPrint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wgrać szablon ZPL z ZebraDesigner (`.prn` z placeholderami), podstawić dane sztuki na backendzie i wydrukować na drukarce Zebra przez Zebra BrowserPrint — osobnym przyciskiem „Drukuj Zebra".

**Architecture:** Reużycie `label_templates` z `kind='zpl'` (ZPL w kolumnie `zpl`). Backend renderuje gotowy ZPL (czyste, testowalne funkcje + endpoint). Front: cienki wrapper BrowserPrint (`src/lib/zebra.ts`), ekran druku `/etykiety/zebra`, upload `.prn` w konfiguracji szablonu, przycisk „Drukuj Zebra" przy linii planu.

**Tech Stack:** Backend FastAPI + psycopg, pytest. Frontend React+TS (Vite). Zebra BrowserPrint JS SDK (vendored w `public/`).

**Spec:** `docs/superpowers/specs/2026-06-04-etykiety-zebra-zpl-design.md`

---

## File Structure

**Backend:**
- `backend/app/services/zebra_labels_service.py` — nowy: `_zpl_escape`, `merge_zpl`, `unit_zpl_values` (czyste) + `render_zebra_labels` (DB).
- `backend/app/routes/labels_zebra.py` — nowy: `GET /api/labels/zebra/render`.
- `backend/app/main.py` — modyfikacja: rejestracja routera.
- `backend/tests/test_zebra_labels.py` — nowy: testy czystych funkcji.

**Frontend:**
- `src/lib/api.ts` — modyfikacja: `labelsZebraApi.render` + typ.
- `src/lib/zebra.ts` — nowy: wrapper BrowserPrint.
- `public/browserprint/README.md` — nowy: instrukcja wgrania plików SDK.
- `src/pages/office/ZebraPrintPage.tsx` — nowy: ekran druku Zebra.
- `src/App.tsx` — modyfikacja: trasa `/etykiety/zebra`.
- `src/pages/office/LabelTemplateSetupPage.tsx` — modyfikacja: typ szablonu + upload `.prn`.
- `src/pages/office/ProductionPlanningPage.tsx` — modyfikacja: przycisk „Drukuj Zebra".

---

## Task 1: Backend — czyste funkcje renderu ZPL (TDD)

**Files:**
- Create: `backend/app/services/zebra_labels_service.py`
- Test: `backend/tests/test_zebra_labels.py`

- [ ] **Step 1: Napisz failing testy**

Utwórz `backend/tests/test_zebra_labels.py`:

```python
from app.services.zebra_labels_service import _zpl_escape, merge_zpl, unit_zpl_values


def test_escape_removes_zpl_control_chars():
    assert _zpl_escape("a^b~c") == "a b c"
    assert _zpl_escape(None) == ""


def test_merge_replaces_known_and_strips_unknown():
    zpl = "^FD[[QR]]^FS ^FD[[PARTIA]]^FS ^FD[[NIEZNANY]]^FS"
    out = merge_zpl(zpl, {"QR": "U|abc", "PARTIA": "030626"})
    assert "U|abc" in out
    assert "030626" in out
    assert "[[" not in out  # nieznane usunięte


def test_merge_repeated_placeholder():
    out = merge_zpl("[[WAGA]]-[[WAGA]]", {"WAGA": "40"})
    assert out == "40-40"


def test_merge_escapes_values():
    out = merge_zpl("[[KLIENT]]", {"KLIENT": "Zag^ros"})
    assert "^" not in out  # znak sterujący ZPL usunięty z wartości
    assert "Zag ros" in out


def test_unit_zpl_values_core():
    unit = {"qr_code": "U|abc", "batch_no": "030626333",
            "produced_date": "2026-06-01", "weight_kg": 40,
            "client_name": "Zagros", "product_type_id": "P1"}
    recipe = {"name": "Kebab wołowy", "shelf_life_days": 365, "product_type_name": "Kebab"}
    v = unit_zpl_values(unit, recipe)
    assert v["QR"] == "U|abc"
    assert v["PARTIA"] == "030626333"
    assert v["DATA_PROD"] == "01.06.2026"
    assert v["DATA_MROZ"] == "01.06.2026"
    assert v["BEST_BEFORE"] == "01.06.2027"   # +365 dni
    assert v["KLIENT"] == "Zagros"
    assert v["RECEPTURA"] == "Kebab wołowy"
    assert v["PRODUKT"] == "Kebab"
    assert v["NETTO"] == v["WAGA"]
    assert v["WAGA"] in ("40", "40,0")


def test_unit_zpl_values_blank_date():
    v = unit_zpl_values({"qr_code": "U|x", "produced_date": ""}, {"shelf_life_days": 5})
    assert v["DATA_PROD"] == ""
    assert v["BEST_BEFORE"] == ""
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_zebra_labels.py -v`
Expected: ImportError.

- [ ] **Step 3: Implementacja (czyste funkcje)**

Utwórz `backend/app/services/zebra_labels_service.py`:

```python
"""Etykiety Zebra (ZPL) — render placeholderów na danych sztuk."""
import re
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import query_all, query_one
from app.utils.unit_codes import best_before

_PLACEHOLDER_RE = re.compile(r"\[\[[A-Z_]+\]\]")


def _zpl_escape(s) -> str:
    """Usuń znaki sterujące ZPL (^ ~) z wartości, by nie rozbiły komend."""
    return (str(s) if s is not None else "").replace("^", " ").replace("~", " ")


def merge_zpl(zpl: str, values: Dict[str, str]) -> str:
    """Podstaw [[KLUCZ]] → wartość (escaped); pozostałe [[...]] usuń."""
    out = zpl or ""
    for key, val in values.items():
        out = out.replace(f"[[{key}]]", _zpl_escape(val))
    return _PLACEHOLDER_RE.sub("", out)


def _fmt_date(iso) -> str:
    s = (iso or "")[:10]
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return ""
    return f"{s[8:10]}.{s[5:7]}.{s[0:4]}"


def _fmt_weight(kg) -> str:
    f = float(kg or 0)
    if f == int(f):
        return str(int(f))
    return f"{f:.1f}".replace(".", ",")


def unit_zpl_values(unit: Dict[str, Any], recipe: Dict[str, Any]) -> Dict[str, str]:
    """Słownik wartości placeholderów dla sztuki + receptury."""
    produced = (unit.get("produced_date") or "")
    shelf = int((recipe or {}).get("shelf_life_days") or 0)
    bb = best_before(produced, shelf) if produced else ""
    waga = _fmt_weight(unit.get("weight_kg"))
    return {
        "QR": unit.get("qr_code") or "",
        "PARTIA": unit.get("batch_no") or "",
        "DATA_PROD": _fmt_date(produced),
        "DATA_MROZ": _fmt_date(produced),
        "BEST_BEFORE": _fmt_date(bb),
        "WAGA": waga,
        "NETTO": waga,
        "KLIENT": unit.get("client_name") or "",
        "RECEPTURA": (recipe or {}).get("name") or "",
        "PRODUKT": (recipe or {}).get("product_type_name") or "",
    }
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_zebra_labels.py -v`
Expected: PASS (6 testów).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/zebra_labels_service.py backend/tests/test_zebra_labels.py && \
git commit -m "feat(zebra): czyste funkcje renderu ZPL (merge_zpl, unit_zpl_values) + testy"
```

---

## Task 2: Backend — render z DB + endpoint

**Files:**
- Modify: `backend/app/services/zebra_labels_service.py`
- Create: `backend/app/routes/labels_zebra.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: `render_zebra_labels` w serwisie**

Dopisz w `backend/app/services/zebra_labels_service.py`:

```python
def render_zebra_labels(plan_line_id: str, client_id: str, recipe_id: str) -> Dict[str, Any]:
    """Zwróć sklejony ZPL dla wszystkich sztuk linii planu (szablon kind='zpl')."""
    tpl = query_one(
        "SELECT kind, zpl FROM label_templates WHERE client_id=%s AND recipe_id=%s",
        (client_id, recipe_id),
    )
    if not tpl or (tpl.get("kind") != "zpl") or not (tpl.get("zpl") or "").strip():
        return {"ok": False, "reason": "Brak szablonu Zebra dla klient+receptura"}

    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,)) or {}
    units = query_all(
        """SELECT qr_code, batch_no, produced_date, weight_kg, client_name, product_type_id
           FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq""",
        (plan_line_id,),
    )
    if not units:
        return {"ok": False, "reason": "Brak sztuk do druku"}

    zpl_tpl = tpl["zpl"]
    blocks = [merge_zpl(zpl_tpl, unit_zpl_values(u, recipe)) for u in units]
    return {"ok": True, "zpl": "\n".join(blocks), "count": len(blocks)}
```

- [ ] **Step 2: Trasa**

Utwórz `backend/app/routes/labels_zebra.py`:

```python
"""Endpoint renderu etykiet Zebra (ZPL)."""
from fastapi import APIRouter, Query

from app.services import zebra_labels_service as svc

router = APIRouter(prefix="/api/labels/zebra", tags=["labels-zebra"])


@router.get("/render")
def render(plan_line_id: str = Query(...), client_id: str = Query(""), recipe_id: str = Query("")):
    return svc.render_zebra_labels(plan_line_id, client_id, recipe_id)
```

- [ ] **Step 3: Rejestracja w main.py**

W `backend/app/main.py` dodaj `labels_zebra,` w DWÓCH miejscach (krotka importu
`from app.routes import (...)` oraz krotka iterowana przez `include_router`), np. po
`label_templates,`. Read the file first to confirm both occurrences.

- [ ] **Step 4: Smoke**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.main; from app.routes.labels_zebra import router; print([r.path for r in router.routes])"`
Expected: `['/api/labels/zebra/render']`, brak błędu importu.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/zebra_labels_service.py backend/app/routes/labels_zebra.py backend/app/main.py && \
git commit -m "feat(zebra): render_zebra_labels + endpoint GET /api/labels/zebra/render"
```

---

## Task 3: Frontend — API `labelsZebraApi`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Typ + metoda**

W `src/lib/api.ts` dopisz:

```typescript
export interface ZebraRenderResult {
  ok: boolean
  reason?: string
  zpl?: string
  count?: number
}

export const labelsZebraApi = {
  render: (planLineId: string, clientId: string, recipeId: string) =>
    get<ZebraRenderResult>(
      `/labels/zebra/render?plan_line_id=${encodeURIComponent(planLineId)}` +
      `&client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}`),
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "labelsZebraApi|ZebraRenderResult" || echo "BRAK błędów zebra api"`
Expected: `BRAK błędów zebra api`.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/lib/api.ts && \
git commit -m "feat(zebra): labelsZebraApi.render"
```

---

## Task 4: Frontend — wrapper BrowserPrint

**Files:**
- Create: `src/lib/zebra.ts`
- Create: `public/browserprint/README.md`

- [ ] **Step 1: README z instrukcją SDK**

Utwórz `public/browserprint/README.md`:

```markdown
# Zebra BrowserPrint SDK

Umieść tu pliki z darmowego pakietu Zebra BrowserPrint (https://www.zebra.com/) :
- `BrowserPrint-3.1.250.min.js`
- `BrowserPrint-Zebra-1.0.5.min.js`

Aplikacja ładuje je z `/browserprint/...`. Bez nich druk Zebra pokaże komunikat
„BrowserPrint niedostępny". Wymagana też zainstalowana aplikacja Zebra BrowserPrint
na komputerze operatora.
```

- [ ] **Step 2: Wrapper**

Utwórz `src/lib/zebra.ts`:

```typescript
// Cienki wrapper na Zebra BrowserPrint (globalny obiekt z vendored JS w /public/browserprint).
declare global { interface Window { BrowserPrint?: any } }

let loadPromise: Promise<any> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Nie udało się wczytać ${src}`))
    document.head.appendChild(s)
  })
}

export async function loadBrowserPrint(): Promise<any> {
  if (window.BrowserPrint) return window.BrowserPrint
  if (!loadPromise) {
    loadPromise = (async () => {
      await loadScript('/browserprint/BrowserPrint-3.1.250.min.js')
      await loadScript('/browserprint/BrowserPrint-Zebra-1.0.5.min.js')
      if (!window.BrowserPrint) throw new Error('BrowserPrint niedostępny')
      return window.BrowserPrint
    })().catch(e => { loadPromise = null; throw e })
  }
  return loadPromise
}

export interface ZebraDevice { name: string; uid: string; send: (d: string, ok: () => void, err: (e: any) => void) => void }

export async function getDevices(): Promise<{ default: ZebraDevice | null; list: ZebraDevice[] }> {
  const BP = await loadBrowserPrint()
  const def = await new Promise<ZebraDevice | null>((res) =>
    BP.getDefaultDevice('printer', (d: ZebraDevice) => res(d || null), () => res(null)))
  const list = await new Promise<ZebraDevice[]>((res) =>
    BP.getLocalDevices((ds: ZebraDevice[]) => res(ds || []), () => res(def ? [def] : []), 'printer'))
  return { default: def, list: list.length ? list : (def ? [def] : []) }
}

export function sendZpl(device: ZebraDevice, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => device.send(zpl, () => resolve(), (e: any) => reject(e)))
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "lib/zebra" || echo "BRAK błędów zebra.ts"`
Expected: `BRAK błędów zebra.ts`.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/lib/zebra.ts public/browserprint/README.md && \
git commit -m "feat(zebra): wrapper BrowserPrint (loadBrowserPrint/getDevices/sendZpl) + README SDK"
```

---

## Task 5: Frontend — ekran druku Zebra + trasa

**Files:**
- Create: `src/pages/office/ZebraPrintPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Ekran**

Utwórz `src/pages/office/ZebraPrintPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { labelsZebraApi, type ZebraRenderResult } from '@/lib/api'
import { getDevices, sendZpl, type ZebraDevice } from '@/lib/zebra'

const TEST_ZPL = '^XA^FO50,50^A0N,40,40^FDTest Zebra^FS^XZ'

export function ZebraPrintPage() {
  const [params] = useSearchParams()
  const planLineId = params.get('planLineId') || ''
  const clientId = params.get('clientId') || ''
  const recipeId = params.get('recipeId') || ''

  const [render, setRender] = useState<ZebraRenderResult | null>(null)
  const [devices, setDevices] = useState<ZebraDevice[]>([])
  const [deviceUid, setDeviceUid] = useState('')
  const [sdkError, setSdkError] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    labelsZebraApi.render(planLineId, clientId, recipeId).then(setRender).catch(() =>
      setRender({ ok: false, reason: 'Błąd pobierania ZPL' }))
  }, [planLineId, clientId, recipeId])

  useEffect(() => {
    getDevices()
      .then(({ default: def, list }) => { setDevices(list); setDeviceUid(def?.uid || list[0]?.uid || '') })
      .catch((e) => setSdkError(e instanceof Error ? e.message : 'BrowserPrint niedostępny'))
  }, [])

  const device = devices.find(d => d.uid === deviceUid) || null

  async function print(zpl: string, label: string) {
    if (!device) { setMsg({ ok: false, text: 'Nie wybrano drukarki Zebra' }); return }
    setBusy(true)
    try { await sendZpl(device, zpl); setMsg({ ok: true, text: `${label} — wysłano` }) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Błąd druku' }) }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-xl space-y-4">
        <Link to="/office/szablony-etykiet" className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Szablony etykiet
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-black"><Printer size={20} /> Druk Zebra</h1>

        {sdkError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={18} /> {sdkError}. Zainstaluj aplikację Zebra BrowserPrint i wgraj pliki SDK do <code>public/browserprint/</code>.
          </div>
        )}

        {render && !render.ok && (
          <div className="rounded-lg border border-red-200 bg-white p-4 text-sm">
            <div className="font-bold text-red-700">{render.reason}</div>
            <Link to={`/etykiety/szablon?clientId=${encodeURIComponent(clientId)}&recipeId=${encodeURIComponent(recipeId)}`}
              className="mt-2 inline-block text-blue-700 underline">Konfiguruj szablon Zebra</Link>
          </div>
        )}

        {!sdkError && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Drukarka</label>
            <select value={deviceUid} onChange={e => setDeviceUid(e.target.value)} className="w-full rounded-lg border-2 border-slate-300 px-3 py-2 text-base">
              {devices.length === 0 && <option value="">— brak drukarek —</option>}
              {devices.map(d => <option key={d.uid} value={d.uid}>{d.name}</option>)}
            </select>

            <div className="flex gap-2">
              <button disabled={busy || !render?.ok} onClick={() => render?.zpl && print(render.zpl, `Druk ${render.count} szt`)}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                Drukuj {render?.ok ? `(${render.count})` : ''}
              </button>
              <button disabled={busy} onClick={() => print(TEST_ZPL, 'Test druku')}
                className="rounded-lg bg-slate-200 px-4 py-3 text-base font-semibold text-slate-700">
                Test druku
              </button>
            </div>
          </div>
        )}

        {msg && (
          <div className={`flex items-center gap-2 rounded-lg border-2 p-3 text-sm font-semibold ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
            {msg.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {msg.text}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Trasa w App.tsx**

W `src/App.tsx` dodaj import `import { ZebraPrintPage } from '@/pages/office/ZebraPrintPage'`
(obok importu `LabelPrintPage`) oraz trasę po `/etykiety/druk`:

```tsx
<Route path="/etykiety/zebra"   element={<ZebraPrintPage />} />
```

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "ZebraPrintPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów ZebraPrintPage; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/ZebraPrintPage.tsx src/App.tsx && \
git commit -m "feat(zebra): ekran druku /etykiety/zebra (wybór drukarki, Drukuj, Test)"
```

---

## Task 6: Frontend — typ szablonu „Zebra (ZPL)" + upload `.prn`

**Files:**
- Modify: `src/pages/office/LabelTemplateSetupPage.tsx`

Kontekst: komponent ma stany szablonu i `handleSave` (zapisuje przez `labelTemplatesApi.save`).
Szablon ma już pole `kind` (mapowane w api). Dodajemy przełącznik typu i — dla `zpl` —
upload pliku tekstowego do stanu `zpl`, a `handleSave` ma wysłać `kind` i `zpl`.

- [ ] **Step 1: Stan typu + ZPL**

Na początku komponentu (przy innych `useState`) dodaj:

```tsx
const [kind, setKind] = useState<'overlay' | 'zpl'>('overlay')
const [zpl, setZpl] = useState('')
```
Jeśli komponent ładuje istniejący szablon (np. w `useEffect` po pobraniu), ustaw z niego:
`setKind(tpl.kind === 'zpl' ? 'zpl' : 'overlay')` i `setZpl(tpl.zpl || '')`.

- [ ] **Step 2: UI przełącznika + uploadu**

Tuż pod sekcją wyboru klienta+receptury (po karcie z `Select` klienta/receptury) wstaw:

```tsx
<Card>
  <CardContent className="pt-5 space-y-3">
    <Label className="text-xs">Typ etykiety</Label>
    <div className="flex gap-2">
      <Button type="button" variant={kind === 'overlay' ? 'default' : 'outline'} size="sm" onClick={() => setKind('overlay')}>Nakładka PDF</Button>
      <Button type="button" variant={kind === 'zpl' ? 'default' : 'outline'} size="sm" onClick={() => setKind('zpl')}>Zebra (ZPL)</Button>
    </div>

    {kind === 'zpl' && (
      <div className="space-y-2">
        <input type="file" accept=".prn,.zpl,.txt" onChange={async (e) => {
          const f = e.target.files?.[0]; if (f) setZpl(await f.text())
        }} className="block text-sm" />
        <textarea value={zpl} onChange={e => setZpl(e.target.value)} rows={8}
          placeholder="Wklej lub wgraj ZPL z ZebraDesigner (.prn)…"
          className="w-full rounded-lg border-2 border-slate-300 p-2 font-mono text-xs" />
        <div className="text-[11px] text-slate-500">
          Placeholdery: <code>[[QR]] [[PARTIA]] [[DATA_PROD]] [[DATA_MROZ]] [[BEST_BEFORE]] [[WAGA]] [[NETTO]] [[KLIENT]] [[RECEPTURA]] [[PRODUKT]]</code>
        </div>
      </div>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 3: Zapis `kind`+`zpl`**

W `handleSave`, w obiekcie przekazywanym do `labelTemplatesApi.save({...})`, dodaj pola:
```tsx
kind,
zpl,
```
(zachowaj istniejące pola overlay; dla `kind='zpl'` pozostają domyślne/puste — backend i tak
ich nie użyje przy druku Zebra).

- [ ] **Step 4: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "LabelTemplateSetupPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów; build OK.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/LabelTemplateSetupPage.tsx && \
git commit -m "feat(zebra): typ szablonu Zebra (ZPL) + upload .prn w konfiguracji etykiety"
```

---

## Task 7: Frontend — przycisk „Drukuj Zebra" przy linii planu

**Files:**
- Modify: `src/pages/office/ProductionPlanningPage.tsx`

Kontekst: istnieje `handleGenerateLabels(planId, line)` → generuje sztuki i
`navigate('/etykiety/druk?planLineId=&clientId=&recipeId=')`. Dodajemy bliźniaczą akcję Zebra.

- [ ] **Step 1: Handler Zebra**

Obok `handleGenerateLabels` dodaj:

```tsx
  async function handleGenerateZebra(_planId: string, line: ProductionPlanLine) {
    setGeneratingLine(line.id)
    try { await finishedUnitsApi.generateFromPlanLine(line.id) } catch { /* sztuki mogą już istnieć */ }
    setGeneratingLine(null)
    const params = new URLSearchParams({ planLineId: line.id })
    if (line.clientName) params.set('clientId', line.clientName)
    if (line.recipeId)   params.set('recipeId', line.recipeId)
    navigate(`/etykiety/zebra?${params.toString()}`)
  }
```

- [ ] **Step 2: Przycisk obok „Drukuj etykiety"**

Znajdź przycisk wywołujący `handleGenerateLabels(...)` (druk PDF) i tuż obok dodaj
analogiczny przycisk Zebra (dopasuj klasy/wariant do istniejącego):

```tsx
<Button size="sm" variant="outline" disabled={generatingLine === line.id}
  onClick={() => handleGenerateZebra(plan.id, line)}>
  Drukuj Zebra
</Button>
```
(`plan.id`/`line` zgodnie z kontekstem istniejącego przycisku PDF.)

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "ProductionPlanningPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/ProductionPlanningPage.tsx && \
git commit -m "feat(zebra): przycisk Drukuj Zebra przy linii planu"
```

---

## Task 8: Pełne testy + build + e2e

- [ ] **Step 1: Pełny pytest**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q`
Expected: wszystko zielone (w tym `test_zebra_labels.py`).

- [ ] **Step 2: Build frontu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -2`
Expected: build OK.

- [ ] **Step 3: Ręczny e2e (sprzęt + SDK)**

1. Wgraj pliki Zebra BrowserPrint SDK do `public/browserprint/` i zainstaluj aplikację Zebra
   BrowserPrint na PC operatora.
2. Biuro → Szablony etykiet → wybierz klient+receptura → Typ: Zebra (ZPL) → wgraj `.prn`
   z ZebraDesigner zawierający `[[QR]]`, `[[PARTIA]]`, `[[WAGA]]` → Zapisz.
3. Planowanie produkcji → linia → „Drukuj Zebra" → ekran `/etykiety/zebra`.
4. „Test druku" → drukuje testową etykietę. „Drukuj (N)" → drukuje N etykiet z danymi sztuk.
5. Sprawdź na wydruku: QR skanuje się, partia/waga/daty poprawne.
6. Bez SDK → komunikat „BrowserPrint niedostępny". Brak szablonu zpl → „Brak szablonu Zebra…".

Expected: zgodne ze specem.

---

## Self-Review (autora planu)

- **Pokrycie specu:** model kind='zpl' (T2/T6); placeholdery + merge + wartości (T1);
  render+endpoint (T2); API front (T3); BrowserPrint wrapper + SDK (T4); ekran druku (T5);
  upload szablonu (T6); przycisk Drukuj Zebra (T7); testy+e2e (T8). ✅
- **Spójność typów:** `merge_zpl`/`unit_zpl_values` zdef. w T1, użyte w T2. `render_zebra_labels`
  zwraca `{ok, reason?, zpl?, count?}` = `ZebraRenderResult` (T3) = użycie w `ZebraPrintPage` (T5).
  `getDevices/sendZpl/ZebraDevice` z T4 użyte w T5. ✅
- **Placeholdery:** brak — pełny kod/komendy. „dopasuj klasy/wariant" w T7 to wskazana
  weryfikacja istniejącego przycisku, nie luka logiczna. ✅
