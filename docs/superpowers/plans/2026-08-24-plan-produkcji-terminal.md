# Plan produkcji jako terminal dnia — plan wdrożenia

> **Dla wykonawcy:** plan wykonuje się zadanie po zadaniu, każde kończy się
> zielonymi testami i commitem. Kroki mają checkboxy (`- [ ]`) do odhaczania.
> **Nie** zlecać tego podagentom: w tym repo podagenty nie piszą do `src/`
> ani `backend/` — wykonanie idzie w bieżącej sesji.

**Cel:** przebudować edytor planu produkcji w idiom terminala (jak wprowadzanie
zamówień), z widocznym stanem partii przyprawionego i przydziałem FEFO, który
proponuje, a nie decyduje.

**Architektura:** zmieniamy wyłącznie warstwę prezentacji. Backend, DTO
i matematyka przydziału (`planMeatAllocation.ts`) zostają nietknięte —
`ProductionPlanningPage.tsx` (2123 linie, osiem komponentów) rozpada się na
rodzinę plików w `features/production-plan/`, a stan szkicu przenosi się do
hooka `usePlanDraft`.

**Stos:** React 18 + TypeScript (strict wyłączony), Vite, Tailwind,
vitest (node dla logiki, jsdom dla komponentów), @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-24-plan-produkcji-terminal-design.md`

## Ograniczenia globalne

- **Backend nietknięty.** Żadnych zmian w `backend/`, DTO ani endpointach.
- **`planMeatAllocation.ts` nietknięty.** Jest lustrem backendowego
  `_compute_allocation`. W szczególności `JOIN_LEFTOVER_PIECES = false` MUSI
  zostać zgodne z backendowym `MIXED_PIECE_NUMBERING`.
- **Nietknięte także:** `planOwnReservations.ts`, `officeFinish.ts`,
  `remainderSplit.ts`, `productionCard.ts`, druk karty produkcji.
- Komentarze w kodzie po polsku, tłumaczą DLACZEGO — tak jak w reszcie repo.
  Wiedza zapisana w komentarzach `PlanForm` (własne rezerwacje przy edycji,
  komponenty 70/30, zamrożone pozycje) przenosi się 1:1 razem z komentarzami.
- Testy uruchamiamy `npx vitest run <ścieżka>`; typy `npx tsc --noEmit -p tsconfig.json`.
- Kilogramy formatujemy `fmtKgTrim` (bez ozdobnego zera).
- Katalog roboczy wszystkich poleceń: `/opt/kebab/kebab_new/kebab_fixed`.

---

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `src/components/terminal/fields.tsx` | **przeniesione** z `features/orders/order-entry/fields.tsx` — `FieldShell`, `ComboField`, `NumberField`; od teraz wspólne dla zamówień i planu |
| `src/features/production-plan/planFefo.ts` | **nowy** — czysty przydział FEFO z furtką ręczną i zamrożeniem |
| `src/features/production-plan/planFefo.test.ts` | testy jw. (node) |
| `src/features/production-plan/components/BatchPanel.tsx` | **nowy** — panel partii przyprawionego |
| `src/features/production-plan/components/PlanLinesTable.tsx` | **nowy** — pozycje w stałych kolumnach |
| `src/features/production-plan/components/PlanTerminal.tsx` | **nowy** — pasek wsadu pod klawiaturę |
| `src/features/production-plan/usePlanDraft.ts` | **nowy** — stan szkicu planu |
| `src/features/production-plan/PlanEditor.tsx` | **nowy** — kompozycja ekranu |
| `src/pages/office/ProductionPlanningPage.tsx` | **odchudzony** — zostaje przegląd planów |

---

### Zadanie 1: Pola terminala do wspólnego katalogu

Pola wsadu są dziś zamknięte w module zamówień. Plan ma używać dokładnie tych
samych — to ten sam idiom, a dwie kopie rozjadą się przy pierwszej poprawce.

**Pliki:**
- Utwórz: `src/components/terminal/fields.tsx` (przeniesienie zawartości)
- Usuń: `src/features/orders/order-entry/fields.tsx`
- Zmień: `src/features/orders/order-entry/OrderEntryPage.tsx` (import)
- Zmień: `src/features/orders/order-entry/comboField.test.tsx` (import)

**Interfejsy:**
- Produkuje: `FieldShell`, `ComboField`, `NumberField`, `type ComboItem` —
  eksporty bez zmian, zmienia się tylko ścieżka.

- [ ] **Krok 1: Przenieś plik bez zmiany treści**

```bash
git mv src/features/orders/order-entry/fields.tsx src/components/terminal/fields.tsx
```

- [ ] **Krok 2: Popraw importy w dwóch miejscach**

W `src/features/orders/order-entry/OrderEntryPage.tsx` i
`src/features/orders/order-entry/comboField.test.tsx` zamień:

```ts
// było
import { ComboField, NumberField, FieldShell } from './fields'
// ma być
import { ComboField, NumberField, FieldShell } from '@/components/terminal/fields'
```

(dokładna lista importowanych nazw może się różnić — zachowaj tę, która jest)

- [ ] **Krok 3: Uruchom testy zamówień**

Run: `npx vitest run src/features/orders/`
Expected: PASS, 48 testów. Czerwone = cofnij przeniesienie i zamiast tego
zostaw pola na miejscu, a w planie zaimportuj je ze starej ścieżki.

- [ ] **Krok 4: Typy**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0

- [ ] **Krok 5: Commit**

```bash
git add src/components/terminal/fields.tsx src/features/orders/order-entry/
git commit -m "refactor(terminal): pola wsadu do wspolnego katalogu

