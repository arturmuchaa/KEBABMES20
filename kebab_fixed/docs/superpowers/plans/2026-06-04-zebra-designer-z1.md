# Zebra Designer Z-Design-1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizualny edytor etykiet Zebra w MES, który generuje natywny (wektorowy) ZPL z podstawialnymi danymi sztuki i drukuje przez Zebra BrowserPrint.

**Architecture:** Tabela `zebra_label_designs` (model elementów JSON, mm, DPI wybierane). Backend generuje ZPL z modelu (czysta, testowalna funkcja `design_to_zpl`) + merge danych sztuki. Front: edytor WYSIWYG (canvas, drag/resize, właściwości) + druk przez istniejący wrapper `src/lib/zebra.ts`.

**Tech Stack:** Backend FastAPI + psycopg, pytest. Frontend React+TS (Vite). Zebra BrowserPrint.

**Spec:** `docs/superpowers/specs/2026-06-04-zebra-designer-z1-design.md`

---

## File Structure

**Backend:**
- `backend/app/migrations.py` — modyfikacja: tabela `zebra_label_designs`.
- `backend/app/services/zebra_designer_service.py` — nowy: `_mm_to_dots`, `_merge`, `design_to_zpl` (czyste) + `get_design`, `save_design`, `render_units`, `render_sample`.
- `backend/app/models/zebra_designs.py` — nowy: DTO zapisu.
- `backend/app/routes/zebra_designer.py` — nowy: trasy `/api/zebra-designs`.
- `backend/app/main.py` — modyfikacja: rejestracja routera.
- `backend/tests/test_zebra_designer.py` — nowy: testy czystych funkcji.

**Frontend:**
- `src/lib/api.ts` — modyfikacja: `zebraDesignsApi` + typy.
- `src/pages/office/ZebraDesignerPage.tsx` — nowy: edytor wizualny.
- `src/App.tsx` — modyfikacja: trasa `/etykiety/zebra-designer`.
- `src/pages/office/LabelTemplatesPage.tsx` — modyfikacja: przycisk „Projektant Zebra".

---

## Task 1: Migracja `zebra_label_designs`

**Files:** Modify: `backend/app/migrations.py`

- [ ] **Step 1: Dodaj migracje**

W `backend/app/migrations.py`, po wpisach `dispatches` (po indeksie `idx_finished_units_dispatch`),
dopisz:

```python
    """CREATE TABLE IF NOT EXISTS zebra_label_designs (
        id          TEXT PRIMARY KEY,
        recipe_id   TEXT NOT NULL DEFAULT '',
        size_key    TEXT NOT NULL DEFAULT '',
        width_mm    NUMERIC NOT NULL DEFAULT 100,
        height_mm   NUMERIC NOT NULL DEFAULT 150,
        dpi         INTEGER NOT NULL DEFAULT 203,
        elements    JSONB NOT NULL DEFAULT '[]',
        updated_at  TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_zebra_designs_recipe_size ON zebra_label_designs(recipe_id, size_key)",
    "CREATE INDEX IF NOT EXISTS idx_zebra_designs_recipe ON zebra_label_designs(recipe_id)",
```

- [ ] **Step 2: Weryfikacja**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.migrations"`
Expected: brak błędu.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/migrations.py && \
git commit -m "feat(zebra-designer): tabela zebra_label_designs"
```

---

## Task 2: Backend — czyste funkcje generatora ZPL (TDD)

**Files:**
- Create: `backend/app/services/zebra_designer_service.py`
- Test: `backend/tests/test_zebra_designer.py`

- [ ] **Step 1: Napisz failing testy**

Utwórz `backend/tests/test_zebra_designer.py`:

```python
from app.services.zebra_designer_service import _mm_to_dots, _merge, design_to_zpl


def test_mm_to_dots():
    assert _mm_to_dots(25.4, 203) == 203
    assert _mm_to_dots(10, 300) == 118
    assert _mm_to_dots(0, 203) == 0


