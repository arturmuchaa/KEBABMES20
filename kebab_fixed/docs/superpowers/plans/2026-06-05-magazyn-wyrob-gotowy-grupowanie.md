# Magazyn wyrobu gotowego — widok połączony + rozbicie partii — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lista magazynu łączy partie w jeden wiersz na produkt (SKU); pełne rozbicie „ile sztuk z jakiej partii" + czysty łańcuch pokazuje podgląd.

**Architecture:** Czysto frontend. Grupowanie liczone na froncie z już pobranych wierszy `finished_goods` (każdy = jedna partia). `FinishedGoodsPage` grupuje po SKU i renderuje grupy; `DetailModal` dostaje grupę i pokazuje akordeon partii (każda → istniejący `LineageChain`). Bez zmian backendu/API.

**Tech Stack:** React + TypeScript (Vite), Tailwind, lucide-react. BRAK frontowego test‑runnera → weryfikacja = `npm run build` (typecheck) + zrzuty Playwright. Estetyka wg skilla **frontend-design**. Deploy: `cp -r dist/. /opt/kebab/app/dist/`.

**Spec:** `docs/superpowers/specs/2026-06-05-magazyn-wyrob-gotowy-grupowanie-design.md`

---

## File Structure

- `src/pages/office/FinishedGoodsPage.tsx` — grupowanie po SKU, usunięcie kolumny/sortu „Partia", sumy/KPI per grupa, render wierszy grup, otwarcie podglądu z grupą. Tu też definicja typu `SkuGroup` i helpera `groupBySku` (mały, na górze pliku — używany tylko tu).
- `src/features/finished-goods/components/DetailModal.tsx` — props `group` zamiast `item`; nagłówek SKU; akordeon „Skład wg partii"; `LineageChain` per partia; dedup/sort wsadów w `LineageChain`.

Bez nowych plików, bez zmian backendu/`lib/api`.

---

## Task 1: Helper grupowania + typ SkuGroup (FinishedGoodsPage)

**Files:** Modify `src/pages/office/FinishedGoodsPage.tsx` (dodać typ + helper przed komponentem; zmienić `SortCol`/`compareRows`).

- [ ] **Step 1: Dodaj typ `SkuGroup` i helper `groupBySku`.** Tuż przed `// ─── Sort ───` (linia ~24) wstaw:

```tsx
// ─── Grupowanie po SKU (łączymy partie/daty w jeden wiersz magazynu) ──────────
export interface SkuGroup {
  key: string
  productTypeName: string
  recipeName: string
  packagingName: string
  clientName: string
  kgPerUnit: number
  qty: number
  totalKg: number
  batches: FinishedGoodsItem[]
}

function groupBySku(items: FinishedGoodsItem[]): SkuGroup[] {
  const map = new Map<string, SkuGroup>()
  for (const it of items) {
    const key = [it.productTypeName, it.recipeName, it.packagingName,
                 it.clientName, it.kgPerUnit].join('|')
    let g = map.get(key)
    if (!g) {
      g = { key, productTypeName: it.productTypeName, recipeName: it.recipeName,
            packagingName: it.packagingName, clientName: it.clientName,
            kgPerUnit: it.kgPerUnit, qty: 0, totalKg: 0, batches: [] }
      map.set(key, g)
    }
    g.qty += it.qtyAvailable
    g.totalKg += it.qtyAvailable * it.kgPerUnit
    g.batches.push(it)
  }
  return [...map.values()]
}
```

- [ ] **Step 2: Zmień `SortCol` (usuń `batchNo`) i `compareRows` na operowanie na `SkuGroup`.** Zastąp obecny blok `type SortCol = …` + `function compareRows(...)`:

```tsx
type SortCol =
  | 'qty' | 'kgPerUnit' | 'totalKg'
  | 'productTypeName' | 'recipeName' | 'packagingName' | 'clientName'

function compareRows(col: SortCol) {
  return (a: SkuGroup, b: SkuGroup) => {
    switch (col) {
      case 'qty':             return a.qty - b.qty
      case 'kgPerUnit':       return a.kgPerUnit - b.kgPerUnit
      case 'totalKg':         return a.totalKg - b.totalKg
      case 'productTypeName': return (a.productTypeName || '').localeCompare(b.productTypeName || '')
      case 'recipeName':      return (a.recipeName      || '').localeCompare(b.recipeName      || '')
      case 'packagingName':   return (a.packagingName   || '').localeCompare(b.packagingName   || '')
      case 'clientName':      return (a.clientName      || '').localeCompare(b.clientName      || '')
    }
  }
}
```

- [ ] **Step 3: Typecheck (helper jeszcze nieużyty → build może ostrzegać o nieużytym; dokończymy w Task 2 zanim commit).** Przejdź do Task 2 bez commita.

---

## Task 2: FinishedGoodsPage — render grup, KPI, podgląd z grupą

**Files:** Modify `src/pages/office/FinishedGoodsPage.tsx`.

- [ ] **Step 1: Zamień stan i memo listy na grupy.** Zastąp:

```tsx
  const [detailItem, setDetailItem] = useState<FinishedGoodsItem | null>(null)
```
na
```tsx
  const [detailGroup, setDetailGroup] = useState<SkuGroup | null>(null)
```

Zastąp `const list = useMemo(...)` (filtr+sort) wersją na grupach:

```tsx
  const list = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = groupBySku(rawList)
    if (q) {
      result = result.filter(g =>
        (g.clientName      || '').toLowerCase().includes(q) ||
        (g.productTypeName || '').toLowerCase().includes(q) ||
        (g.recipeName      || '').toLowerCase().includes(q) ||
        (g.packagingName   || '').toLowerCase().includes(q) ||
        String(g.kgPerUnit).includes(q) ||
        g.batches.some(b => (b.batchNo || '').toLowerCase().includes(q))
      )
    }
    const cmp = compareRows(sortCol)
    return [...result].sort((a, b) => sortDir === 'asc' ? cmp(a, b) : -cmp(a, b))
  }, [rawList, filter, sortCol, sortDir])
```

Zastąp sumy:
```tsx
  const totalQty = list.reduce((s, g) => s + g.qty, 0)
  const totalKg  = list.reduce((s, g) => s + g.totalKg, 0)
```

- [ ] **Step 2: Usuń kolumnę „Partia" z nagłówka tabeli.** W tablicy nagłówków usuń wiersz `{ col: 'batchNo' …, label: 'Partia' … }`, zostawiając kolumny: Ilość, kg, Rodzaj, Receptura, Tuleja, Klient, Razem kg.

- [ ] **Step 3: Zamień render wierszy z `item` na `group`.** W `{list.map((item, idx) => …)}` zmień na `{list.map((g, idx) => …)}`, klucz `key={g.key}`, `onClick={() => setDetailGroup(g)}`. Usuń komórkę `<td>` z chipem Partii (pierwsza komórka). Pozostałe komórki użyj pól grupy:
  - Ilość: `{g.qty}<span…> szt</span>`
  - kg: `{g.kgPerUnit}<span…> kg</span>`
  - Rodzaj: `{g.productTypeName || '—'}`
  - Receptura: `{g.recipeName || '—'}`
  - Tuleja: `{g.packagingName || '—'}`
  - Klient: `{g.clientName ? clientDisplay(g.clientName) : '—'}`
  - Razem kg: `{fmtKg(g.totalKg, 0)} kg`
  (zachowaj istniejące klasy `<td>` 1:1, tylko źródło danych = `g`; usuń zmienną `totalRowKg`/`item.qtyAvailable`).

- [ ] **Step 4: Zaktualizuj render modala.** Tam gdzie było `{detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}` zmień na:

```tsx
      {detailGroup && <DetailModal group={detailGroup} onClose={() => setDetailGroup(null)} />}
```

- [ ] **Step 5: KPI „Pozycji".** Jeśli toolbar pokazuje liczbę pozycji (`list.length`/`rawList.length`) — teraz `list.length` = liczba GRUP, a `rawList` to partie; zmień drugą liczbę na `groupBySku(rawList).length`, by porównanie było grup‑do‑grup (lub usuń frakcję `/rawList.length`). Zachowaj sens: „Pozycji: <grupy>".