Uzywaja ich teraz dwa ekrany - zamowienia i plan produkcji - wiec maja
zostac jednym idiomem. Dwie kopie rozjechalyby sie przy pierwszej poprawce."
```

---

### Zadanie 2: `planFefo.ts` — przydział, który proponuje

Dziś `autoAssignRecipe` siedzi w środku `PlanForm` i pomija każdą pozycję,
która ma już jakiekolwiek partie. Brakuje rozróżnienia „to wybrał FEFO"
od „to wybrał człowiek", więc nie da się przeliczyć planu od nowa bez
zdeptania ręcznych decyzji.

**Pliki:**
- Utwórz: `src/features/production-plan/planFefo.ts`
- Test: `src/features/production-plan/planFefo.test.ts`

**Interfejsy:**
- Konsumuje: `fefoLotCompare` z `@/lib/utils/fefo`
- Produkuje:
  - `interface FefoLine { recipeId: string; qty: string|number; kgPerUnit: string|number; seasonedBatchIds?: string[]; seasonedBatchId?: string; batchesManual?: boolean; qtyDone?: number }`
  - `interface FefoBatch { id: string; recipeId: string; batchNo?: string; expiryDate?: string; kgFree: number }`
  - `assignFefo<T extends FefoLine>(lines: T[], batches: FefoBatch[], opts?: { recipeId?: string; force?: boolean }): T[]`
  - `clearManual<T extends FefoLine>(lines: T[]): T[]`

- [ ] **Krok 1: Napisz test, który pada**

```ts
/**
 * Przydział partii przyprawionego do pozycji planu.
 *
 * FEFO PROPONUJE, człowiek decyduje: pozycja ruszona ręcznie dostaje znacznik
 * `batchesManual` i automat jej nie nadpisuje. Bez tego każda ręczna decyzja
 * ginęłaby przy następnym wpisanym kilogramie.
 */
import { describe, it, expect } from 'vitest'
import { assignFefo, clearManual, type FefoBatch } from './planFefo'

/** Partie tej samej receptury; 100 ma krótszy termin, więc idzie pierwsza. */
const PARTIE: FefoBatch[] = [
  { id: 'b100', recipeId: 'r1', batchNo: '100', expiryDate: '2026-09-01', kgFree: 300 },
  { id: 'b200', recipeId: 'r1', batchNo: '200', expiryDate: '2026-09-05', kgFree: 900 },
]

const linia = (over: Partial<Parameters<typeof assignFefo>[0][number]> = {}) => ({
  recipeId: 'r1', qty: '10', kgPerUnit: '10', ...over,
})