def test_merge_replaces_and_strips():
    assert _merge("[[WAGA]] kg", {"WAGA": "15"}) == "15 kg"
    assert _merge("x[[NIEZNANY]]y", {}) == "xy"


def test_merge_escapes_control():
    assert _merge("[[KLIENT]]", {"KLIENT": "A^B~C"}) == "A B C"


def test_design_to_zpl_header_footer():
    z = design_to_zpl({"width_mm": 100, "height_mm": 150, "dpi": 203, "elements": []}, {})
    assert z.startswith("^XA")
    assert "^CI28" in z
    assert "^PW799" in z   # 100mm @203dpi
    assert "^LL1199" in z  # 150mm @203dpi
    assert z.rstrip().endswith("^XZ")


def test_design_to_zpl_text():
    d = {"width_mm": 100, "height_mm": 150, "dpi": 203, "elements": [
        {"id": "1", "type": "text", "x": 10, "y": 10, "w": 80, "fontMm": 4, "align": "C", "value": "Waga [[WAGA]]"}]}
    z = design_to_zpl(d, {"WAGA": "15"})
    assert "^A0N," in z and "^FB" in z and ",C," in z
    assert "^FDWaga 15^FS" in z


def test_design_to_zpl_qr_and_box():
    d = {"width_mm": 100, "height_mm": 150, "dpi": 203, "elements": [
        {"id": "q", "type": "qr", "x": 5, "y": 5, "mag": 4, "value": "[[QR]]"},
        {"id": "b", "type": "box", "x": 0, "y": 0, "w": 50, "h": 20, "thickMm": 0.5}]}
    z = design_to_zpl(d, {"QR": "U|abc"})
    assert "^BQN,2,4^FDLA,U|abc^FS" in z
    assert "^GB" in z
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_zebra_designer.py -v`
Expected: ImportError.

- [ ] **Step 3: Implementacja**

Utwórz `backend/app/services/zebra_designer_service.py`:

```python
"""Wizualny projektant etykiet Zebra → natywny ZPL."""
import re
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute_returning, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.ids import cuid
from app.services.zebra_labels_service import _zpl_escape, unit_zpl_values

logger = get_logger(__name__)

_TOKEN_RE = re.compile(r"\[\[[A-Z_]+\]\]")

_SAMPLE = {
    "QR": "U|sample", "PARTIA": "030626333", "DATA_PROD": "01.06.2026",
    "DATA_MROZ": "01.06.2026", "BEST_BEFORE": "01.06.2027", "WAGA": "15",
    "NETTO": "15", "KLIENT": "Zagros", "RECEPTURA": "Kebab", "PRODUKT": "Kebab",
}


def _mm_to_dots(mm, dpi) -> int:
    return round(float(mm or 0) / 25.4 * float(dpi or 203))


def _merge(value: str, values: Dict[str, str]) -> str:
    out = value or ""
    for k, v in (values or {}).items():
        out = out.replace(f"[[{k}]]", _zpl_escape(v))
    return _TOKEN_RE.sub("", out)


