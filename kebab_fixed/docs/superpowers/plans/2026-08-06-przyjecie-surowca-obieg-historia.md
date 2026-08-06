# Przyjęcie surowca — „W obiegu" / „Historia dostaw" — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UWAGA dla tego repo:** subagenty NIE mają prawa zapisu do `src/lib/`,
> `src/components/` ani `src/features/` — implementacja musi iść **inline**
> (executing-plans). Patrz `docs/superpowers/specs/2026-08-06-przyjecie-surowca-obieg-historia-design.md`.

**Goal:** Rozdzielić stronę „Przyjęcie surowca" na sekcję „W obiegu" (dostawy z resztą surowca, z alarmami terminów) i „Historia dostaw" (rozliczone i anulowane, bez alarmów), z datą przyjęcia, czytelnymi statusami cyklu życia dostawy i sortowaniem od najnowszej.

**Architecture:** Zmiana wyłącznie frontendowa. Cała logika decyzyjna ląduje w czystych funkcjach (`src/lib/utils/fefo.ts` + nowy `src/features/raw-batches/deliveryView.ts`) pokrytych vitest; komponenty zostają cienkie. `RawBatchesTable` pozostaje jednym komponentem sterowanym propem `variant` (`'live'` / `'history'`).

**Tech Stack:** React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, vitest (środowisko `node`, `include: ['src/**/*.test.ts']`).

## Global Constraints

- **Zero zmian w backendzie, bazie i API.** Wszystkie pola już przychodzą z `GET /raw-batches` i są mapowane w `src/lib/api.ts:153` (`mapRawBatch`).
- **Nie ruszać istniejącej `deriveRawBatchStatus`** w `src/lib/utils/fefo.ts:231` — używa jej `DashboardPage.tsx:337` i `computeDisplayStatus`. Nowa logika to nowa funkcja obok.
- **Vitest widzi tylko `src/**/*.test.ts`** (nie `.tsx`) i działa w środowisku `node` bez DOM. Testy pisać wyłącznie dla czystych funkcji; komponenty weryfikować przez `npx tsc --noEmit` i wzrokowo.
- **Znacznik ważności (`ExpiryBadge`) renderować wyłącznie gdy `kgAvailable > 0`.** Data ważności zawsze widoczna jako tekst.
- Etykiety statusów po polsku, wielkimi literami, przez `STATUS_META` w `src/components/ui/badge.tsx` — jedno źródło prawdy dla etykiet i tonów.
- Formatowanie dat wyłącznie przez `fmtDatePl` z `@/lib/utils`, kilogramów przez `fmtKg`, cen przez `fmtPln`.
- Commit po każdym zadaniu, wiadomości po polsku bez polskich znaków w pierwszej linii (konwencja repo), stopka `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `src/lib/utils/fefo.ts` (modyfikacja) | + `DeliveryStatus`, `deriveDeliveryStatus()` — status cyklu życia dostawy, czysta domena |
| `src/lib/utils/fefo.test.ts` (modyfikacja) | testy `deriveDeliveryStatus` |
| `src/features/raw-batches/deliveryView.ts` (nowy) | czysta logika widoku: podział na sekcje, sortowanie, filtr historii, klucz znacznika, liczebniki |
| `src/features/raw-batches/deliveryView.test.ts` (nowy) | testy powyższego |
| `src/components/ui/badge.tsx` (modyfikacja) | 7 nowych kluczy w `STATUS_META` |
| `src/features/raw-batches/components/RawBatchesTable.tsx` (przepisanie) | tabela w dwóch wariantach: kolumny, sort, filtry historii, blokada edycji |
| `src/features/raw-batches/pages/RawBatchesPage.tsx` (modyfikacja) | dwie sekcje z nagłówkami i podsumowaniem |

---

### Task 1: Status cyklu życia dostawy (`deriveDeliveryStatus`)

**Files:**
- Modify: `src/lib/utils/fefo.ts` (dopisać na końcu sekcji „4. DERIVED STATUS", po `deriveRawBatchStatus`, ok. linia 241)
- Test: `src/lib/utils/fefo.test.ts`

**Interfaces:**
- Consumes: nic (pierwsze zadanie)
- Produces:
  - `export type DeliveryStatus = 'cancelled' | 'awaiting' | 'in_progress' | 'processed'`
  - `export function deriveDeliveryStatus(batch: { status?: string; kgReceived: number | string; kgAvailable: number | string }): DeliveryStatus`

- [ ] **Step 1: Dopisz testy do `src/lib/utils/fefo.test.ts`**

Dopisz na końcu pliku (i dodaj `deriveDeliveryStatus` do listy importów z `'./fefo'` na górze pliku):

```ts
describe('deriveDeliveryStatus', () => {
  const d = (over: Partial<{ status: string; kgReceived: number; kgAvailable: number }>) =>
    ({ kgReceived: 1000, kgAvailable: 1000, ...over })

  it('nietknieta dostawa czeka na przetworzenie', () => {
    expect(deriveDeliveryStatus(d({}))).toBe('awaiting')
  })

  it('napoczeta dostawa jest w toku', () => {
    expect(deriveDeliveryStatus(d({ kgAvailable: 400 }))).toBe('in_progress')
  })

  it('zerowy stan = przetworzona', () => {
    expect(deriveDeliveryStatus(d({ kgAvailable: 0 }))).toBe('processed')
  })

  it('ujemny stan (korekta w dol) tez liczy sie jako przetworzona', () => {
    expect(deriveDeliveryStatus(d({ kgAvailable: -5 }))).toBe('processed')
  })

  it('stan wyzszy niz przyjeto (korekta w gore) to nadal awaiting', () => {
    expect(deriveDeliveryStatus(d({ kgAvailable: 1200 }))).toBe('awaiting')
  })

  it('anulowana wygrywa nawet gdy zostal surowiec', () => {
    expect(deriveDeliveryStatus(d({ status: 'cancelled', kgAvailable: 800 }))).toBe('cancelled')
  })

  it('anulowana wygrywa nawet gdy stan zerowy', () => {
    expect(deriveDeliveryStatus(d({ status: 'cancelled', kgAvailable: 0 }))).toBe('cancelled')
  })

  it('przyjmuje stringi z backendu (numeric psycopg2)', () => {
    expect(deriveDeliveryStatus({ kgReceived: '1000.000', kgAvailable: '0.000' })).toBe('processed')
    expect(deriveDeliveryStatus({ kgReceived: '1000.000', kgAvailable: '250.500' })).toBe('in_progress')
  })

  it('status inny niz cancelled nie zmienia wyniku', () => {
    expect(deriveDeliveryStatus(d({ status: 'active', kgAvailable: 0 }))).toBe('processed')
  })
})
```

- [ ] **Step 2: Uruchom testy — muszą paść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test -- src/lib/utils/fefo.test.ts`
Expected: FAIL — `deriveDeliveryStatus is not exported` / `is not a function`