describe('assignFefo', () => {
  it('pustej pozycji przypisuje najstarszą partię', () => {
    const [l] = assignFefo([linia()], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b100'])
    expect(l.seasonedBatchId).toBe('b100')
  })

  it('gdy najstarsza nie starczy, dokłada kolejną', () => {
    const [l] = assignFefo([linia({ qty: '50' })], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b100', 'b200'])
  })

  it('dwie pozycje nie biorą tych samych kilogramów', () => {
    const out = assignFefo([linia({ qty: '30' }), linia({ qty: '30' })], PARTIE)
    expect(out[0].seasonedBatchIds).toEqual(['b100'])
    expect(out[1].seasonedBatchIds).toEqual(['b200'])
  })

  it('pozycji ruszonej ręcznie NIE nadpisuje', () => {
    const reczna = linia({ seasonedBatchIds: ['b200'], batchesManual: true })
    const [l] = assignFefo([reczna], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b200'])
  })

  it('pozycji rozpoczętej na hali NIE rusza', () => {
    const wProdukcji = linia({ seasonedBatchIds: ['b200'], qtyDone: 3 })
    const [l] = assignFefo([wProdukcji], PARTIE)
    expect(l.seasonedBatchIds).toEqual(['b200'])
  })

  it('force przelicza wszystko poza pozycjami rozpoczętymi', () => {
    const out = assignFefo(
      [linia({ seasonedBatchIds: ['b200'], batchesManual: true }),
       linia({ seasonedBatchIds: ['b200'], qtyDone: 3 })],
      PARTIE, { force: true },
    )
    expect(out[0].seasonedBatchIds).toEqual(['b100'])
    expect(out[1].seasonedBatchIds).toEqual(['b200'])
  })

  it('partia mieszcząca mniej niż jedną CAŁĄ sztukę nie wchodzi', () => {
    const male: FefoBatch[] = [{ id: 'bm', recipeId: 'r1', kgFree: 5, expiryDate: '2026-09-01' }]
    const [l] = assignFefo([linia({ kgPerUnit: '10' })], male)
    expect(l.seasonedBatchIds ?? []).toEqual([])
  })

  it('pozycji bez receptury albo bez kilogramów nie dotyka', () => {
    const [a] = assignFefo([linia({ recipeId: '' })], PARTIE)
    const [b] = assignFefo([linia({ qty: '0' })], PARTIE)
    expect(a.seasonedBatchIds ?? []).toEqual([])
    expect(b.seasonedBatchIds ?? []).toEqual([])
  })

  it('opts.recipeId zawęża przeliczenie do jednej receptury', () => {
    const inna = linia({ recipeId: 'r9' })
    const out = assignFefo([inna, linia()], PARTIE, { recipeId: 'r1' })
    expect(out[0].seasonedBatchIds ?? []).toEqual([])
    expect(out[1].seasonedBatchIds).toEqual(['b100'])
  })

  it('nie mutuje wejścia', () => {
    const wej = [linia()]
    assignFefo(wej, PARTIE)
    expect(wej[0].seasonedBatchIds).toBeUndefined()
  })
})

describe('clearManual', () => {
  it('zdejmuje znaczniki ręczne, zostawiając pozycje rozpoczęte', () => {
    const out = clearManual([
      linia({ batchesManual: true }),
      linia({ batchesManual: true, qtyDone: 2 }),
    ])
    expect(out[0].batchesManual).toBe(false)
    expect(out[1].batchesManual).toBe(true)
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz czerwone**

Run: `npx vitest run src/features/production-plan/planFefo.test.ts`
Expected: FAIL — `Failed to load url ./planFefo`

- [ ] **Krok 3: Napisz `planFefo.ts`**

```ts
/**
 * planFefo — przydział partii przyprawionego do pozycji planu produkcji.
 *
 * Wyjęte z `PlanForm.autoAssignRecipe`, z jedną różnicą: pozycja ruszona
 * ręcznie niesie znacznik `batchesManual` i automat jej NIE nadpisuje.
 * Bez tego znacznika nie dało się przeliczyć planu od nowa, nie depcząc
 * decyzji planisty — a i odwrotnie: każda ręczna zmiana ginęła przy
 * następnym wpisanym kilogramie.
 *
 * Pozycje rozpoczęte na hali (`qtyDone > 0`) są ZAMROŻONE i nie rusza ich
 * nawet `force`: ich mięso już poszło w produkcję.
 *
 * Partię dokładamy tylko wtedy, gdy zmieści choć jedną CAŁĄ sztukę — sztuka
 * nosi jeden numer partii (patrz `planMeatAllocation`, JOIN_LEFTOVER_PIECES).
 *
 * Zero importów z React/UI — czysta logika, testowana w node.
 */
import { fefoLotCompare } from '@/lib/utils/fefo'

export interface FefoLine {
  recipeId:          string
  qty:               string | number
  kgPerUnit:         string | number
  seasonedBatchIds?: string[]
  seasonedBatchId?:  string
  /** Partie wybrał człowiek — automat ma je zostawić w spokoju. */
  batchesManual?:    boolean
  /** Sztuki wykonane na hali; > 0 = pozycja zamrożona. */
  qtyDone?:          number
}

export interface FefoBatch {
  id:          string
  recipeId:    string
  batchNo?:    string
  expiryDate?: string
  /** Wolne kilogramy partii PO uwzględnieniu rezerwacji tego planu. */
  kgFree:      number
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Pozycja zamrożona — hala już z niej produkuje. */
const zamrozona = (l: FefoLine): boolean => num(l.qtyDone) > 0

/** Czy pozycja ma już jakiekolwiek partie. */
const maPartie = (l: FefoLine): boolean =>
  (l.seasonedBatchIds?.length ?? 0) > 0 || !!l.seasonedBatchId

export function assignFefo<T extends FefoLine>(
  lines: T[],
  batches: FefoBatch[],
  opts: { recipeId?: string; force?: boolean } = {},
): T[] {
  // Jedna wspólna pula na cały przebieg: pozycje biorą po kolei, więc dwie
  // pozycje tej samej receptury nie zgłoszą tych samych kilogramów.
  const pula = [...batches]
    .filter(b => b.kgFree > 0)
    .sort((a, b) => fefoLotCompare(
      { expiryDate: a.expiryDate, no: a.batchNo, id: a.id },
      { expiryDate: b.expiryDate, no: b.batchNo, id: b.id },
    ))
    .map(b => ({ id: b.id, recipeId: b.recipeId, rem: b.kgFree }))

  return lines.map(line => {
    if (opts.recipeId && line.recipeId !== opts.recipeId) return line
    if (zamrozona(line)) return line
    if (!opts.force && (line.batchesManual || maPartie(line))) return line

    const qty  = num(line.qty)
    const kgPu = num(line.kgPerUnit)
    if (!line.recipeId || qty <= 0 || kgPu <= 0) return line

    let zostaloSztuk = qty
    const przydzielone: string[] = []
    for (const b of pula) {
      if (zostaloSztuk <= 0) break
      if (b.recipeId !== line.recipeId) continue
      const sztuk = Math.min(zostaloSztuk, Math.floor(b.rem / kgPu))
      if (sztuk <= 0) continue
      b.rem -= sztuk * kgPu
      zostaloSztuk -= sztuk
      przydzielone.push(b.id)
    }

    if (przydzielone.length === 0) return line
    return {
      ...line,
      seasonedBatchIds: przydzielone,
      seasonedBatchId:  przydzielone[0],
      batchesManual:    false,
    }
  })
}

/** Zdejmij znaczniki ręczne przed przeliczeniem planu od nowa.
 *  Pozycji rozpoczętych nie dotyka — one i tak zostaną nietknięte. */
export function clearManual<T extends FefoLine>(lines: T[]): T[] {
  return lines.map(l => (zamrozona(l) ? l : { ...l, batchesManual: false }))
}
```

- [ ] **Krok 4: Zielone**

Run: `npx vitest run src/features/production-plan/planFefo.test.ts`
Expected: PASS, 11 testów

- [ ] **Krok 5: Commit**

```bash
git add src/features/production-plan/planFefo.ts src/features/production-plan/planFefo.test.ts
git commit -m "feat(plan-produkcji): FEFO proponuje, czlowiek decyduje

Wyjete z PlanForm.autoAssignRecipe. Nowego jest tylko rozroznienie
'to wybral FEFO' od 'to wybral czlowiek' (batchesManual) - bez niego
nie dalo sie przeliczyc planu od nowa, nie deptajac decyzji planisty."
```

---

### Zadanie 3: `BatchPanel` — widoczny stan partii

Dziś `MeatPanel` grupuje partie per receptura, ale nie mówi, KTÓRA partia
poszła na którą pozycję. To jest jedyna informacja, po którą planista sięga,
gdy chce coś zmienić ręcznie.

**Pliki:**
- Utwórz: `src/features/production-plan/components/BatchPanel.tsx`
- Test: `src/features/production-plan/components/batchPanel.test.tsx`

**Interfejsy:**
- Konsumuje: `fmtKgTrim` z `@/lib/utils`
- Produkuje:
  - `interface BatchPanelRow { id: string; recipeId: string; recipeName: string; batchNo: string; productionDay?: string; kgFreeLive: number; usedByLines: number[] }`
  - `<BatchPanel rows={...} demandByRecipe={...} onRecalc={() => void} />`

- [ ] **Krok 1: Test, który pada**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BatchPanel, type BatchPanelRow } from './BatchPanel'

/**
 * Panel partii ma odpowiadać na dwa pytania planisty: czy starczy mięsa
 * i która partia poszła na którą pozycję. Bez tego drugiego ręczna zmiana
 * przydziału jest zgadywanką.
 */
const ROWS: BatchPanelRow[] = [
  { id: 'b1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '495',
    productionDay: '2026-08-22', kgFreeLive: 0,    usedByLines: [1] },
  { id: 'b2', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '496',
    productionDay: '2026-08-22', kgFreeLive: 664,  usedByLines: [3] },
  { id: 'b3', recipeId: 'r2', recipeName: 'BULLI',   batchNo: '496',
    productionDay: '2026-08-22', kgFreeLive: 1220, usedByLines: [] },
]

afterEach(cleanup)

describe('BatchPanel', () => {
  it('grupuje partie po recepturze', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('grupa-r1')).toBeTruthy()
    expect(screen.getByTestId('grupa-r2')).toBeTruthy()
  })

  it('mówi, która partia poszła na którą pozycję', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1/)).toBeTruthy()
  })

  it('partia nietknięta nie udaje przypisanej', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b3')).queryByText(/poz\./)).toBeNull()
  })

  it('brak mięsa na recepturę widać PRZED zapisem', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 5000 } }} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('brak-r1').textContent).toContain('4336')
  })

  it('gdy mięsa starczy, nie straszy brakiem', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 100 } }} onRecalc={vi.fn()} />)
    expect(screen.queryByTestId('brak-r1')).toBeNull()
  })

  it('„Przelicz FEFO od nowa" woła wołającego', () => {
    const onRecalc = vi.fn()
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={onRecalc} />)
    fireEvent.click(screen.getByRole('button', { name: /Przelicz FEFO/ }))
    expect(onRecalc).toHaveBeenCalled()
  })
})
```

- [ ] **Krok 2: Czerwone**

Run: `npx vitest run src/features/production-plan/components/batchPanel.test.tsx`
Expected: FAIL — brak modułu `./BatchPanel`

- [ ] **Krok 3: Napisz komponent**

Wymagania wynikające wprost z testów:
`data-testid="grupa-<recipeId>"` na grupie, `data-testid="partia-<id>"` na
wierszu partii, `poz. N` przy partii zajętej przez pozycje (`usedByLines`),
`data-testid="brak-<recipeId>"` z liczbą brakujących kilogramów, gdy
`demandByRecipe[r].kg` przekracza sumę `kgFreeLive` grupy, oraz przycisk
`Przelicz FEFO od nowa` wołający `onRecalc`. Kilogramy przez `fmtKgTrim`.

- [ ] **Krok 4: Zielone**

Run: `npx vitest run src/features/production-plan/components/batchPanel.test.tsx`
Expected: PASS, 6 testów

- [ ] **Krok 5: Commit**

```bash
git add src/features/production-plan/components/BatchPanel.tsx src/features/production-plan/components/batchPanel.test.tsx
git commit -m "feat(plan-produkcji): panel partii mowi, ktora partia na ktora pozycje"
```

---

### Zadanie 4: `PlanLinesTable` — pozycje w stałych kolumnach

**Pliki:**
- Utwórz: `src/features/production-plan/components/PlanLinesTable.tsx`
- Test: `src/features/production-plan/components/planLinesTable.test.tsx`

**Interfejsy:**
- Konsumuje: `fmtKgTrim`
- Produkuje:
  - `interface PlanLineRow { qty: string; kgPerUnit: string; productTypeName: string; recipeName: string; clientName: string; batchNos: string[]; frozen: boolean }`
  - `<PlanLinesTable rows={...} editingIdx={number|null} onEdit={(i)=>void} onRemove={(i)=>void} />`

- [ ] **Krok 1: Test, który pada**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { PlanLinesTable, type PlanLineRow } from './PlanLinesTable'

const ROWS: PlanLineRow[] = [
  { qty: '20', kgPerUnit: '35', productTypeName: 'Kebab drobiowy',
    recipeName: 'WROCŁAW', clientName: 'Bulli', batchNos: ['495'], frozen: false },
  { qty: '12', kgPerUnit: '8,5', productTypeName: 'Kebab z indyka',
    recipeName: 'BULLI', clientName: '', batchNos: [], frozen: true },
]

afterEach(cleanup)

describe('PlanLinesTable', () => {
  it('ma nagłówek kolumn', () => {
    render(<PlanLinesTable rows={ROWS} editingIdx={null} onEdit={vi.fn()} onRemove={vi.fn()} />)
    const h = screen.getByTestId('plan-head')
    for (const k of ['Rodzaj', 'Receptura', 'Klient', 'Partie', 'Razem'])
      expect(within(h).getByText(k)).toBeTruthy()
  })

  it('kilogramy bez ozdobnego zera', () => {
    render(<PlanLinesTable rows={ROWS} editingIdx={null} onEdit={vi.fn()} onRemove={vi.fn()} />)
    const w = screen.getAllByTestId('plan-line')[0]
    expect(within(w).getByTestId('plan-ilosc').textContent).toBe('20×35')
    expect(within(w).getByTestId('plan-razem').textContent).toContain('700')
  })

  it('pozycja bez partii nie udaje przypisanej', () => {
    render(<PlanLinesTable rows={ROWS} editingIdx={null} onEdit={vi.fn()} onRemove={vi.fn()} />)
    const w = screen.getAllByTestId('plan-line')[1]
    expect(within(w).getByTestId('plan-partie').textContent).toBe('—')
  })

  it('pozycji rozpoczętej nie da się usunąć', () => {
    render(<PlanLinesTable rows={ROWS} editingIdx={null} onEdit={vi.fn()} onRemove={vi.fn()} />)
    const w = screen.getAllByTestId('plan-line')[1]
    expect(within(w).queryByTitle(/Usuń/)).toBeNull()
  })

  it('brak klienta to myślnik, nie pustka', () => {
    render(<PlanLinesTable rows={ROWS} editingIdx={null} onEdit={vi.fn()} onRemove={vi.fn()} />)
    const w = screen.getAllByTestId('plan-line')[1]
    expect(within(w).getByTestId('plan-klient').textContent).toBe('—')
  })
})
```