def design_to_zpl(design: Dict[str, Any], values: Dict[str, str]) -> str:
    dpi = int(design.get("dpi") or 203)
    w = _mm_to_dots(design.get("width_mm") or 100, dpi)
    h = _mm_to_dots(design.get("height_mm") or 150, dpi)
    out: List[str] = ["^XA", "^CI28", f"^PW{w}", f"^LL{h}", "^LS0"]
    for el in (design.get("elements") or []):
        t = el.get("type")
        x = _mm_to_dots(el.get("x") or 0, dpi)
        y = _mm_to_dots(el.get("y") or 0, dpi)
        if t == "text":
            fw = _mm_to_dots(el.get("fontMm") or 3, dpi)
            bw = _mm_to_dots(el.get("w") or 50, dpi)
            just = (el.get("align") or "L").upper()
            if just not in ("L", "C", "R"):
                just = "L"
            txt = _merge(el.get("value") or "", values)
            out.append(f"^FO{x},{y}^A0N,{fw},{fw}^FB{bw},50,0,{just},0^FD{txt}^FS")
        elif t == "qr":
            mag = int(el.get("mag") or 4)
            data = _merge(el.get("value") or "", values)
            out.append(f"^FO{x},{y}^BQN,2,{mag}^FDLA,{data}^FS")
        elif t == "box":
            bw = _mm_to_dots(el.get("w") or 10, dpi)
            bh = _mm_to_dots(el.get("h") or 10, dpi)
            th = max(1, _mm_to_dots(el.get("thickMm") or 0.3, dpi))
            out.append(f"^FO{x},{y}^GB{bw},{bh},{th}^FS")
    out.append("^XZ")
    return "\n".join(out)


def _row_to_design(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "recipeId": row.get("recipe_id") or "",
        "sizeKey": row.get("size_key") or "",
        "widthMm": float(row.get("width_mm") or 100),
        "heightMm": float(row.get("height_mm") or 150),
        "dpi": int(row.get("dpi") or 203),
        "elements": row.get("elements") or [],
    }


def get_design(recipe_id: str, size_key: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM zebra_label_designs WHERE recipe_id=%s AND size_key=%s",
        (recipe_id, size_key),
    )
    if not row:
        return {"exists": False, "design": None}
    return {"exists": True, "design": _row_to_design(row)}


def save_design(dto: Dict[str, Any]) -> Dict[str, Any]:
    import json
    with transaction() as conn:
        cx_execute_returning(
            conn,
            """
            INSERT INTO zebra_label_designs
                (id, recipe_id, size_key, width_mm, height_mm, dpi, elements, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb, now())
            ON CONFLICT (recipe_id, size_key) DO UPDATE SET
                width_mm = EXCLUDED.width_mm, height_mm = EXCLUDED.height_mm,
                dpi = EXCLUDED.dpi, elements = EXCLUDED.elements, updated_at = now()
            RETURNING id
            """,
            (cuid(), dto.get("recipe_id") or "", dto.get("size_key") or "",
             float(dto.get("width_mm") or 100), float(dto.get("height_mm") or 150),
             int(dto.get("dpi") or 203), json.dumps(dto.get("elements") or [])),
        )
    return {"ok": True}


def _design_dict_from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "width_mm": float(row.get("width_mm") or 100),
        "height_mm": float(row.get("height_mm") or 150),
        "dpi": int(row.get("dpi") or 203),
        "elements": row.get("elements") or [],
    }


def render_units(recipe_id: str, size_key: str, plan_line_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT * FROM zebra_label_designs WHERE recipe_id=%s AND size_key=%s",
        (recipe_id, size_key),
    )
    if not row:
        return {"ok": False, "reason": "Brak projektu etykiety Zebra"}
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (recipe_id,)) or {}
    units = query_all(
        """SELECT qr_code, batch_no, produced_date, weight_kg, client_name, product_type_id
           FROM finished_units WHERE plan_line_id=%s ORDER BY qr_seq""",
        (plan_line_id,),
    )
    if not units:
        return {"ok": False, "reason": "Brak sztuk do druku"}
    design = _design_dict_from_row(row)
    blocks = [design_to_zpl(design, unit_zpl_values(u, recipe)) for u in units]
    return {"ok": True, "zpl": "\n".join(blocks), "count": len(blocks)}


def render_sample(design: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "zpl": design_to_zpl(design, _SAMPLE), "count": 1}
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_zebra_designer.py -v`
Expected: PASS (6 testów).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/zebra_designer_service.py backend/tests/test_zebra_designer.py && \
git commit -m "feat(zebra-designer): generator ZPL z modelu elementow + serwis + testy"
```

---

## Task 3: Backend — DTO + trasy + rejestracja