- [ ] **Step 3: Dopisz implementację w `src/lib/utils/fefo.ts`**

Wstaw bezpośrednio po zamknięciu `deriveRawBatchStatus` (ok. linia 241):

```ts
/**
 * DeliveryStatus — status CYKLU ŻYCIA DOSTAWY (nie stanu HACCP).
 *
 * Odpowiada na pytanie „co się stało z tą dostawą", a nie „czy nadaje się
 * do produkcji" (od tego jest deriveRawBatchStatus, którego NIE zastępuje —
 * używa go Dashboard i widoki magazynowe).
 *
 *   awaiting    — nietknięta, czeka (ćwiartka: na rozbiór; reszta: leży na magazynie)
 *   in_progress — napoczęta, część już zeszła
 *   processed   — rozliczona, stan zerowy
 *   cancelled   — anulowane przyjęcie (soft-delete)
 */
export type DeliveryStatus = 'cancelled' | 'awaiting' | 'in_progress' | 'processed'

/**
 * deriveDeliveryStatus — status dostawy wyliczony z danych, bez pola w bazie.
 *
 * Kolejność rozstrzygania jest istotna: anulowanie wygrywa ze wszystkim
 * (anulowana dostawa z resztą kg to sytuacja do wyjaśnienia, nie „w obiegu"),
 * potem stan zerowy, potem napoczęcie.
 *
 * Kilogramy przychodzą z backendu jako stringi (psycopg2 numeric) — stąd Number().
 */
export function deriveDeliveryStatus(batch: {
  status?:      string
  kgReceived:   number | string
  kgAvailable:  number | string
}): DeliveryStatus {
  if (batch.status === 'cancelled') return 'cancelled'

  const available = Number(batch.kgAvailable)
  const received  = Number(batch.kgReceived)

  if (available <= 0)       return 'processed'
  if (available < received) return 'in_progress'
  return 'awaiting'
}
```

- [ ] **Step 4: Uruchom testy — muszą przejść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test -- src/lib/utils/fefo.test.ts`
Expected: PASS, wszystkie testy pliku (stare `deriveRawBatchStatus` też — nie wolno ich ruszyć)

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/lib/utils/fefo.ts src/lib/utils/fefo.test.ts
git commit -m "feat(przyjecie): status cyklu zycia dostawy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Czysta logika widoku (`deliveryView.ts`)

**Files:**
- Create: `src/features/raw-batches/deliveryView.ts`
- Test: `src/features/raw-batches/deliveryView.test.ts`

**Interfaces:**
- Consumes: `DeliveryStatus`, `deriveDeliveryStatus` z `@/lib/utils/fefo` (Task 1)
- Produces:
  - `export interface DeliveryLike { internalBatchNo?: string; internalBatchSeq?: number; supplierName?: string; supplierBatchNo?: string; receivedDate?: string; slaughterDate?: string; expiryDate?: string; kgReceived: number | string; kgAvailable: number | string; status?: string }`
  - `export type DeliverySortCol = 'internalBatchNo' | 'supplierName' | 'receivedDate' | 'slaughterDate' | 'expiryDate' | 'kgReceived' | 'kgAvailable'`
  - `export type SortDir = 'asc' | 'desc'`
  - `export type HistoryPeriod = 30 | 90 | 0`
  - `export function splitDeliveries<T extends DeliveryLike>(rows: T[]): { live: T[]; history: T[] }`
  - `export function sortDeliveries<T extends DeliveryLike>(rows: T[], col: DeliverySortCol, dir: SortDir): T[]`
  - `export function filterHistory<T extends DeliveryLike>(rows: T[], opts: { query?: string; period?: HistoryPeriod; showCancelled?: boolean; today?: string }): T[]`
  - `export function deliveryStatusBadgeKey(status: DeliveryStatus, requiresDeboning: boolean): string`
  - `export function liveSummary<T extends DeliveryLike>(rows: T[]): { count: number; kg: number }`
  - `export function pluralDostawy(n: number): string`

- [ ] **Step 1: Napisz testy — `src/features/raw-batches/deliveryView.test.ts`**

```ts
/**
 * Testy czystej logiki widoku Przyjęcia surowca.
 * Daty podawane jawnie (parametr `today`) — zero zależności od zegara.
 */
import { describe, it, expect } from 'vitest'
import {
  splitDeliveries,
  sortDeliveries,
  filterHistory,
  deliveryStatusBadgeKey,
  liveSummary,
  pluralDostawy,
  type DeliveryLike,
} from './deliveryView'