- [ ] **Krok 2: Czerwone** — `npx vitest run src/features/production-plan/components/planLinesTable.test.tsx`
- [ ] **Krok 3: Napisz komponent** wg testów: `data-testid` jak wyżej, kolumny
      Lp · Ilość · Rodzaj · Receptura · Klient · Partie · Razem · akcje,
      szerokości nagłówka i wierszy IDENTYCZNE, `frozen` bez kosza.
- [ ] **Krok 4: Zielone** — 5 testów
- [ ] **Krok 5: Commit** — `feat(plan-produkcji): pozycje planu w stalych kolumnach`

---

### Zadanie 5: `PlanTerminal` — pasek wsadu

**Pliki:**
- Utwórz: `src/features/production-plan/components/PlanTerminal.tsx`
- Test: `src/features/production-plan/components/planTerminal.test.tsx`

**Interfejsy:**
- Konsumuje: `ComboField`, `NumberField` z `@/components/terminal/fields` (Zadanie 1)
- Produkuje: `<PlanTerminal productTypes={} recipes={} packaging={} clients={} onCommit={(line)=>void} />`,
  gdzie `line` ma kształt `PlanLineForm` bez `id`

- [ ] **Krok 1: Test, który pada** — sprawdza to samo, co kontrakt zamówień:
      `⏎` na ostatnim polu dopisuje pozycję; rodzaj/receptura/tuleja/klient
      **zostają** w polach, czyszczą się wyłącznie sztuki i waga; lista wyboru
      rozwija się dopiero po napisaniu, `↓` albo kliknięciu.