**Files:**
- Create: `backend/app/models/zebra_designs.py`
- Create: `backend/app/routes/zebra_designer.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: DTO**

Utwórz `backend/app/models/zebra_designs.py`:

```python
"""DTO projektanta etykiet Zebra."""
from typing import Any, List

from pydantic import BaseModel


class SaveDesignRequest(BaseModel):
    recipe_id: str = ""
    size_key: str = ""
    width_mm: float = 100
    height_mm: float = 150
    dpi: int = 203
    elements: List[Any] = []


class RenderSampleRequest(BaseModel):
    width_mm: float = 100
    height_mm: float = 150
    dpi: int = 203
    elements: List[Any] = []
```

- [ ] **Step 2: Trasy**

Utwórz `backend/app/routes/zebra_designer.py`:

```python
"""Endpointy projektanta etykiet Zebra."""
from fastapi import APIRouter, Query

from app.models.zebra_designs import RenderSampleRequest, SaveDesignRequest
from app.services import zebra_designer_service as svc

router = APIRouter(prefix="/api/zebra-designs", tags=["zebra-designs"])


@router.get("")
def get(recipe_id: str = Query(""), size_key: str = Query("")):
    return svc.get_design(recipe_id, size_key)


@router.put("")
def save(dto: SaveDesignRequest):
    return svc.save_design(dto.model_dump())


@router.get("/render")
def render(recipe_id: str = Query(""), size_key: str = Query(""), plan_line_id: str = Query("")):
    return svc.render_units(recipe_id, size_key, plan_line_id)


@router.post("/render-sample")
def render_sample(dto: RenderSampleRequest):
    return svc.render_sample(dto.model_dump())
```

- [ ] **Step 3: Rejestracja w main.py**

W `backend/app/main.py` dodaj `zebra_designer,` w DWÓCH miejscach (krotka importu i krotka
iterowana przez `include_router`), po `labels_zebra,`. Read the file first to confirm both occurrences.

- [ ] **Step 4: Smoke**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.main; from app.routes.zebra_designer import router; print(sorted(r.path for r in router.routes))"`
Expected: zawiera `/api/zebra-designs`, `/api/zebra-designs/render`, `/api/zebra-designs/render-sample`.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/models/zebra_designs.py backend/app/routes/zebra_designer.py backend/app/main.py && \
git commit -m "feat(zebra-designer): DTO + trasy /api/zebra-designs + rejestracja"
```

---

## Task 4: Frontend — API `zebraDesignsApi`

**Files:** Modify: `src/lib/api.ts`

- [ ] **Step 1: Typy + metody**

W `src/lib/api.ts` dopisz (przy innych api eksportach):

```typescript
export interface ZebraElement {
  id: string
  type: 'text' | 'qr' | 'box'
  x: number; y: number
  w?: number; h?: number
  fontMm?: number; align?: 'L' | 'C' | 'R'
  mag?: number; thickMm?: number
  value?: string
}

export interface ZebraDesign {
  recipeId: string; sizeKey: string
  widthMm: number; heightMm: number; dpi: number
  elements: ZebraElement[]
}