function batch(over: Partial<DeliveryLike> = {}): DeliveryLike {
  return {
    internalBatchNo:  '400',
    internalBatchSeq: 400,
    supplierName:     'Drob-Pol',
    supplierBatchNo:  'DP/1',
    receivedDate:     '2026-08-01',
    slaughterDate:    '2026-07-30',
    expiryDate:       '2026-08-06',
    kgReceived:       1000,
    kgAvailable:      0,
    status:           'active',
    ...over,
  }
}

describe('splitDeliveries', () => {
  it('dostawa z resztą surowca trafia do obiegu', () => {
    const { live, history } = splitDeliveries([batch({ kgAvailable: 250 })])
    expect(live).toHaveLength(1)
    expect(history).toHaveLength(0)
  })

  it('dostawa rozliczona trafia do historii', () => {
    const { live, history } = splitDeliveries([batch({ kgAvailable: 0 })])
    expect(live).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('anulowana trafia do historii nawet z resztą kg', () => {
    const { live, history } = splitDeliveries([
      batch({ status: 'cancelled', kgAvailable: 800 }),
    ])
    expect(live).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('zachowuje kolejność wejściową w obu koszykach', () => {
    const { live, history } = splitDeliveries([
      batch({ internalBatchNo: '1', kgAvailable: 10 }),
      batch({ internalBatchNo: '2', kgAvailable: 0 }),
      batch({ internalBatchNo: '3', kgAvailable: 20 }),
      batch({ internalBatchNo: '4', kgAvailable: 0 }),
    ])
    expect(live.map(b => b.internalBatchNo)).toEqual(['1', '3'])
    expect(history.map(b => b.internalBatchNo)).toEqual(['2', '4'])
  })
})

describe('sortDeliveries', () => {
  it('po dacie przyjęcia malejąco — najnowsza pierwsza', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', receivedDate: '2026-08-01' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
      batch({ internalBatchNo: 'C', receivedDate: '2026-08-03' }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['B', 'C', 'A'])
  })

  it('przy tej samej dacie przyjęcia wyżej wyższy numer partii', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: '463', internalBatchSeq: 463, receivedDate: '2026-08-06' }),
      batch({ internalBatchNo: '464', internalBatchSeq: 464, receivedDate: '2026-08-06' }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['464', '463'])
  })

  it('numery partii porównuje liczbowo, nie tekstowo (9 < 100)', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: '100', internalBatchSeq: 100 }),
      batch({ internalBatchNo: '9',   internalBatchSeq: 9 }),
    ], 'internalBatchNo', 'asc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['9', '100'])
  })

  it('kilogramy porównuje liczbowo mimo stringów z backendu', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', kgReceived: '900.000' }),
      batch({ internalBatchNo: 'B', kgReceived: '1200.000' }),
    ], 'kgReceived', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['B', 'A'])
  })

  it('nie mutuje tablicy wejściowej', () => {
    const rows = [
      batch({ internalBatchNo: 'A', receivedDate: '2026-08-01' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
    ]
    sortDeliveries(rows, 'receivedDate', 'desc')
    expect(rows.map(b => b.internalBatchNo)).toEqual(['A', 'B'])
  })

  it('puste daty lądują na końcu przy sortowaniu malejącym', () => {
    const out = sortDeliveries([
      batch({ internalBatchNo: 'A', receivedDate: '' }),
      batch({ internalBatchNo: 'B', receivedDate: '2026-08-06' }),
    ], 'receivedDate', 'desc')
    expect(out.map(b => b.internalBatchNo)).toEqual(['B', 'A'])
  })
})