- [ ] **Krok 2: Czerwone** — `npx vitest run src/features/production-plan/components/planTerminal.test.tsx`
- [ ] **Krok 3: Napisz komponent** — kolejność slotów:
      `productTypeId → recipeId → packagingId → clientId → qty → kgPerUnit`
- [ ] **Krok 4: Zielone**
- [ ] **Krok 5: Commit** — `feat(plan-produkcji): pasek wsadu pod klawiature`

---

### Zadanie 6: `usePlanDraft` — stan szkicu

Przeniesienie stanu z `PlanForm` (linie 1093–1256) bez zmiany zachowania,
plus wpięcie `assignFefo`/`clearManual` z Zadania 2.

**Pliki:**
- Utwórz: `src/features/production-plan/usePlanDraft.ts`
- Test: `src/features/production-plan/usePlanDraft.test.ts`

**Interfejsy:**
- Konsumuje: `allocatePlanMeat`, `withOwnReservations`, `assignFefo`, `clearManual`
- Produkuje: `usePlanDraft({ initialPlan, seasoned, recipes })` zwracające
  `{ lines, planDate, setPlanDate, addLine, setLine, removeLine, markManual, recalcFefo, planAlloc, demandByRecipe, batchRows, totalKg }`

- [ ] **Krok 1: Test, który pada** — na czystych funkcjach pomocniczych hooka
      (`buildBatchRows`, `demandByRecipe`), wyjętych obok jako eksporty:
      zapotrzebowanie schodzi przy wpisaniu szt × kg i wraca po usunięciu
      pozycji; receptury komponentowe (70/30) zostają POZA mapą; `batchRows`
      niesie `usedByLines` z `planAlloc.usedByBatch`.
