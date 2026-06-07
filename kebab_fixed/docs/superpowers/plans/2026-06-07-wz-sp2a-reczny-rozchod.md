# SP-2a — Ręczny WZ z rozchodem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ekran „Nowy WZ" w biurze: klient z bazy + towar z magazynu (wyrób gotowy/surowiec) + ręczne ceny → dokument WZ, który atomowo zdejmuje towar ze stanu.

**Architecture:** Rozszerzenie `wz_service` (z SP-1) o ścieżkę ręczną: w jednej transakcji wstawiamy dokument WZ (wydzielony `_insert_wz`), potem per pozycja walidujemy stan i robimy rozchód (FG: `finished_goods`; surowiec: `raw_batches`) przez istniejący `create_stock_movement(source_type='wz')`. Front to formularz wybierający klienta i pozycje z pickerów stanu.

**Tech Stack:** FastAPI + psycopg2, React + TS + Vite, pytest (testy czyste).

---

### Task 1: `is_foreign_nip` (czysta funkcja)

**Files:**
- Modify: `backend/app/services/wz_service.py`
- Test: `backend/tests/test_wz_foreign_nip.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_wz_foreign_nip.py`:

```python
from app.services.wz_service import is_foreign_nip


def test_polish_digits_domestic():
    assert is_foreign_nip("1234567890") is False


def test_pl_prefix_domestic():
    assert is_foreign_nip("PL1234567890") is False


def test_de_foreign():
    assert is_foreign_nip("DE123456789") is True


def test_case_insensitive_and_trim():
    assert is_foreign_nip("  sk2020202020 ") is True
    assert is_foreign_nip("at12345") is True


def test_empty_domestic():
    assert is_foreign_nip("") is False
    assert is_foreign_nip(None) is False
```

- [ ] **Step 2: Run — FAIL**

Run: `cd backend && pytest tests/test_wz_foreign_nip.py -q`
Expected: FAIL (ImportError: cannot import name 'is_foreign_nip').

- [ ] **Step 3: Implementacja — dopisz do `wz_service.py`** (po `build_wz_lines`)

```python
def is_foreign_nip(nip: Optional[str]) -> bool:
    """Klient zagraniczny, gdy NIP zaczyna się od dwóch liter różnych od 'PL'
    (np. DE, SK, AT). Czyste cyfry lub 'PL…' = krajowy. Puste = krajowy."""
    s = (nip or "").strip().upper()
    if len(s) < 2:
        return False
    prefix = s[:2]
    return prefix.isalpha() and prefix != "PL"
```

- [ ] **Step 4: Run — PASS**

Run: `cd backend && pytest tests/test_wz_foreign_nip.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/wz_service.py backend/tests/test_wz_foreign_nip.py
git commit -m "feat(wz): is_foreign_nip (TDD)"
```

---

### Task 2: `build_manual_wz_lines` (czysta funkcja)

**Files:**
- Modify: `backend/app/services/wz_service.py`
- Test: `backend/tests/test_wz_manual_lines.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_wz_manual_lines.py`:

```python
from app.services.wz_service import build_manual_wz_lines


def test_maps_stock_fields_and_values():
    sel = [
        {"stock_type": "fg", "stock_id": "g1", "name": "Kebab", "unit": "szt", "qty": 18, "price": 10, "batch_no": "347"},
        {"stock_type": "raw", "stock_id": "r1", "name": "Ćwiartka", "unit": "kg", "qty": 100, "price": 5, "batch_no": "350"},
    ]
    lines, total = build_manual_wz_lines(sel, valued=True)
    assert lines[0]["unit"] == "szt" and lines[0]["value"] == 180.0
    assert lines[0]["stock_type"] == "fg" and lines[0]["stock_id"] == "g1" and lines[0]["batch_no"] == "347"
    assert lines[1]["unit"] == "kg" and lines[1]["value"] == 500.0
    assert lines[1]["stock_type"] == "raw" and lines[1]["stock_id"] == "r1"
    assert total == 680.0


def test_not_valued_no_prices():
    sel = [{"stock_type": "fg", "stock_id": "g1", "name": "Kebab", "unit": "szt", "qty": 5, "price": 10}]
    lines, total = build_manual_wz_lines(sel, valued=False)
    assert lines[0]["price"] is None and lines[0]["value"] is None
    assert total == 0.0
```