describe('filterHistory', () => {
  const rows = [
    batch({ internalBatchNo: '464', receivedDate: '2026-08-06', supplierName: 'Drob-Pol', supplierBatchNo: 'DP/77' }),
    batch({ internalBatchNo: '430', receivedDate: '2026-07-20', supplierName: 'Animex',   supplierBatchNo: 'AX/12' }),
    batch({ internalBatchNo: '300', receivedDate: '2026-05-01', supplierName: 'Drob-Pol', supplierBatchNo: 'DP/01' }),
    batch({ internalBatchNo: '299', receivedDate: '2026-07-25', status: 'cancelled' }),
  ]

  it('domyślnie ukrywa anulowane', () => {
    const out = filterHistory(rows, { period: 0, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).not.toContain('299')
  })

  it('pokazuje anulowane po włączeniu', () => {
    const out = filterHistory(rows, { period: 0, showCancelled: true, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).toContain('299')
  })

  it('okres 30 dni odcina starsze dostawy', () => {
    const out = filterHistory(rows, { period: 30, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).toEqual(['464', '430'])
  })

  it('okres 90 dni obejmuje majową dostawę', () => {
    const out = filterHistory(rows, { period: 90, today: '2026-08-06' })
    expect(out.map(b => b.internalBatchNo)).toEqual(['464', '430', '300'])
  })

  it('okres 0 znaczy wszystko', () => {
    const out = filterHistory(rows, { period: 0, today: '2026-08-06' })
    expect(out).toHaveLength(3)
  })

  it('granica okresu jest domknięta — dokładnie 30 dni wstecz wchodzi', () => {
    const out = filterHistory([batch({ internalBatchNo: 'X', receivedDate: '2026-07-07' })],
      { period: 30, today: '2026-08-06' })
    expect(out).toHaveLength(1)
  })

  it('szuka po numerze partii, dostawcy i numerze dostawcy', () => {
    const opts = { period: 0, today: '2026-08-06' }
    expect(filterHistory(rows, { ...opts, query: '430' }).map(b => b.internalBatchNo)).toEqual(['430'])
    expect(filterHistory(rows, { ...opts, query: 'animex' }).map(b => b.internalBatchNo)).toEqual(['430'])
    expect(filterHistory(rows, { ...opts, query: 'dp/77' }).map(b => b.internalBatchNo)).toEqual(['464'])
  })

  it('szukanie jest niewrażliwe na wielkość liter', () => {
    const out = filterHistory(rows, { period: 0, query: 'DROB-POL', today: '2026-08-06' })
    expect(out).toHaveLength(2)
  })

  it('dostawa bez daty przyjęcia nie znika przy filtrze okresu', () => {
    const out = filterHistory([batch({ internalBatchNo: 'Z', receivedDate: '' })],
      { period: 30, today: '2026-08-06' })
    expect(out).toHaveLength(1)
  })
})

describe('deliveryStatusBadgeKey', () => {
  it('rozbiór — etykiety rozbiorowe', () => {
    expect(deliveryStatusBadgeKey('awaiting', true)).toBe('delivery_awaiting_deboning')
    expect(deliveryStatusBadgeKey('in_progress', true)).toBe('delivery_in_progress_deboning')
    expect(deliveryStatusBadgeKey('processed', true)).toBe('delivery_processed_deboning')
  })

  it('bez rozbioru — etykiety magazynowe', () => {
    expect(deliveryStatusBadgeKey('awaiting', false)).toBe('delivery_awaiting_stock')
    expect(deliveryStatusBadgeKey('in_progress', false)).toBe('delivery_in_progress_stock')
    expect(deliveryStatusBadgeKey('processed', false)).toBe('delivery_processed_stock')
  })

  it('anulowana ma jeden klucz niezależnie od rodzaju surowca', () => {
    expect(deliveryStatusBadgeKey('cancelled', true)).toBe('delivery_cancelled')
    expect(deliveryStatusBadgeKey('cancelled', false)).toBe('delivery_cancelled')
  })
})

describe('liveSummary', () => {
  it('liczy dostawy i sumuje pozostałe kilogramy', () => {
    const out = liveSummary([
      batch({ kgAvailable: '1485.000' }),
      batch({ kgAvailable: 515 }),
    ])
    expect(out).toEqual({ count: 2, kg: 2000 })
  })

  it('pusty obieg to zero, nie NaN', () => {
    expect(liveSummary([])).toEqual({ count: 0, kg: 0 })
  })
})

describe('pluralDostawy', () => {
  it('odmienia po polsku', () => {
    expect(pluralDostawy(1)).toBe('dostawa')
    expect(pluralDostawy(2)).toBe('dostawy')
    expect(pluralDostawy(4)).toBe('dostawy')
    expect(pluralDostawy(5)).toBe('dostaw')
    expect(pluralDostawy(0)).toBe('dostaw')
    expect(pluralDostawy(12)).toBe('dostaw')
    expect(pluralDostawy(22)).toBe('dostawy')
    expect(pluralDostawy(21)).toBe('dostaw')
    expect(pluralDostawy(101)).toBe('dostaw')
  })
})
```

- [ ] **Step 2: Uruchom testy — muszą paść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test -- src/features/raw-batches/deliveryView.test.ts`
Expected: FAIL — `Failed to load ./deliveryView` (plik nie istnieje)

- [ ] **Step 3: Napisz implementację — `src/features/raw-batches/deliveryView.ts`**

```ts
/**
 * deliveryView — czysta logika widoku „Przyjęcie surowca".
 *
 * Strona odpowiada na dwa różne pytania: „co jeszcze leży w chłodni"
 * (sekcja W obiegu) i „co przyjęliśmy w lipcu" (Historia dostaw). Podział,
 * sortowanie i filtry siedzą tutaj — komponenty tylko renderują.
 *
 * Zero importów z React/UI: to ma się dać przetestować w vitest (środowisko
 * node, bez DOM) i w razie potrzeby użyć w druku albo eksporcie.
 */
import { deriveDeliveryStatus, type DeliveryStatus } from '@/lib/utils/fefo'

/** Minimalny kształt wiersza dostawy. Strukturalnie spełnia go RawBatch —
 *  celowo nie importujemy typu encji, żeby ten moduł dało się użyć także na
 *  danych z innego źródła (np. surowy wynik API). */
export interface DeliveryLike {
  internalBatchNo?:  string
  internalBatchSeq?: number
  supplierName?:     string
  supplierBatchNo?:  string
  receivedDate?:     string
  slaughterDate?:    string
  expiryDate?:       string
  kgReceived:        number | string
  kgAvailable:       number | string
  status?:           string
}

export type DeliverySortCol =
  | 'internalBatchNo' | 'supplierName' | 'receivedDate'
  | 'slaughterDate'   | 'expiryDate'   | 'kgReceived' | 'kgAvailable'

export type SortDir = 'asc' | 'desc'

/** Okres historii w dniach; 0 = bez ograniczenia. */
export type HistoryPeriod = 30 | 90 | 0

/**
 * splitDeliveries — rozdziela dostawy na żywe i zamknięte.
 *
 * W obiegu = został surowiec I dostawa nie jest anulowana. Anulowana z resztą
 * kg to anomalia do wyjaśnienia w kartotece, nie pozycja operacyjna — idzie
 * do historii, gdzie widać ją ze znacznikiem ANULOWANA.
 */
export function splitDeliveries<T extends DeliveryLike>(rows: T[]): { live: T[]; history: T[] } {
  const live: T[] = []
  const history: T[] = []
  for (const r of rows) {
    if (deriveDeliveryStatus(r) === 'awaiting' || deriveDeliveryStatus(r) === 'in_progress') live.push(r)
    else history.push(r)
  }
  return { live, history }
}

/** Numer partii jako liczba do porównań (ANUL-… → sekwencja). */
function batchSortKey(b: DeliveryLike): number {
  const fromNo = Number(String(b.internalBatchNo ?? '').replace(/\D/g, ''))
  if (Number.isFinite(fromNo) && fromNo > 0) return fromNo
  return Number(b.internalBatchSeq ?? 0)
}

/** Puste daty na koniec listy niezależnie od kierunku — brak daty to brak
 *  informacji, a nie „najstarsza dostawa świata". */
function cmpDate(a?: string, b?: string): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

/**
 * sortDeliveries — sortowanie kolumnowe. Nie mutuje wejścia.
 *
 * Przy równej dacie przyjęcia rozstrzyga numer partii malejąco: dwie dostawy
 * z tego samego dnia mają pokazać się w kolejności przyjmowania, od ostatniej.
 */
export function sortDeliveries<T extends DeliveryLike>(
  rows: T[], col: DeliverySortCol, dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (col) {
      case 'internalBatchNo': cmp = batchSortKey(a) - batchSortKey(b); break
      case 'supplierName':    cmp = (a.supplierName ?? '').localeCompare(b.supplierName ?? '', 'pl'); break
      case 'receivedDate':    cmp = cmpDate(a.receivedDate, b.receivedDate); break
      case 'slaughterDate':   cmp = cmpDate(a.slaughterDate, b.slaughterDate); break
      case 'expiryDate':      cmp = cmpDate(a.expiryDate, b.expiryDate); break
      case 'kgReceived':      cmp = Number(a.kgReceived) - Number(b.kgReceived); break
      case 'kgAvailable':     cmp = Number(a.kgAvailable) - Number(b.kgAvailable); break
    }
    if (cmp !== 0) return sign * cmp
    // Tie-break: zawsze numerem partii, w tym samym kierunku co sort główny.
    return sign * (batchSortKey(a) - batchSortKey(b))
  })
}

/** Data sprzed `days` dni w formacie ISO 'YYYY-MM-DD'. */
function isoDaysAgo(todayIsoDate: string, days: number): string {
  const t = new Date(`${todayIsoDate}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() - days)
  return t.toISOString().slice(0, 10)
}

/**
 * filterHistory — szukajka + okres + anulowane.
 *
 * Dostawa bez daty przyjęcia NIGDY nie wypada przez filtr okresu — brak daty
 * (stare rekordy) nie może chować dokumentu przed audytem.
 */
export function filterHistory<T extends DeliveryLike>(
  rows: T[],
  opts: { query?: string; period?: HistoryPeriod; showCancelled?: boolean; today?: string },
): T[] {
  const { query = '', period = 30, showCancelled = false } = opts
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const from  = period > 0 ? isoDaysAgo(today, period) : null
  const q     = query.trim().toLowerCase()

  return rows.filter(r => {
    if (!showCancelled && r.status === 'cancelled') return false
    if (from && r.receivedDate && r.receivedDate.slice(0, 10) < from) return false
    if (!q) return true
    return (
      String(r.internalBatchNo ?? '').toLowerCase().includes(q) ||
      String(r.supplierName    ?? '').toLowerCase().includes(q) ||
      String(r.supplierBatchNo ?? '').toLowerCase().includes(q)
    )
  })
}

/**
 * deliveryStatusBadgeKey — klucz do STATUS_META w components/ui/badge.tsx.
 *
 * Ten sam status znaczy co innego dla ćwiartki (idzie na rozbiór) i dla
 * fileta czy mięsa z/s (leży na magazynie i idzie prosto do masowania).
 */
export function deliveryStatusBadgeKey(status: DeliveryStatus, requiresDeboning: boolean): string {
  if (status === 'cancelled') return 'delivery_cancelled'
  return `delivery_${status}_${requiresDeboning ? 'deboning' : 'stock'}`
}

/** Podsumowanie nagłówka sekcji „W obiegu". */
export function liveSummary<T extends DeliveryLike>(rows: T[]): { count: number; kg: number } {
  return {
    count: rows.length,
    kg:    rows.reduce((s, r) => s + Number(r.kgAvailable), 0),
  }
}

/** Liczebnik: 1 dostawa · 2 dostawy · 5 dostaw · 22 dostawy · 101 dostaw. */
export function pluralDostawy(n: number): string {
  if (n === 1) return 'dostawa'
  const last    = n % 10
  const lastTwo = n % 100
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'dostawy'
  return 'dostaw'
}
```

- [ ] **Step 4: Uruchom testy — muszą przejść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test -- src/features/raw-batches/deliveryView.test.ts`
Expected: PASS — wszystkie bloki `describe`

- [ ] **Step 5: Uruchom cały zestaw testów**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test`
Expected: PASS — nic wcześniejszego się nie wywróciło

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/raw-batches/deliveryView.ts src/features/raw-batches/deliveryView.test.ts
git commit -m "feat(przyjecie): czysta logika podzialu i filtrow dostaw

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Etykiety statusów dostawy w `STATUS_META`

**Files:**
- Modify: `src/components/ui/badge.tsx` (mapa `STATUS_META`, ok. linia 99–125)

**Interfaces:**
- Consumes: klucze produkowane przez `deliveryStatusBadgeKey` (Task 2)
- Produces: `<StatusBadge status="delivery_awaiting_deboning" />` itd. renderuje polską etykietę z właściwym tonem

- [ ] **Step 1: Dopisz wpisy do `STATUS_META`**

W `src/components/ui/badge.tsx`, w mapie `STATUS_META`, bezpośrednio pod blokiem
„— magazyn / partie —" (po linii z `QUARANTINE:`) wstaw:

```tsx
  // — cykl życia DOSTAWY (Przyjęcie surowca) —
  // Ten sam status ma inną nazwę zależnie od tego, czy surowiec idzie na
  // rozbiór (ćwiartka), czy prosto na magazyn mięsa (filet, mięso z/s).
  delivery_awaiting_deboning:    { label: 'DO ROZBIORU',      tone: 'blue'  },
  delivery_awaiting_stock:       { label: 'NA MAGAZYNIE',     tone: 'blue'  },
  delivery_in_progress_deboning: { label: 'W ROZBIORZE',      tone: 'amber' },
  delivery_in_progress_stock:    { label: 'CZĘŚCIOWO ZUŻYTA', tone: 'amber' },
  delivery_processed_deboning:   { label: 'ROZEBRANA',        tone: 'gray'  },
  delivery_processed_stock:      { label: 'ZUŻYTA',           tone: 'gray'  },
  delivery_cancelled:            { label: 'ANULOWANA',        tone: 'red'   },
```

- [ ] **Step 2: Sprawdź typy**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak błędów (`tone` musi być jedną z wartości `StatusTone`: `green|amber|red|gray|blue`)

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/components/ui/badge.tsx
git commit -m "feat(ui): etykiety statusow dostawy surowca

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Tabela dostaw w dwóch wariantach

**Files:**
- Modify (przepisanie całości): `src/features/raw-batches/components/RawBatchesTable.tsx`

**Interfaces:**
- Consumes: `splitDeliveries` nie tutaj (robi to strona); `sortDeliveries`, `filterHistory`, `deliveryStatusBadgeKey`, `DeliverySortCol`, `SortDir`, `HistoryPeriod` z `../deliveryView` (Task 2); `deriveDeliveryStatus` z `@/lib/utils/fefo` (Task 1); klucze `STATUS_META` (Task 3)
- Produces:
  ```ts
  interface RawBatchesTableProps {
    batches: RawBatch[]
    loading: boolean
    variant?: 'live' | 'history'   // domyślnie 'live'
    requiresDeboning?: boolean     // domyślnie true (ćwiartka)
    emptyTitle?: string
    emptyHint?: string
    onEdit?: (batch: RawBatch) => void
    onCancel?: (batch: RawBatch) => void
  }
  ```

- [ ] **Step 1: Zastąp całą zawartość pliku**

```tsx
/**
 * RawBatchesTable — tabela dostaw surowca (strona „Przyjęcie surowca").
 *
 * Jeden komponent, dwa warianty:
 *   variant='live'    — sekcja „W obiegu": dostawy, w których został surowiec.
 *                       Znacznik ważności jest tu prawdziwym alarmem, więc go
 *                       pokazujemy; są też akcje edycji/usunięcia.
 *   variant='history' — „Historia dostaw": rozliczone i anulowane. Zero
 *                       alarmów (termin partii zużytej nic już nie znaczy),
 *                       za to pasek filtrów: szukaj / okres / anulowane.
 *
 * Dwóch osobnych komponentów świadomie NIE robimy — rozjechałyby się przy
 * pierwszej zmianie kolumn.
 */
import { useState, useMemo } from 'react'
import { ExpiryBadge, StatusBadge } from '@/components/ui/badge'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
import { deriveDeliveryStatus } from '@/lib/utils/fefo'
import { batchDisplayNo } from '../batchDisplayNo'
import {
  sortDeliveries, filterHistory, deliveryStatusBadgeKey,
  type DeliverySortCol, type SortDir, type HistoryPeriod,
} from '../deliveryView'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { CardDescription, CardTitle } from '@/components/ui/card'
import type { RawBatch } from '@/types'
import { Package, ChevronDown, ChevronUp, ChevronsUpDown, Search, Pencil, Trash2 } from 'lucide-react'

interface RawBatchesTableProps {
  batches:           RawBatch[]
  loading:           boolean
  /** 'live' = W obiegu (alarmy + akcje), 'history' = Historia (filtry, bez alarmów) */
  variant?:          'live' | 'history'
  /** Ćwiartka idzie na rozbiór; filet i mięso z/s prosto na magazyn — inne etykiety statusów */
  requiresDeboning?: boolean
  emptyTitle?:       string
  emptyHint?:        string
  onEdit?:           (batch: RawBatch) => void
  onCancel?:         (batch: RawBatch) => void
}

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: 30, label: '30 dni' },
  { value: 90, label: '90 dni' },
  { value: 0,  label: 'Wszystko' },
]