- [ ] **Krok 2: Czerwone**
- [ ] **Krok 3: Napisz hook** — komentarze o własnych rezerwacjach przy edycji
      i o zamrożonych pozycjach przenieś 1:1 z `PlanForm`.
- [ ] **Krok 4: Zielone**
- [ ] **Krok 5: Commit** — `feat(plan-produkcji): stan szkicu w usePlanDraft`

---

### Zadanie 7: `PlanEditor` — złożenie ekranu

**Pliki:**
- Utwórz: `src/features/production-plan/PlanEditor.tsx`
- Zmień: `src/pages/office/ProductionPlanEditorPage.tsx` (renderuje `PlanEditor`)
- Zmień: `src/pages/office/ProductionPlanningPage.tsx` (usuń `PlanForm`,
  `LineFormRow`, `PlanLineQuickAdd`, `MeatPanel` — zastąpione)
- Test: `src/features/production-plan/planEditor.test.tsx`

**Interfejsy:**
- Konsumuje: wszystko z Zadań 2–6

- [ ] **Krok 1: Test, który pada** — wybór daty wczytuje istniejący plan
      tego dnia do edycji zamiast pozwolić na drugi plan; pozycja dopisana
      terminalem od razu dostaje partie FEFO; „Przelicz FEFO od nowa" nie
      rusza pozycji rozpoczętej.