export const zebraDesignsApi = {
  get: (recipeId: string, sizeKey: string) =>
    get<{ exists: boolean; design: ZebraDesign | null }>(
      `/zebra-designs?recipe_id=${encodeURIComponent(recipeId)}&size_key=${encodeURIComponent(sizeKey)}`),
  save: (d: ZebraDesign) =>
    put<{ ok: boolean }>('/zebra-designs', {
      recipe_id: d.recipeId, size_key: d.sizeKey,
      width_mm: d.widthMm, height_mm: d.heightMm, dpi: d.dpi, elements: d.elements,
    }),
  render: (recipeId: string, sizeKey: string, planLineId: string) =>
    get<{ ok: boolean; reason?: string; zpl?: string; count?: number }>(
      `/zebra-designs/render?recipe_id=${encodeURIComponent(recipeId)}&size_key=${encodeURIComponent(sizeKey)}&plan_line_id=${encodeURIComponent(planLineId)}`),
  renderSample: (d: ZebraDesign) =>
    post<{ ok: boolean; zpl?: string; count?: number }>('/zebra-designs/render-sample', {
      width_mm: d.widthMm, height_mm: d.heightMm, dpi: d.dpi, elements: d.elements,
    }),
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "zebraDesignsApi|ZebraElement|ZebraDesign" || echo "BRAK błędów"`
Expected: `BRAK błędów`.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/lib/api.ts && \
git commit -m "feat(zebra-designer): zebraDesignsApi + typy"
```

---

## Task 5: Frontend — edytor wizualny `ZebraDesignerPage`

**Files:**
- Create: `src/pages/office/ZebraDesignerPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Komponent edytora**

Utwórz `src/pages/office/ZebraDesignerPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Type, QrCode, Square, Save, Printer, Trash2 } from 'lucide-react'
import { zebraDesignsApi, type ZebraDesign, type ZebraElement } from '@/lib/api'
import { getDevices, sendZpl, type ZebraDevice } from '@/lib/zebra'

const SCALE = 3 // px per mm na canvasie
const SIZES: Record<string, { w: number; h: number }> = {
  '100x150': { w: 100, h: 150 },
  '100x300': { w: 100, h: 300 },
}
const BIND = ['', '[[WAGA]]', '[[PARTIA]]', '[[DATA_PROD]]', '[[DATA_MROZ]]', '[[BEST_BEFORE]]', '[[KLIENT]]', '[[QR]]']

function uid() { return Math.random().toString(36).slice(2, 9) }