- [ ] **Step 2: Run — FAIL**

Run: `cd backend && pytest tests/test_wz_manual_lines.py -q`
Expected: FAIL (ImportError).

- [ ] **Step 3: Implementacja — dopisz do `wz_service.py`**

```python
def build_manual_wz_lines(selections: List[Dict[str, Any]], valued: bool) -> Tuple[List[Dict[str, Any]], float]:
    """Mapuje wybór magazynu na pozycje WZ (reużywa build_wz_lines) i dokleja
    ślad magazynowy (stock_type/stock_id) do każdej pozycji."""
    items = [
        {"name": s.get("name"), "qty": s.get("qty"), "unit": s.get("unit"),
         "price": s.get("price"), "batch_no": s.get("batch_no")}
        for s in (selections or [])
    ]
    lines, total = build_wz_lines(items, valued)
    for line, s in zip(lines, selections or []):
        line["stock_type"] = s.get("stock_type")
        line["stock_id"] = s.get("stock_id")
    return lines, total
```

- [ ] **Step 4: Run — PASS**

Run: `cd backend && pytest tests/test_wz_manual_lines.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/wz_service.py backend/tests/test_wz_manual_lines.py
git commit -m "feat(wz): build_manual_wz_lines (TDD)"
```

---

### Task 3: Refaktor — wydziel `_insert_wz(conn, ...)`

**Files:**
- Modify: `backend/app/services/wz_service.py:90-133` (wnętrze `generate_wz`)

Bez zmiany zachowania — wydzielamy wstawienie dokumentu, żeby `create_manual_wz` mogło je reużyć w tej samej transakcji.

- [ ] **Step 1: Dodaj `_insert_wz` przed `generate_wz`**

```python
def _insert_wz(conn, *, source_type, source_id, seller, buyer, valued, lines,
               total, place, issued, released, notes) -> str:
    """Wstaw dokument WZ w trwającej transakcji, nadaj numer WZ/NN/MM/RR. Zwraca id."""
    today = date.today()
    ym = today.strftime("%y%m")  # RRMM
    seq_row = cx_query_one(
        conn, "SELECT COALESCE(MAX(seq),0)+1 AS n FROM wz_documents WHERE year_month=%s", (ym,))
    seq = int(seq_row["n"])
    number = format_wz_number(seq, ym)
    wid = cuid()
    cx_execute_returning(
        conn,
        """INSERT INTO wz_documents
           (id, number, seq, year_month, source_type, source_id, seller,
            buyer_name, buyer_address, buyer_nip, valued, lines, total_value,
            place, issued_date, release_date, status, notes, created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s)
           RETURNING id""",
        (wid, number, seq, ym, source_type, source_id, json.dumps(seller),
         buyer.get("name"), buyer.get("address"), buyer.get("nip"), valued,
         json.dumps(lines), total, place, issued, released, notes, now_iso()),
    )
    logger.info("wz.generated", extra={"wz_id": wid, "number": number})
    return wid
```

- [ ] **Step 2: Zastąp blok wewnątrz `generate_wz` (od `ym = today.strftime("%y%m")` do `RETURNING id"""...)`) wywołaniem**

Zamień w `generate_wz` cały blok numeracji + INSERT (obecne linie ~118-132) na:

```python
        wid = _insert_wz(
            conn, source_type=source_type, source_id=source_id, seller=seller,
            buyer=buyer, valued=valued, lines=lines, total=total, place=place_val,
            issued=issued, released=released, notes=notes)
    return get_wz(wid)
```

(usuwając też osobny `logger.info("wz.generated"...)` na końcu — log jest teraz w `_insert_wz`).

- [ ] **Step 3: Pełny zestaw testów (bez regresji)**