- [ ] **Step 6: Build (typecheck).**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -4`
Expected: `✓ built`, brak błędów TS. (Jeśli błąd „batchNo unused" — usunięto kolumnę; OK.)

- [ ] **Step 7: Commit** (razem z Task 1 — komponent spójny dopiero teraz).

```bash
git add src/pages/office/FinishedGoodsPage.tsx
git commit -m "feat(magazyn): lista wyrobu gotowego łączona po SKU (bez kolumny Partia)"
```

---

## Task 3: DetailModal — props `group`, nagłówek SKU, akordeon „Skład wg partii"

**Files:** Modify `src/features/finished-goods/components/DetailModal.tsx`.

- [ ] **Step 1: Zaimportuj `SkuGroup` i `useState` (jest), `ChevronRight/ChevronDown` do akordeonu.** Na górze:

```tsx
import { GitBranch, Beef, Scissors, FlaskConical, Package2, ChevronRight, ChevronDown } from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'
import type { SkuGroup } from '@/pages/office/FinishedGoodsPage'
```

- [ ] **Step 2: Zamień sygnaturę i ciało `DetailModal`** (zostaw `LineageChain`/`TraceStep`/`Arrow` bez zmian poza Task 4). Zastąp całą funkcję `export function DetailModal(...)`:

```tsx
export function DetailModal({ group, onClose }: { group: SkuGroup; onClose: () => void }) {
  const clientDisplay = useClientNames()
  const [openId, setOpenId] = useState<string | null>(
    group.batches.length === 1 ? group.batches[0].id : null
  )
  const workers = Array.from(new Set(group.batches.flatMap(b => b.producedBy ?? [])))

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {group.productTypeName} · {group.clientName ? clientDisplay(group.clientName) : '—'} · {group.kgPerUnit}KG
          </DialogTitle>
          <DialogDescription>
            {group.qty} szt · {fmtKg(group.totalKg)} kg · {group.batches.length} {group.batches.length === 1 ? 'partia' : 'partie/partii'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Receptura', val: group.recipeName || '—' },
              { label: 'Tuleja',    val: group.packagingName || '—' },
              { label: 'Klient',    val: group.clientName ? clientDisplay(group.clientName) : '—' },
              { label: 'Łącznie',   val: `${group.qty} szt · ${fmtKg(group.totalKg)} kg` },
            ].map(r => (
              <div key={r.label}>
                <CardDescription className="text-[10px] font-bold uppercase mb-0.5">{r.label}</CardDescription>
                <CardTitle className="text-sm font-semibold">{r.val}</CardTitle>
              </div>
            ))}
          </div>

          {/* Skład wg partii — każda rozwijalna do swojego łańcucha */}
          <div className="space-y-2">
            <CardDescription className="text-[10px] font-bold uppercase tracking-wider">
              Skład wg partii ({group.batches.length})
            </CardDescription>
            <div className="space-y-2">
              {group.batches.map(b => {
                const open = openId === b.id
                const bKg = (b.qtyAvailable ?? b.qty) * b.kgPerUnit
                return (
                  <div key={b.id} className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setOpenId(open ? null : b.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-slate-50/70 transition-colors text-left"
                    >
                      <span className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-90')}>
                        <ChevronRight size={15} />
                      </span>
                      <code className="font-mono font-bold text-sm tracking-tight text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        {b.batchNo || '—'}
                      </code>
                      <span className="font-bold text-sm tabular-nums">{b.qtyAvailable ?? b.qty}<span className="text-muted-foreground font-normal text-xs"> szt</span></span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs tabular-nums text-ink-2">{fmtKg(bKg)} kg</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{fmtDatePl(b.producedDate)}</span>
                    </button>
                    {open && (
                      <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/40">
                        <LineageChain batchId={b.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {workers.length > 0 && (
            <div className="space-y-1">
              <CardDescription className="text-[10px] font-bold uppercase">Pracownicy</CardDescription>
              <CardTitle className="text-sm font-medium">{workers.join(', ')}</CardTitle>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Build (typecheck).**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build 2>&1 | tail -4`
Expected: `✓ built`, brak błędów TS.

- [ ] **Step 4: Commit.**

```bash
git add src/features/finished-goods/components/DetailModal.tsx
git commit -m "feat(magazyn): podgląd wyrobu gotowego — rozbicie wg partii (akordeon + łańcuch per partia)"
```

---

## Task 4: LineageChain — dedup + sort wsadów (czytelność)

**Files:** Modify `src/features/finished-goods/components/DetailModal.tsx` (`LineageChain`).

- [ ] **Step 1: Odduplikuj i posortuj pozycje na każdym kroku.** W `LineageChain`, po zbudowaniu `batches` dla `step1/step2/step3`, przefiltruj duplikaty po polu `partia` i posortuj rosnąco. Dodaj helper na górze pliku (pod importami):

```tsx
function uniqSortBatches(batches: { partia: string; sub?: string | null }[]) {
  const seen = new Set<string>()
  const out: { partia: string; sub?: string | null }[] = []
  for (const b of batches) {
    const k = b.partia || ''
    if (k && seen.has(k)) continue
    seen.add(k)
    out.push(b)
  }
  return out.sort((a, b) => (a.partia || '').localeCompare(b.partia || '', undefined, { numeric: true }))
}
```

Następnie owiń `batches:` w `step1`, `step2`, `step3` w `uniqSortBatches(...)`:
```tsx
    batches: uniqSortBatches(rawBatches.map(rb => ({ … }))),   // step1
    batches: uniqSortBatches(deboning.map(d => ({ … }))),      // step2
    batches: uniqSortBatches( seasonedBatches.length > 0 ? seasonedBatches.map(sm => ({ … })) : mixingOrders.map(mo => ({ … })) ),  // step3
```
(Step4 = pojedynczy wyrób, bez zmian.)

- [ ] **Step 2: Build.** Run: `npm run build 2>&1 | tail -4` → `✓ built`.

- [ ] **Step 3: Commit.**

```bash
git add src/features/finished-goods/components/DetailModal.tsx
git commit -m "fix(magazyn): czytelny łańcuch — odduplikowane i posortowane wsady"
```

---

## Task 5: Deploy + wizualna weryfikacja

- [ ] **Step 1: Deploy.** Run: `cd /opt/kebab/kebab_new/kebab_fixed && cp -r dist/. /opt/kebab/app/dist/`
- [ ] **Step 2: Zrzut listy.** Playwright: nawiguj `http://127.0.0.1:8010/office/magazyn/gotowe`, zrzut. Sprawdź: jeden wiersz na produkt (np. GOLD KEBAB · ZAGROS · 20KG · suma szt), **brak kolumny Partia**.
- [ ] **Step 3: Zrzut podglądu.** Kliknij wiersz z ≥2 partiami; zrzut. Sprawdź: nagłówek SKU + „Skład wg partii" z pełnymi `ddmmrr partia` + szt/kg; rozwinięcie partii → czysty 4‑krokowy łańcuch (partia na każdym kroku, bez duplikatów).
- [ ] **Step 4: (jeśli OK) ewentualny commit poprawek wizualnych.**

---

## Self-Review (autor planu)

**Pokrycie specu:** lista po SKU bez kolumny Partia (T1,T2) ✓; sumy/KPI per grupa (T2) ✓; podgląd `group` + nagłówek SKU bez zakresu dat (T3) ✓; „Skład wg partii" pełny `ddmmrr`, naturalna kolejność, rozwijalny → łańcuch per partia (T3) ✓; dedup/sort wsadów (T4) ✓; brak zmian backendu ✓; weryfikacja wizualna (T5) ✓.

**Spójność typów:** `SkuGroup` (export z FinishedGoodsPage) używany w DetailModal ✓. `DetailModal` props `group` ↔ render `setDetailGroup(g)` ✓. Pola grupy (`qty/totalKg/batches/...`) liczone w `groupBySku` ✓. `b.qtyAvailable ?? b.qty` bezpieczne dla pola ilości partii ✓.

**Placeholdery:** brak „TBD/TODO"; kod kompletny w krokach.