- [ ] **Krok 2: Czerwone**
- [ ] **Krok 3: Złóż ekran** — układ: nagłówek z datą i przyciskiem
      „Wciągnij z zamówień (N)" (licznik tylko gdy N > 0), pasek wsadu,
      pod nim `PlanLinesTable` i `BatchPanel` w dwóch kolumnach.
- [ ] **Krok 4: Zielone + pełny zestaw**

Run: `npx vitest run` — Expected: wszystko zielone
Run: `npx tsc --noEmit -p tsconfig.json` — Expected: exit 0

- [ ] **Krok 5: Commit** — `feat(plan-produkcji): terminal dnia zamiast formularza`

---

### Zadanie 8: `PullFromOrders` — wciąganie zamówień

**Pliki:**
- Utwórz: `src/features/production-plan/components/PullFromOrders.tsx`
  (na bazie `ImportOrderModal`, linie 254–503 starej strony)
- Usuń: `ImportOrderModal` ze starej strony
- Test: `src/features/production-plan/components/pullFromOrders.test.tsx`

- [ ] **Krok 1: Test, który pada** — panel pokazuje wyłącznie niezrealizowane
      pozycje zamówień potwierdzonych; wciągnięta pozycja zachowuje
      `clientOrderId` i `clientOrderLineId`; licznik na przycisku znika,
      gdy nie ma czego wciągać.