Run: `cd backend && pytest -q`
Expected: PASS (wszystko zielone — `test_wz_*` nadal przechodzą).

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/wz_service.py
git commit -m "refactor(wz): wydziel _insert_wz (reuse w trybie ręcznym)"
```

---

### Task 4: `create_manual_wz` (atomowy rozchód + WZ)

**Files:**
- Modify: `backend/app/services/wz_service.py`

- [ ] **Step 1: Dodaj funkcję** (po `generate_wz`)

```python
def create_manual_wz(
    buyer: Dict[str, Any],
    selections: List[Dict[str, Any]],
    valued: bool = True,
    place: Optional[str] = None,
    issued_date: Optional[str] = None,
    release_date: Optional[str] = None,
    notes: str = "",
) -> Dict[str, Any]:
    """Ręczny WZ ze sprzedaży z magazynu. Atomowo: dokument WZ + rozchód
    (FG: szt, surowiec: kg). Brak stanu → 400 + rollback całości."""
    if not selections:
        raise HTTPException(400, "WZ wymaga co najmniej jednej pozycji")

    lines, total = build_manual_wz_lines(selections, valued)
    co = get_company()
    today = date.today()
    issued = issued_date or today.strftime("%d.%m.%Y")
    released = release_date or issued
    place_val = place or co.get("city") or ""
    seller = _seller_block()

    with transaction() as conn:
        wid = _insert_wz(
            conn, source_type="manual", source_id=None, seller=seller,
            buyer=buyer, valued=valued, lines=lines, total=total, place=place_val,
            issued=issued, released=released, notes=notes)

        for sel in selections:
            stype = sel.get("stock_type")
            sid = sel.get("stock_id")
            qty = float(sel.get("qty") or 0)
            if qty <= 0:
                raise HTTPException(400, "Ilość pozycji musi być > 0")

            if stype == "fg":
                row = cx_query_one(
                    conn,
                    "SELECT id, batch_no, qty_available, kg_per_unit FROM finished_goods WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                need = int(qty)
                avail = int(row.get("qty_available") or 0)
                if avail < need:
                    raise HTTPException(
                        400, f"Za mało wyrobu (partia {row.get('batch_no')}): jest {avail} szt, potrzeba {need}")
                cx_execute(
                    conn,
                    "UPDATE finished_goods SET qty_available=qty_available-%s, qty_shipped=qty_shipped+%s WHERE id=%s",
                    (need, need, sid))
                create_stock_movement(
                    conn, product_type="finished_goods", batch_id=sid,
                    qty=need * float(row.get("kg_per_unit") or 0),
                    movement_type="OUT", source_type="wz", source_id=wid)

            elif stype == "raw":
                row = cx_query_one(
                    conn,
                    "SELECT id, internal_batch_no, kg_available FROM raw_batches WHERE id=%s FOR UPDATE",
                    (sid,))
                if not row:
                    raise HTTPException(400, "Pozycja magazynowa nie istnieje")
                avail = float(row.get("kg_available") or 0)
                if avail + 1e-6 < qty:
                    raise HTTPException(
                        400, f"Za mało surowca (partia {row.get('internal_batch_no')}): jest {avail} kg, potrzeba {qty}")
                cx_execute(
                    conn,
                    "UPDATE raw_batches SET kg_available=GREATEST(0, kg_available-%s) WHERE id=%s",
                    (qty, sid))
                create_stock_movement(
                    conn, product_type="raw", batch_id=sid, qty=qty,
                    movement_type="OUT", source_type="wz", source_id=wid)
            else:
                raise HTTPException(400, f"Nieznany typ magazynu: {stype}")

    logger.info("wz.manual.created", extra={"wz_id": wid, "items": len(selections)})
    return get_wz(wid)
```

Dodaj import na górze `wz_service.py` (jeśli brak): `from app.db import cx_execute` i `from app.utils.stock import create_stock_movement`.

- [ ] **Step 2: Sprawdź importy + składnię**

Run: `cd backend && python3 -c "import app.services.wz_service; print('OK')"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/wz_service.py
git commit -m "feat(wz): create_manual_wz — atomowy rozchód + dokument"
```

---

### Task 5: Endpointy stanu + `POST /api/wz/manual`

**Files:**
- Modify: `backend/app/services/wz_service.py` (funkcje `stock_finished_goods`, `stock_raw`)
- Modify: `backend/app/routes/wz.py`

- [ ] **Step 1: Dodaj funkcje stanu w `wz_service.py`**

```python
def stock_finished_goods() -> List[Dict[str, Any]]:
    return query_all(
        """SELECT id, batch_no, recipe_name, product_type_name,
                  qty_available, kg_per_unit
           FROM finished_goods WHERE COALESCE(qty_available,0) > 0
           ORDER BY produced_date DESC NULLS LAST, batch_no""")


def stock_raw() -> List[Dict[str, Any]]:
    return query_all(
        """SELECT id, internal_batch_no, supplier_name, kg_available
           FROM raw_batches WHERE COALESCE(kg_available,0) > 0
           ORDER BY received_date DESC NULLS LAST, internal_batch_no""")
```

- [ ] **Step 2: Dodaj trasy w `wz.py`** (przed `@router.get("/{wz_id}")`, żeby `/stock/...` i `/manual` nie wpadły w `{wz_id}`)

```python
@router.get("/stock/finished-goods")
def stock_fg():
    return svc.stock_finished_goods()


@router.get("/stock/raw")
def stock_raw():
    return svc.stock_raw()


@router.post("/manual")
def manual(body: dict):
    items = [
        {"stock_type": it.get("stockType"), "stock_id": it.get("stockId"),
         "name": it.get("name"), "unit": it.get("unit"), "qty": it.get("qty"),
         "price": it.get("price"), "batch_no": it.get("batchNo")}
        for it in (body.get("items") or [])
    ]
    return svc.create_manual_wz(
        buyer=body.get("buyer") or {},
        selections=items,
        valued=bool(body.get("valued", True)),
        place=body.get("place"),
        issued_date=body.get("issuedDate"),
        release_date=body.get("releaseDate"),
        notes=body.get("notes", ""),
    )
```

- [ ] **Step 3: Import + smoke-test na bazie**

Run:
```bash
cd backend && python3 -c "import app.main; print('OK')"
cd backend && python3 - <<'PY' 2>&1 | grep -v db.pool.init
from app.services.wz_service import stock_finished_goods, stock_raw, create_manual_wz
fg = stock_finished_goods(); raw = stock_raw()
print("FG na stanie:", len(fg), "| surowiec na stanie:", len(raw))
if raw:
    r = raw[0]; before = float(r["kg_available"])
    d = create_manual_wz({"name":"FIRMA TEST","nip":"DE123"},
        [{"stock_type":"raw","stock_id":r["id"],"name":"Surowiec","unit":"kg","qty":1,"price":2.0,"batch_no":r["internal_batch_no"]}])
    from app.db import query_one
    after = float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s",(r["id"],))["kg_available"])
    print("WZ:", d["number"], "| rozchód kg:", round(before-after,3), "(ma być 1.0)")
    # sprzątanie: zwróć kg i usuń dokument + ruch
    from app.db import execute
    execute("UPDATE raw_batches SET kg_available=kg_available+1 WHERE id=%s",(r["id"],))
    execute("DELETE FROM stock_movements WHERE source_id=%s",(d["id"],))
    execute("DELETE FROM wz_documents WHERE id=%s",(d["id"],))
    print("posprzątano")
PY
```
Expected: `OK`; rozchód kg = 1.0; „posprzątano".

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/wz_service.py backend/app/routes/wz.py
git commit -m "feat(wz): endpointy stanu + POST /api/wz/manual"
```

---

### Task 6: Front — `wzApi` (stan + tworzenie ręczne)

**Files:**
- Modify: `src/lib/api.ts` (blok `wzApi`)

- [ ] **Step 1: Dodaj metody do `wzApi`**

W `src/lib/api.ts`, w obiekcie `wzApi`, dodaj (przed `pdfUrl`):

```ts
  stockFg: () => get<any[]>('/wz/stock/finished-goods'),
  stockRaw: () => get<any[]>('/wz/stock/raw'),
  createManual: (body: {
    buyer: { name: string; address?: string; nip?: string };
    items: { stockType: 'fg' | 'raw'; stockId: string; name: string; unit: string; qty: number; price?: number; batchNo?: string }[];
    valued?: boolean; place?: string; issuedDate?: string; releaseDate?: string; notes?: string;
  }) => post<WzDoc>('/wz/manual', body),
```

- [ ] **Step 2: Type-check**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: 0 błędów.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(wz): wzApi stockFg/stockRaw/createManual (front)"
```

---

### Task 7: Front — ekran „Nowy WZ" + trasa + wejście

**Files:**
- Create: `src/pages/office/WzNewPage.tsx`
- Modify: `src/App.tsx` (import + trasa `/office/wz/nowy`)
- Modify: `src/pages/office/WzDocumentsPage.tsx` (przycisk „Nowy WZ")

- [ ] **Step 1: Utwórz ekran**

`src/pages/office/WzNewPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, clientsApi } from '@/lib/api'