export function ZebraDesignerPage() {
  const [params] = useSearchParams()
  const recipeId = params.get('recipeId') || ''
  const [sizeKey, setSizeKey] = useState('100x150')
  const [dpi, setDpi] = useState(203)
  const [elements, setElements] = useState<ZebraElement[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [devices, setDevices] = useState<ZebraDevice[]>([])
  const [deviceUid, setDeviceUid] = useState('')
  const [msg, setMsg] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  const size = SIZES[sizeKey] || SIZES['100x150']

  useEffect(() => {
    zebraDesignsApi.get(recipeId, sizeKey).then(r => {
      if (r.exists && r.design) { setElements(r.design.elements || []); setDpi(r.design.dpi || 203) }
      else setElements([])
      setSel(null)
    }).catch(() => setElements([]))
  }, [recipeId, sizeKey])

  useEffect(() => {
    getDevices().then(({ default: d, list }) => { setDevices(list); setDeviceUid(d?.uid || list[0]?.uid || '') }).catch(() => {})
  }, [])

  function addEl(type: ZebraElement['type']) {
    const base: ZebraElement = type === 'text'
      ? { id: uid(), type, x: 5, y: 5, w: 60, fontMm: 4, align: 'L', value: 'Tekst' }
      : type === 'qr'
        ? { id: uid(), type, x: 5, y: 5, mag: 5, value: '[[QR]]' }
        : { id: uid(), type, x: 5, y: 5, w: 40, h: 15, thickMm: 0.4 }
    setElements(e => [...e, base]); setSel(base.id)
  }

  function update(id: string, patch: Partial<ZebraElement>) {
    setElements(e => e.map(el => el.id === id ? { ...el, ...patch } : el))
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation(); setSel(id)
    const el = elements.find(x => x.id === id); if (!el) return
    const rect = canvasRef.current!.getBoundingClientRect()
    drag.current = { id, dx: e.clientX - rect.left - el.x * SCALE, dy: e.clientY - rect.top - el.y * SCALE }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.max(0, Math.round((e.clientX - rect.left - drag.current.dx) / SCALE))
    const y = Math.max(0, Math.round((e.clientY - rect.top - drag.current.dy) / SCALE))
    update(drag.current.id, { x, y })
  }
  function onPointerUp() { drag.current = null }

  async function save() {
    const d: ZebraDesign = { recipeId, sizeKey, widthMm: size.w, heightMm: size.h, dpi, elements }
    try { await zebraDesignsApi.save(d); setMsg('Zapisano') } catch (e) { setMsg(e instanceof Error ? e.message : 'Błąd zapisu') }
  }

  async function testPrint() {
    const d: ZebraDesign = { recipeId, sizeKey, widthMm: size.w, heightMm: size.h, dpi, elements }
    const dev = devices.find(x => x.uid === deviceUid)
    if (!dev) { setMsg('Brak drukarki Zebra (BrowserPrint)'); return }
    try { const r = await zebraDesignsApi.renderSample(d); if (r.zpl) { await sendZpl(dev, r.zpl); setMsg('Wysłano test') } }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Błąd druku') }
  }

  const selEl = elements.find(e => e.id === sel) || null

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <Link to="/office/szablony-etykiet" className="flex items-center gap-1 text-sm font-semibold text-slate-600"><ArrowLeft size={16} /> Wstecz</Link>
        <span className="mx-2 text-sm font-bold">Projektant Zebra</span>
        <select value={sizeKey} onChange={e => setSizeKey(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="100x150">100×150 mm</option>
          <option value="100x300">100×300 mm</option>
        </select>
        <select value={dpi} onChange={e => setDpi(Number(e.target.value))} className="rounded border px-2 py-1 text-sm">
          <option value={203}>203 dpi</option>
          <option value={300}>300 dpi</option>
        </select>
        <button onClick={() => addEl('text')} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm"><Type size={14} /> Tekst</button>
        <button onClick={() => addEl('qr')} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm"><QrCode size={14} /> QR</button>
        <button onClick={() => addEl('box')} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm"><Square size={14} /> Ramka</button>
        <button onClick={save} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white"><Save size={14} /> Zapisz</button>
        <select value={deviceUid} onChange={e => setDeviceUid(e.target.value)} className="rounded border px-2 py-1 text-sm">
          {devices.length === 0 && <option value="">— brak drukarki —</option>}
          {devices.map(d => <option key={d.uid} value={d.uid}>{d.name}</option>)}
        </select>
        <button onClick={testPrint} className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white"><Printer size={14} /> Test druku</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>

      <div className="flex gap-4 p-4">
        {/* Canvas */}
        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={() => setSel(null)}
          className="relative shrink-0 border border-slate-400 bg-white shadow"
          style={{ width: size.w * SCALE, height: size.h * SCALE }}
        >
          {elements.map(el => (
            <div
              key={el.id}
              onPointerDown={e => onPointerDown(e, el.id)}
              className={`absolute cursor-move ${sel === el.id ? 'outline outline-2 outline-blue-500' : ''}`}
              style={{ left: el.x * SCALE, top: el.y * SCALE }}
            >
              {el.type === 'text' && (
                <div style={{ width: (el.w || 60) * SCALE, fontSize: (el.fontMm || 4) * SCALE, lineHeight: 1.05,
                  textAlign: el.align === 'C' ? 'center' : el.align === 'R' ? 'right' : 'left' }}>
                  {el.value || ''}
                </div>
              )}
              {el.type === 'qr' && (
                <div className="flex items-center justify-center bg-slate-800 text-[8px] text-white"
                  style={{ width: (el.mag || 5) * 6, height: (el.mag || 5) * 6 }}>QR</div>
              )}
              {el.type === 'box' && (
                <div style={{ width: (el.w || 40) * SCALE, height: (el.h || 15) * SCALE,
                  border: `${Math.max(1, (el.thickMm || 0.4) * SCALE)}px solid #111` }} />
              )}
            </div>
          ))}
        </div>

        {/* Panel właściwości */}
        <div className="w-72 shrink-0 rounded-lg border bg-white p-3 text-sm">
          {!selEl ? <div className="text-slate-500">Zaznacz element, aby edytować.</div> : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase">{selEl.type}</span>
                <button onClick={() => { setElements(e => e.filter(x => x.id !== selEl.id)); setSel(null) }} className="text-red-600"><Trash2 size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>X mm<input type="number" value={selEl.x} onChange={e => update(selEl.id, { x: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label>Y mm<input type="number" value={selEl.y} onChange={e => update(selEl.id, { y: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
              </div>
              {selEl.type === 'text' && (<>
                <label className="block">Szerokość mm<input type="number" value={selEl.w || 0} onChange={e => update(selEl.id, { w: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label className="block">Font mm<input type="number" value={selEl.fontMm || 0} onChange={e => update(selEl.id, { fontMm: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label className="block">Wyrównanie
                  <select value={selEl.align || 'L'} onChange={e => update(selEl.id, { align: e.target.value as any })} className="w-full rounded border px-1">
                    <option value="L">Lewo</option><option value="C">Środek</option><option value="R">Prawo</option>
                  </select></label>
                <label className="block">Treść<textarea value={selEl.value || ''} onChange={e => update(selEl.id, { value: e.target.value })} rows={3} className="w-full rounded border px-1 font-mono text-xs" /></label>
                <label className="block">Wstaw dane
                  <select value="" onChange={e => e.target.value && update(selEl.id, { value: (selEl.value || '') + e.target.value })} className="w-full rounded border px-1">
                    {BIND.map(b => <option key={b} value={b}>{b || '— wybierz —'}</option>)}
                  </select></label>
              </>)}
              {selEl.type === 'qr' && (<>
                <label className="block">Powiększenie (1–10)<input type="number" min={1} max={10} value={selEl.mag || 5} onChange={e => update(selEl.id, { mag: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label className="block">Dane<input value={selEl.value || ''} onChange={e => update(selEl.id, { value: e.target.value })} className="w-full rounded border px-1 font-mono text-xs" /></label>
              </>)}
              {selEl.type === 'box' && (<>
                <div className="grid grid-cols-2 gap-2">
                  <label>Szer. mm<input type="number" value={selEl.w || 0} onChange={e => update(selEl.id, { w: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                  <label>Wys. mm<input type="number" value={selEl.h || 0} onChange={e => update(selEl.id, { h: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                </div>
                <label className="block">Grubość mm<input type="number" step="0.1" value={selEl.thickMm || 0.4} onChange={e => update(selEl.id, { thickMm: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
              </>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Trasa w App.tsx**

W `src/App.tsx` dodaj import `import { ZebraDesignerPage } from '@/pages/office/ZebraDesignerPage'`
(obok `ZebraPrintPage`) oraz trasę po `/etykiety/zebra`:
```tsx
<Route path="/etykiety/zebra-designer" element={<ZebraDesignerPage />} />
```

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "ZebraDesignerPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów ZebraDesignerPage; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/ZebraDesignerPage.tsx src/App.tsx && \
git commit -m "feat(zebra-designer): wizualny edytor (canvas, drag, wlasciwosci, test druku)"
```

---

## Task 6: Wejście do edytora + druk produkcyjny z projektu

**Files:**
- Modify: `src/pages/office/LabelTemplatesPage.tsx`
- Modify: `src/pages/office/ZebraPrintPage.tsx`

- [ ] **Step 1: Przycisk „Projektant Zebra" w LabelTemplatesPage**

W `src/pages/office/LabelTemplatesPage.tsx`, w nagłówku/akcjach strony, dodaj link do edytora.
Znajdź główny pasek akcji (np. obok przycisku dodawania szablonu) i dodaj:
```tsx
<Link to="/etykiety/zebra-designer" className="inline-flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white">
  Projektant Zebra
</Link>
```
(Upewnij się, że `Link` z `react-router-dom` jest zaimportowany.)

- [ ] **Step 2: ZebraPrintPage — preferuj projekt jeśli istnieje**

W `src/pages/office/ZebraPrintPage.tsx` rozszerz pobranie ZPL: najpierw spróbuj
`zebraDesignsApi.render(recipeId, sizeKey, planLineId)` dla wybranego rozmiaru; jeśli
`ok:false reason 'Brak projektu…'`, użyj dotychczasowego `labelsZebraApi.render`.
Dodaj wybór rozmiaru (`100x150`/`100x300`). Zmień `useEffect` renderujący:

```tsx
import { labelsZebraApi, zebraDesignsApi, type ZebraRenderResult } from '@/lib/api'
// ...
const [sizeKey, setSizeKey] = useState('100x150')
useEffect(() => {
  zebraDesignsApi.render(planLineId, sizeKey, planLineId) // patrz uwaga niżej
    .then(r => r.ok ? setRender(r as ZebraRenderResult) : labelsZebraApi.render(planLineId, clientId, recipeId).then(setRender))
    .catch(() => labelsZebraApi.render(planLineId, clientId, recipeId).then(setRender))
}, [planLineId, clientId, recipeId, sizeKey])
```
> Uwaga: `zebraDesignsApi.render(recipeId, sizeKey, planLineId)` — pierwszym argumentem jest
> `recipeId` (nie planLineId). Użyj `zebraDesignsApi.render(recipeId, sizeKey, planLineId)`.
> Dodaj `<select>` rozmiaru w UI (wartości `100x150`,`100x300`) nad przyciskiem Drukuj.

- [ ] **Step 3: Typecheck + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | grep -iE "ZebraPrintPage|LabelTemplatesPage" || echo "BRAK błędów"; npm run build 2>&1 | tail -2`
Expected: brak błędów; build OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add src/pages/office/LabelTemplatesPage.tsx src/pages/office/ZebraPrintPage.tsx && \
git commit -m "feat(zebra-designer): wejscie do edytora + druk z projektu (fallback na import .prn)"
```

---

## Task 7: Pełne testy + build + e2e

- [ ] **Step 1: Pełny pytest**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q`
Expected: wszystko zielone (w tym `test_zebra_designer.py`).

- [ ] **Step 2: Build frontu**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -2`
Expected: build OK.

- [ ] **Step 3: Ręczny e2e (sprzęt + SDK)**

1. Biuro → Szablony etykiet → „Projektant Zebra".
2. Wybierz rozmiar 100×150, dodaj: Tekst „KEBAB", Tekst „Waga [[WAGA]] kg", QR `[[QR]]`,
   Ramkę; poprzeciągaj; Zapisz.
3. „Test druku" → drukuje etykietę z danymi przykładowymi (Waga 15, QR sample).
4. Planowanie produkcji → linia → „Zebra" → ekran druku, rozmiar 100×150 → „Drukuj (N)";
   sprawdź etykiety z danymi sztuk (waga/partia/daty/QR skanowalny).

Expected: ZPL wektorowy, QR skanowalny, dane podstawione.

---

## Self-Review (autora planu)

- **Pokrycie specu:** model danych (T1); generator ZPL + merge + mm→dots (T2); CRUD/render/
  sample (T2/T3); API front (T4); edytor wizualny (T5); wejście + druk produkcyjny (T6);
  testy (T7). ✅
- **Spójność typów:** `design_to_zpl(design, values)`, `_mm_to_dots`, `_merge` zdef. w T2 i tam
  testowane; serwis (T2) używa `unit_zpl_values`/`_zpl_escape` z istniejącego
  `zebra_labels_service`. `ZebraDesign`/`ZebraElement` (T4) zgodne z modelem backendu (mm,
  dpi, elements) i z edytorem (T5). API ścieżki (T3) = `zebraDesignsApi` (T4). ✅
- **Placeholdery:** brak — pełny kod/komendy. „Znajdź pasek akcji"/„dodaj select rozmiaru" to
  wskazana integracja z istniejącym UI, nie luka logiczna. ✅