export function RawBatchesTable({
  batches, loading,
  variant = 'live',
  requiresDeboning = true,
  emptyTitle, emptyHint,
  onEdit, onCancel,
}: RawBatchesTableProps) {
  const isLive = variant === 'live'

  const [filter,  setFilter]  = useState('')
  const [period,  setPeriod]  = useState<HistoryPeriod>(30)
  const [showCancelled, setShowCancelled] = useState(false)
  // Domyślnie od najnowszej dostawy — pytanie „co ostatnio przyszło" jest
  // częstsze niż „co najszybciej wygasa" (od tego jest Magazyn surowca).
  const [sortCol, setSortCol] = useState<DeliverySortCol>('receivedDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (col: DeliverySortCol) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: DeliverySortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
      : <ChevronsUpDown size={11} className="opacity-30" />

  const displayed = useMemo(() => {
    const base = isLive
      ? batches
      : filterHistory(batches, { query: filter, period, showCancelled })
    return sortDeliveries(base, sortCol, sortDir)
  }, [batches, isLive, filter, period, showCancelled, sortCol, sortDir])

  const HEADERS: { col: DeliverySortCol | null; label: string; right?: boolean }[] = [
    { col: 'internalBatchNo', label: 'Nr partii' },
    { col: 'supplierName',    label: 'Dostawca' },
    { col: null,              label: 'Nr dostawcy' },
    { col: 'receivedDate',    label: 'Przyjęto' },
    { col: 'slaughterDate',   label: 'Ubój' },
    { col: 'expiryDate',      label: 'Ważność' },
    { col: 'kgReceived',      label: 'Przyjęto kg', right: true },
    { col: 'kgAvailable',     label: 'Zostało kg',  right: true },
    { col: null,              label: 'Cena/kg',     right: true },
    { col: null,              label: 'Status' },
    ...(isLive ? [{ col: null, label: '' }] : []),
  ]

  if (loading) {
    return (
      <div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {HEADERS.map(h => (
                <TableHead key={h.label} className="text-xs uppercase tracking-wide whitespace-nowrap">
                  {h.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2].map(i => (
              <TableRow key={i} className="hover:bg-transparent">
                {HEADERS.map(h => (
                  <TableCell key={h.label}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <div className="text-muted-foreground opacity-20 mb-1"><Package size={36} /></div>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {emptyTitle ?? 'Brak dostaw'}
        </CardTitle>
        {emptyHint && (
          <CardDescription className="text-xs text-center max-w-sm">{emptyHint}</CardDescription>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Pasek filtrów — tylko historia. W obiegu bywa 1–3 wiersze, filtr byłby ozdobą. */}
      {!isLive && (
        <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-3 flex-wrap">
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Filtruj partię, dostawcę…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>

          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.label}
                onClick={() => setPeriod(p.value)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                  period === p.value
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-ink-2 border-surface-4 hover:border-primary/50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand,#171717)]"
              checked={showCancelled}
              onChange={e => setShowCancelled(e.target.checked)}
            />
            Pokaż anulowane
          </label>

          <CardDescription className="text-xs ml-auto">
            {displayed.length} z {batches.length}
          </CardDescription>
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Search size={28} className="text-muted-foreground opacity-20" />
          <CardDescription>Brak dostaw dla wybranych filtrów</CardDescription>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {HEADERS.map(h => (
                h.col ? (
                  <TableHead
                    key={h.label}
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort(h.col as DeliverySortCol)}
                  >
                    <div className={`flex items-center gap-1 ${h.right ? 'justify-end' : ''}`}>
                      {h.label}
                      <SortIcon col={h.col as DeliverySortCol} />
                    </div>
                  </TableHead>
                ) : (
                  <TableHead
                    key={h.label}
                    className={`text-xs uppercase tracking-wide whitespace-nowrap ${h.right ? 'text-right' : ''}`}
                  >
                    {h.label}
                  </TableHead>
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map(b => {
              const kgLeft = Number(b.kgAvailable)
              const status = deriveDeliveryStatus(b)
              // Alarm terminu ma sens tylko dla surowca, który jeszcze leży.
              // Data ważności zostaje widoczna zawsze — audyt HACCP jej potrzebuje.
              const showExpiryAlarm = kgLeft > 0 && status !== 'cancelled'
              // Backend nie ma kolumny kg_used (mapper ustawia 0 dla wszystkich),
              // więc zużycie liczymy z różnicy. Edytować wolno tylko dostawę nietkniętą.
              const untouched = kgLeft >= Number(b.kgReceived)
              const canEdit = untouched && b.status !== 'cancelled' && !b.isInUse

              return (
                <TableRow key={b.id} className={status === 'cancelled' ? 'opacity-60' : undefined}>
                  <TableCell>
                    <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">
                      {batchDisplayNo(b)}
                    </code>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="max-w-[140px] truncate">{b.supplierName ?? '—'}</CardDescription>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{b.supplierBatchNo}</code>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="whitespace-nowrap font-medium text-foreground">
                      {fmtDatePl(b.receivedDate)}
                    </CardDescription>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="whitespace-nowrap">{fmtDatePl(b.slaughterDate)}</CardDescription>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <CardDescription>{fmtDatePl(b.expiryDate)}</CardDescription>
                      {showExpiryAlarm && <ExpiryBadge dateStr={b.expiryDate} />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <CardDescription className="font-semibold tabular-nums text-foreground">
                      {fmtKg(b.kgReceived)} kg
                    </CardDescription>
                  </TableCell>
                  <TableCell className="text-right">
                    {kgLeft > 0 ? (
                      <span className={`font-bold tabular-nums text-sm ${
                        status === 'cancelled' ? 'text-muted-foreground' : 'text-foreground'
                      }`}>
                        {fmtKg(kgLeft)} kg
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <code className="font-mono text-xs text-muted-foreground">{fmtPln(b.pricePerKg)}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={deliveryStatusBadgeKey(status, requiresDeboning)} />
                  </TableCell>
                  {isLive && (
                    <TableCell>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          {onEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                              onClick={() => onEdit(b)}
                              title="Edytuj"
                            >
                              <Pencil size={13} />
                            </Button>
                          )}
                          {onCancel && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => onCancel(b)}
                              title="Usuń przyjęcie"
                            >
                              <Trash2 size={13} />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Sprawdź typy**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak błędów. Jeśli pojawi się błąd o `RawBatch` nie spełniającym
`DeliveryLike` — sprawdź, czy pola w `DeliveryLike` są opcjonalne tam, gdzie
w `RawBatch` mogą być `undefined` (`supplierName`, `supplierBatchNo`).

- [ ] **Step 3: Uruchom testy jednostkowe**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/raw-batches/components/RawBatchesTable.tsx
git commit -m "feat(przyjecie): tabela dostaw w wariantach obieg/historia

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Dwie sekcje na stronie Przyjęcia surowca

**Files:**
- Modify: `src/features/raw-batches/pages/RawBatchesPage.tsx` (importy na górze + blok „Tabela", ok. linie 199–204)

**Interfaces:**
- Consumes: `splitDeliveries`, `liveSummary`, `pluralDostawy` z `../deliveryView` (Task 2); `RawBatchesTable` z propami `variant` / `requiresDeboning` / `emptyTitle` / `emptyHint` (Task 4)
- Produces: gotowy widok — nic dalej z tego nie korzysta

- [ ] **Step 1: Dodaj importy**

W `src/features/raw-batches/pages/RawBatchesPage.tsx`, pod istniejącym
importem `RawBatchesTable` (linia 18):

```tsx
import { splitDeliveries, liveSummary, pluralDostawy } from '../deliveryView'
```

- [ ] **Step 2: Policz sekcje**

Bezpośrednio pod definicją `matBatches` (ok. linia 55) dopisz:

```tsx
  // Dwie perspektywy tej samej listy: co jeszcze leży w chłodni (W obiegu)
  // i co już rozliczone (Historia). Alarmy terminów żyją tylko w pierwszej.
  const { live, history } = useMemo(() => splitDeliveries(matBatches), [matBatches])
  const summary = useMemo(() => liveSummary(live), [live])
```

- [ ] **Step 3: Zastąp blok tabeli dwiema sekcjami**

Zamień cały blok `{/* Tabela */}` (`<Card><CardContent className="p-0"><RawBatchesTable …/></CardContent></Card>`) na:

```tsx
      {/* Sekcja 1 — dostawy z resztą surowca */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-xs uppercase tracking-[0.08em] text-ink-2">W obiegu</CardTitle>
          <CardDescription className="text-xs tabular-nums">
            {summary.count} {pluralDostawy(summary.count)} · {fmtKg(summary.kg)} kg
          </CardDescription>
        </div>
        <Card>
          <CardContent className="p-0">
            <RawBatchesTable
              batches={live}
              loading={loading}
              variant="live"
              requiresDeboning={selMat?.requiresDeboning ?? true}
              emptyTitle="Brak surowca w obiegu"
              emptyHint={`Wszystkie dostawy (${selMat?.name ?? 'surowiec'}) są rozliczone — historia poniżej.`}
              onEdit={handleEditOpen}
              onCancel={handleCancelOpen}
            />
          </CardContent>
        </Card>
      </div>

      {/* Sekcja 2 — zamknięta historia, bez alarmów terminów */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-xs uppercase tracking-[0.08em] text-ink-2">Historia dostaw</CardTitle>
          <CardDescription className="text-xs tabular-nums">
            {history.length} {pluralDostawy(history.length)}
          </CardDescription>
        </div>
        <Card>
          <CardContent className="p-0">
            <RawBatchesTable
              batches={history}
              loading={loading}
              variant="history"
              requiresDeboning={selMat?.requiresDeboning ?? true}
              emptyTitle="Brak zamkniętych dostaw"
              emptyHint="Rozliczone i anulowane przyjęcia pojawią się tutaj."
            />
          </CardContent>
        </Card>
      </div>
```

- [ ] **Step 4: Sprawdź typy**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak błędów. `fmtKg` i `useMemo` są już zaimportowane w tym pliku
(linie 4 i 22) — nie dodawaj ich drugi raz.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/raw-batches/pages/RawBatchesPage.tsx
git commit -m "feat(przyjecie): sekcje W obiegu i Historia dostaw

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Weryfikacja końcowa

**Files:** brak zmian (chyba że coś wyjdzie)

**Interfaces:**
- Consumes: wszystko z zadań 1–5
- Produces: potwierdzenie, że gałąź jest gotowa

- [ ] **Step 1: Pełny zestaw testów**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test`
Expected: PASS — wszystkie pliki, w tym `fefo.test.ts` i `deliveryView.test.ts`

- [ ] **Step 2: Typy**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: brak wyjścia

- [ ] **Step 3: Build produkcyjny**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run build`
Expected: `built in …` bez błędów

- [ ] **Step 4: Sprawdzenie wzrokowe**

Uruchom `npm run dev`, wejdź na `/office/raw-batches` i potwierdź:

1. Zakładka **Ćwiartka**: sekcja „W obiegu" pokazuje partię **464** ze statusem
   **W ROZBIORZE** (1 485 kg z 4 305) i znacznikiem terminu; nagłówek mówi
   „1 dostawa · 1 485,00 kg".
2. Historia zaczyna się od **463** i idzie w dół numerami — nigdzie w historii
   nie ma czerwonego znacznika „Wygasła", ale **data ważności jest widoczna**.
3. Kolumna **Przyjęto** ma daty w formacie `dd.mm.rrrr`.
4. Filtr okresu: „30 dni" pokazuje mniej pozycji niż „Wszystko";
   „Pokaż anulowane" dokłada wiersze ze statusem **ANULOWANA**.
5. Zakładka **Filet z kurczaka**: sekcja „W obiegu" jest pusta z komunikatem,
   historia pokazuje status **ZUŻYTA** (nie „ROZEBRANA").
6. Ikony edycji/usunięcia **nie pojawiają się** na żadnym wierszu historii,
   a w obiegu tylko na dostawie nietkniętej.

- [ ] **Step 5: Przegląd kodu**

Uruchom skilla `superpowers:requesting-code-review` na diffie gałęzi względem
punktu wyjścia (`git diff 208671b..HEAD`). Popraw, co wyjdzie, i dopiero potem
raportuj gotowość.

---

## Poza zakresem

- Rozróżnienie „rozebrana" vs „sprzedana WZ" (wymagałoby ruchów magazynowych
  per wiersz; jest w kartotece partii po kliknięciu).
- Sumy miesięczne i porównania okresów — miejsce w Analityce.
- Magazyn surowca i pozostałe strony używające `deriveRawBatchStatus`.
- Zmiany w backendzie, bazie i API.