- [ ] **Krok 2: Czerwone**
- [ ] **Krok 3: Napisz panel**
- [ ] **Krok 4: Zielone + pełny zestaw + tsc**
- [ ] **Krok 5: Commit** — `feat(plan-produkcji): wciaganie pozycji z zamowien`

---

### Zadanie 9: Sprzątanie i wydanie

- [ ] **Krok 1:** sprawdź, że `ProductionPlanningPage.tsx` schudła —
      `wc -l src/pages/office/ProductionPlanningPage.tsx` ma pokazać
      wyraźnie mniej niż 2123 linie; martwe importy usuń.
- [ ] **Krok 2:** `npx vitest run` — wszystko zielone.
- [ ] **Krok 3:** `npx tsc --noEmit -p tsconfig.json` — exit 0.
- [ ] **Krok 4:** `npm run build` — build przechodzi.
- [ ] **Krok 5:** bump wersji biura w `package.json`, `src-tauri/Cargo.toml`,
      `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`; commit
      `chore(release): Kebab MES <wersja>`; push; po zielonym CI
      `deploy/deploy.sh frontend` na produkcji **z maszyny produkcyjnej**
      i `deploy/smoke.sh`; tag `v<wersja>` dla instalatora biura.
      Kiosku hali to nie dotyczy — plan produkcji jest ekranem biurowym.

---

## Samosprawdzenie planu

**Pokrycie spec-a:** przeniesienie pól (Zad. 1) · FEFO z furtką ręczną
i zamrożeniem (Zad. 2, 6) · panel partii z `→ poz. N` i brakami (Zad. 3) ·
kolumny pozycji (Zad. 4) · pasek wsadu (Zad. 5) · jeden plan na dzień
(Zad. 7) · dwa wejścia (Zad. 5 + 8) · rozbicie pliku (Zad. 1–8, sprawdzone
w Zad. 9) · `fmtKgTrim` (ograniczenia globalne). Naprawa wielokrotnego
`allocatePlanMeat` per wiersz znika wraz z `LineFormRow` (Zad. 7).

**Spójność nazw:** `assignFefo`/`clearManual` (Zad. 2) używane w Zad. 6 i 7;
`BatchPanelRow.usedByLines` (Zad. 3) produkowane przez `buildBatchRows`
(Zad. 6); `PlanLineRow` (Zad. 4) składany w `PlanEditor` (Zad. 7);
pola terminala pod `@/components/terminal/fields` (Zad. 1) konsumowane
w Zad. 5.

**Zakres:** jeden podsystem — edytor planu. Backend poza zakresem.