type Row = { stockType: 'fg' | 'raw'; stockId: string; name: string; unit: string; qty: number; price: number; batchNo?: string }

const isForeignNip = (nip: string) => {
  const s = (nip || '').trim().toUpperCase()
  return s.length >= 2 && /^[A-Z]{2}/.test(s) && s.slice(0, 2) !== 'PL'
}

export function WzNewPage() {
  const nav = useNavigate()
  const [clients, setClients] = useState<any[]>([])
  const [fg, setFg] = useState<any[]>([])
  const [raw, setRaw] = useState<any[]>([])
  const [buyer, setBuyer] = useState({ name: '', address: '', nip: '' })
  const [rows, setRows] = useState<Row[]>([])
  const [tab, setTab] = useState<'fg' | 'raw'>('fg')
  const [err, setErr] = useState('')

  useEffect(() => {
    clientsApi.list().then(setClients)
    wzApi.stockFg().then(setFg)
    wzApi.stockRaw().then(setRaw)
  }, [])

  const foreign = useMemo(() => isForeignNip(buyer.nip), [buyer.nip])
  const total = rows.reduce((s, r) => s + r.qty * r.price, 0)

  const pickClient = (id: string) => {
    const c = clients.find(x => x.id === id)
    if (c) setBuyer({ name: c.name || c.displayName || '', address: `${c.address || ''} ${c.city || ''}`.trim(), nip: c.nip || '' })
  }
  const addFg = (g: any) => setRows(r => [...r, { stockType: 'fg', stockId: g.id, name: g.recipe_name || g.product_type_name || 'Wyrób', unit: 'szt', qty: 1, price: 0, batchNo: g.batch_no }])
  const addRaw = (b: any) => setRows(r => [...r, { stockType: 'raw', stockId: b.id, name: `Surowiec ${b.internal_batch_no}`, unit: 'kg', qty: 1, price: 0, batchNo: b.internal_batch_no }])
  const upd = (i: number, k: 'qty' | 'price', v: number) => setRows(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const del = (i: number) => setRows(r => r.filter((_, j) => j !== i))

  const submit = async () => {
    setErr('')
    if (!buyer.name) { setErr('Wybierz lub wpisz odbiorcę'); return }
    if (!rows.length) { setErr('Dodaj co najmniej jedną pozycję'); return }
    try {
      const doc = await wzApi.createManual({ buyer, items: rows, valued: true })
      nav(`/office/wz/${doc.id}/druk`)
    } catch (e: any) { setErr(e?.message || 'Błąd wystawiania WZ') }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Nowy WZ (sprzedaż z magazynu)</h1>

      <section style={{ marginBottom: 16 }}>
        <b>Odbiorca</b>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <select onChange={e => pickClient(e.target.value)} defaultValue="">
            <option value="">— wybierz klienta —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.displayName}</option>)}
          </select>
          <input placeholder="Nazwa" value={buyer.name} onChange={e => setBuyer({ ...buyer, name: e.target.value })} />
          <input placeholder="Adres" value={buyer.address} onChange={e => setBuyer({ ...buyer, address: e.target.value })} />
          <input placeholder="NIP" value={buyer.nip} onChange={e => setBuyer({ ...buyer, nip: e.target.value })} />
        </div>
        {foreign && <div style={{ marginTop: 6, color: '#b45309' }}>Klient zagraniczny — wymagany CMR (SP-2c) + HDI.</div>}
        {!foreign && buyer.nip && <div style={{ marginTop: 6, color: '#555' }}>Klient krajowy — wymagany WZ + HDI.</div>}
      </section>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('fg')} style={{ fontWeight: tab === 'fg' ? 700 : 400 }}>Wyrób gotowy</button>
          <button onClick={() => setTab('raw')} style={{ fontWeight: tab === 'raw' ? 700 : 400 }}>Surowiec</button>
        </div>
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #ddd', marginTop: 6, padding: 6 }}>
          {tab === 'fg' && fg.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 4 }}>
              <span>{g.recipe_name || g.product_type_name} · partia {g.batch_no} · {g.qty_available} szt</span>
              <button onClick={() => addFg(g)}>+ dodaj</button>
            </div>
          ))}
          {tab === 'raw' && raw.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 4 }}>
              <span>{b.internal_batch_no} · {b.supplier_name} · {b.kg_available} kg</span>
              <button onClick={() => addRaw(b)}>+ dodaj</button>
            </div>
          ))}
        </div>
      </section>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr>{['Towar', 'Partia', 'Ilość', 'j.m.', 'Cena', 'Wartość', ''].map((h, i) => (
          <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>{h}</th>))}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: 6 }}>{r.name}</td>
              <td style={{ padding: 6 }}>{r.batchNo}</td>
              <td style={{ padding: 6 }}><input type="number" value={r.qty} min={0} style={{ width: 80 }} onChange={e => upd(i, 'qty', Number(e.target.value))} /></td>
              <td style={{ padding: 6 }}>{r.unit}</td>
              <td style={{ padding: 6 }}><input type="number" value={r.price} min={0} step="0.01" style={{ width: 90 }} onChange={e => upd(i, 'price', Number(e.target.value))} /></td>
              <td style={{ padding: 6, textAlign: 'right' }}>{(r.qty * r.price).toFixed(2)}</td>
              <td style={{ padding: 6 }}><button onClick={() => del(i)}>usuń</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, padding: 6 }}>Razem</td><td style={{ textAlign: 'right', fontWeight: 700, padding: 6 }}>{total.toFixed(2)}</td><td /></tr></tfoot>
      </table>

      {err && <div style={{ color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <button onClick={submit} style={{ padding: '8px 16px', fontWeight: 700 }}>Wystaw WZ (rozchód ze stanu)</button>
    </div>
  )
}
```

- [ ] **Step 2: Trasa w `App.tsx`**

Dodaj import `import { WzNewPage } from '@/pages/office/WzNewPage'` (przy `WzDocumentsPage`) i w sekcji `/office` (przy `path="wz"`): `<Route path="wz/nowy" element={<WzNewPage />} />`.

> Uwaga: w `App.tsx` trasa `wz/nowy` musi być zadeklarowana razem z innymi zagnieżdżonymi w `/office` (nie pod druk `/office/wz/:id/druk`).

- [ ] **Step 3: Przycisk „Nowy WZ" w `WzDocumentsPage.tsx`**

Tuż pod `<h1 ...>Dokumenty WZ</h1>` dodaj:

```tsx
      <a href="/office/wz/nowy" style={{ display: 'inline-block', marginBottom: 12, padding: '6px 12px', background: '#111', color: '#fff', borderRadius: 4, textDecoration: 'none' }}>+ Nowy WZ</a>
```

- [ ] **Step 4: Type-check + build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit && npm run build`
Expected: 0 błędów, build OK.

- [ ] **Step 5: Commit**

```bash
git add src/pages/office/WzNewPage.tsx src/App.tsx src/pages/office/WzDocumentsPage.tsx
git commit -m "feat(wz): ekran Nowy WZ (tryb ręczny) + trasa + wejście"
```

---

## Self-Review (autor planu)

**Pokrycie specki:**
- `is_foreign_nip` → Task 1 ✓
- `build_manual_wz_lines` → Task 2 ✓
- `_insert_wz` (atomowość WZ+rozchód) → Task 3 ✓
- `create_manual_wz` (rozchód FG/surowiec, walidacja, source_type='wz') → Task 4 ✓
- Endpointy stanu + `POST /api/wz/manual` → Task 5 ✓
- `wzApi` (stockFg/stockRaw/createManual) → Task 6 ✓
- Ekran „Nowy WZ" (klient z bazy, pozycje FG/surowiec, ceny ręczne, baner zagraniczny) → Task 7 ✓
- Pozycja WZ ze śladem `stock_type/stock_id/batch_no` → Task 2 + Task 4 ✓
- Walidacja/błędy (brak pozycji, za mało stanu, zła ilość) → Task 4 ✓
- Testy czyste → Task 1, 2 ✓

**Poza zakresem (zgodnie ze specką):** import z zamówienia + rozchód wydania przez WZ (SP-2b); auto HDI/CMR (SP-2c).

**Placeholdery:** brak — każdy krok ma realny kod/komendę.

**Spójność typów/sygnatur:** `is_foreign_nip(nip)`, `build_manual_wz_lines(selections, valued)→(lines,total)`, `_insert_wz(conn, *, ...)→wid`, `create_manual_wz(buyer, selections, ...)`, `stock_finished_goods()`, `stock_raw()`, `wzApi.{stockFg,stockRaw,createManual}` — spójne między backendem, API i frontem. Pola pozycji (`stockType/stockId/qty/price/batchNo/unit/name`) zgodne front↔route↔serwis.
