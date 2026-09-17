# Panel masowania — plan wdrożeniowy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel masowni na komputer panelowy (kiosk Tauri), w którym wybór mięsa szanuje partie wskazane przez biuro w planie masowania.

**Architecture:** Nowe wejście kiosku (`masowanie.html`) obok istniejących, ekran złożony z czystych funkcji (`src/features/masownia/`) i komponentów React. Backend dostaje dwie nowe encje — pojemnik z przyprawami i wsad w masownicy — a księgowanie masowania zostaje w istniejącym `finish_mixing_session`.

**Tech Stack:** React 18 + TypeScript + Vite (kiosk Tauri 2), FastAPI + psycopg2 + PostgreSQL, vitest (front), pytest (backend), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-09-17-panel-masowania-design.md`

## Global Constraints

- Masownice: **1 → 200 kg, 2 → 200 kg, 3 → 600 kg**. System po cichu przepuszcza **+60 kg** ponad nominał, ale zapasu **NIGDY nie pokazuje na ekranie**.
- Cykl masowania: **50 minut**. Panel odlicza czas do końca masowania; fazy chłodzenia nie pokazuje.
- Tolerancja wagi przypraw: **0,05 kg** na sztywno. Tolerancja dozownika wody: **±3%, minimum 0,5 L**.
- Pojemniki na przyprawy: numery **1–6**, na stałe.
- Słownictwo hali: „wymieszane" (nie „zmasowane"), „wsyp składniki z pojemnika 2", „przyprawy" (NIE „prochy"). Przyciski: „OK" / „Zatwierdź" (nie „Widzę").
- `kgAvailable` z `mapMeatStock` to już `kg_free` (netto) — **nie odejmować `kgReserved` drugi raz**.
- `create_stock_movement(OUT, meat)` waliduje żywy stan: ruch **przed** dekrementem `kg_available`.
- `logger.info(..., extra={...})` — żadnych zarezerwowanych kluczy `LogRecord` (`name`, `module`, `filename`, `lineno`, `message`, `args`, `exc_info`, `process`, `thread`).
- Testy DB: pełny `TEST_DATABASE_URL`, **jeden przebieg pytest naraz** (równoległy TRUNCATE kasuje dane drugiemu).
- Front: `npm test` = `TZ=UTC vitest run`, `npm run typecheck` = `tsc --noEmit`.

---

### Task 1: Kafelki mięsa — składanie z palet i partii

**Files:**
- Create: `src/features/masownia/meatTiles.ts`
- Test: `src/features/masownia/meatTiles.test.ts`

**Interfaces:**
- Consumes: nic (pierwszy task).
- Produces:
  - `type MeatTile = { key: string; kind: 'pallet' | 'lot'; palletNo: string; palletId: string; lots: { lotNo: string; meatStockId: string; kg: number }[]; kgFree: number; expiryDate: string; materialName: string; mixed: boolean }`
  - `buildMeatTiles(input: MeatTilesInput): MeatTile[]`
  - `type MeatTilesInput = { pallets: TilePallet[]; lots: TileLot[]; taken: Record<string, number> }`
  - `type TilePallet = { id: string; palletNo: string; kgNet: number; expiryDate: string; lots: { lotNo: string; kg: number }[] }`
  - `type TileLot = { meatStockId: string; lotNo: string; materialName: string; kgFree: number; expiryDate: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/masownia/meatTiles.test.ts
/**
 * Kafelki mięsa na panelu masowania — czysta logika, bez DOM i bez sieci.
 */
import { describe, it, expect } from 'vitest'
import { buildMeatTiles, type TileLot, type TilePallet } from './meatTiles'

const lot = (over: Partial<TileLot> = {}): TileLot => ({
  meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s',
  kgFree: 1800, expiryDate: '2026-09-03', ...over,
})

const pallet = (over: Partial<TilePallet> = {}): TilePallet => ({
  id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-09-03',
  lots: [{ lotNo: '511', kg: 200 }], ...over,
})

describe('buildMeatTiles', () => {
  it('robi kafelek z palety i zostawia resztę partii na paleciak', () => {
    const tiles = buildMeatTiles({ pallets: [pallet()], lots: [lot({ kgFree: 500 })], taken: {} })
    expect(tiles.map(t => [t.kind, t.kgFree])).toEqual([['pallet', 200], ['lot', 300]])
  })

  it('paleta częściowo pobrana pokazuje tylko to, co zostało', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet()], lots: [lot({ kgFree: 200 })], taken: { p1: 140 },
    })
    expect(tiles.find(t => t.kind === 'pallet')!.kgFree).toBe(60)
  })

  it('paleta pobrana do zera znika z ekranu', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet()], lots: [lot({ kgFree: 0 })], taken: { p1: 200 },
    })
    expect(tiles).toEqual([])
  })

  it('partia bez palet (filet z mostka) dostaje kafelek paleciaka', () => {
    const tiles = buildMeatTiles({
      pallets: [],
      lots: [lot({ meatStockId: 'ms-524', lotNo: '524', materialName: 'Filet z mostka wołowego', kgFree: 600 })],
      taken: {},
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ kind: 'lot', kgFree: 600, materialName: 'Filet z mostka wołowego', mixed: false })
  })

  it('paleta z dwóch partii jest oznaczona jako mieszana', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet({ lots: [{ lotNo: '511', kg: 60 }, { lotNo: '512', kg: 140 }] })],
      lots: [lot({ kgFree: 60 }), lot({ meatStockId: 'ms-512', lotNo: '512', kgFree: 140 })],
      taken: {},
    })
    const p = tiles.find(t => t.kind === 'pallet')!
    expect(p.mixed).toBe(true)
    expect(p.lots.map(l => l.lotNo)).toEqual(['511', '512'])
  })

  it('kafelek partii nie schodzi poniżej zera, gdy palety biorą więcej niż wolne kg', () => {
    // Partia 524: kg_available=0 przy kg_reserved=600 — rezerwacja biura.
    const tiles = buildMeatTiles({
      pallets: [pallet({ lots: [{ lotNo: '524', kg: 200 }] })],
      lots: [lot({ meatStockId: 'ms-524', lotNo: '524', kgFree: 0 })],
      taken: {},
    })
    expect(tiles.filter(t => t.kind === 'lot')).toEqual([])
  })

  it('wiąże paletę z meat_stock po numerze partii', () => {
    const tiles = buildMeatTiles({ pallets: [pallet()], lots: [lot()], taken: {} })
    expect(tiles[0].lots[0].meatStockId).toBe('ms-511')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/meatTiles.test.ts`
Expected: FAIL — `Failed to resolve import "./meatTiles"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/masownia/meatTiles.ts
/**
 * Kafelki mięsa na panelu masowania.
 *
 * Jedno źródło prawdy to partie magazynu (`meat_stock`) — mięso z rozbioru
 * i mięso kupione z zewnątrz (z/s, filet z mostka, indyk) leżą tam tak samo,
 * więc zakup pokazuje się sam. Palety z ważenia zbiorczego są tylko warstwą
 * fizyczną: tam, gdzie hala zważyła mięso na paletę, operator dotyka palety;
 * gdzie nie zważyła, dotyka partii i wpisuje kg z paleciaka.
 */

export interface TilePallet {
  id: string
  palletNo: string
  kgNet: number
  expiryDate: string
  lots: { lotNo: string; kg: number }[]
}

export interface TileLot {
  meatStockId: string
  lotNo: string
  materialName: string
  /** Wolne kilogramy partii. To już `kg_free` z backendu (netto) — NIE
   *  odejmować rezerwacji drugi raz (pułapka powtórzona 3× w tym module). */
  kgFree: number
  expiryDate: string
}

export interface MeatTile {
  key: string
  kind: 'pallet' | 'lot'
  palletId: string
  palletNo: string
  lots: { lotNo: string; meatStockId: string; kg: number }[]
  kgFree: number
  expiryDate: string
  materialName: string
  mixed: boolean
}

export interface MeatTilesInput {
  pallets: TilePallet[]
  lots: TileLot[]
  /** Ile kg zdjęły z palety wsady już załadowane: palletId → kg. */
  taken: Record<string, number>
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function buildMeatTiles({ pallets, lots, taken }: MeatTilesInput): MeatTile[] {
  const byLotNo = new Map(lots.map(l => [l.lotNo, l]))
  const tiles: MeatTile[] = []
  /** Ile kg partii siedzi na paletach, które jeszcze stoją wolne. */
  const naPaletach = new Map<string, number>()

  for (const p of pallets) {
    const wolne = round1(p.kgNet - (taken[p.id] ?? 0))
    if (wolne <= 0) continue
    const udzial = p.kgNet > 0 ? wolne / p.kgNet : 0
    const skladniki = p.lots.map(l => ({
      lotNo: l.lotNo,
      meatStockId: byLotNo.get(l.lotNo)?.meatStockId ?? '',
      kg: round1(l.kg * udzial),
    }))
    for (const s of skladniki) {
      naPaletach.set(s.lotNo, (naPaletach.get(s.lotNo) ?? 0) + s.kg)
    }
    tiles.push({
      key: `pallet:${p.id}`,
      kind: 'pallet',
      palletId: p.id,
      palletNo: p.palletNo,
      lots: skladniki,
      kgFree: wolne,
      expiryDate: p.expiryDate,
      materialName: byLotNo.get(p.lots[0]?.lotNo ?? '')?.materialName ?? '',
      mixed: new Set(p.lots.map(l => l.lotNo)).size > 1,
    })
  }

  for (const l of lots) {
    // Kilogramy partii, których nie obejmuje żadna wolna paleta — tędy idzie
    // filet z mostka i indyk, których hala nie waży zbiorczo.
    const pozaPaletami = round1(l.kgFree - (naPaletach.get(l.lotNo) ?? 0))
    if (pozaPaletami <= 0) continue
    tiles.push({
      key: `lot:${l.meatStockId}`,
      kind: 'lot',
      palletId: '',
      palletNo: '',
      lots: [{ lotNo: l.lotNo, meatStockId: l.meatStockId, kg: pozaPaletami }],
      kgFree: pozaPaletami,
      expiryDate: l.expiryDate,
      materialName: l.materialName,
      mixed: false,
    })
  }

  return tiles
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/meatTiles.test.ts`
Expected: PASS — 7 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia/meatTiles.ts kebab_fixed/src/features/masownia/meatTiles.test.ts
git commit -m "feat(masowanie): kafelki miesa z palet i partii bez palet"
```

---

### Task 2: Bramka partii wybranych przez biuro

**Files:**
- Create: `src/features/masownia/meatGate.ts`
- Test: `src/features/masownia/meatGate.test.ts`

**Interfaces:**
- Consumes: `MeatTile` z Task 1.
- Produces:
  - `type GatedTile = MeatTile & { allowed: boolean; reason: string }`
  - `gateMeatTiles(tiles: MeatTile[], orderLots: { meatLotNo: string }[]): GatedTile[]`
  - `officeChoiceLabel(orderLots: { meatLotNo: string }[]): string`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/masownia/meatGate.test.ts
/**
 * Bramka partii: panel puszcza tylko to mięso, które biuro wskazało w planie
 * masowania. Czysta logika — bez DOM i bez sieci.
 */
import { describe, it, expect } from 'vitest'
import { gateMeatTiles, officeChoiceLabel } from './meatGate'
import type { MeatTile } from './meatTiles'

const tile = (over: Partial<MeatTile> = {}): MeatTile => ({
  key: 'pallet:p1', kind: 'pallet', palletId: 'p1', palletNo: 'PAL/17/09/26/1',
  lots: [{ lotNo: '511', meatStockId: 'ms-511', kg: 200 }],
  kgFree: 200, expiryDate: '2026-09-03', materialName: 'Mięso z/s', mixed: false, ...over,
})

describe('gateMeatTiles', () => {
  it('bez partii w zleceniu puszcza wszystko', () => {
    // Na produkcji to częsty przypadek: 8 z 12 ostatnich zleceń nie ma partii.
    const out = gateMeatTiles([tile(), tile({ key: 'pallet:p2', lots: [{ lotNo: '513', meatStockId: 'ms-513', kg: 200 }] })], [])
    expect(out.every(t => t.allowed)).toBe(true)
    expect(out.every(t => t.reason === '')).toBe(true)
  })

  it('z partiami biura puszcza tylko wskazane', () => {
    const out = gateMeatTiles(
      [tile(), tile({ key: 'pallet:p2', lots: [{ lotNo: '513', meatStockId: 'ms-513', kg: 200 }] })],
      [{ meatLotNo: '511' }],
    )
    expect(out[0].allowed).toBe(true)
    expect(out[1].allowed).toBe(false)
  })

  it('kafelek odrzucony mówi, co wybrało biuro', () => {
    const [t] = gateMeatTiles([tile({ lots: [{ lotNo: '513', meatStockId: 'ms-513', kg: 200 }] })], [{ meatLotNo: '511' }])
    expect(t.reason).toBe('Biuro wybrało partię 511')
  })

  it('kafelki odrzucone ZOSTAJĄ na liście i w tej samej kolejności', () => {
    const wejscie = [tile({ key: 'a' }), tile({ key: 'b', lots: [{ lotNo: '999', meatStockId: 'ms-999', kg: 10 }] }), tile({ key: 'c' })]
    expect(gateMeatTiles(wejscie, [{ meatLotNo: '511' }]).map(t => t.key)).toEqual(['a', 'b', 'c'])
  })

  it('paleta mieszana przechodzi tylko wtedy, gdy OBIE partie są w planie', () => {
    const mieszana = tile({
      mixed: true,
      lots: [{ lotNo: '511', meatStockId: 'ms-511', kg: 60 }, { lotNo: '512', meatStockId: 'ms-512', kg: 140 }],
    })
    expect(gateMeatTiles([mieszana], [{ meatLotNo: '511' }])[0].allowed).toBe(false)
    expect(gateMeatTiles([mieszana], [{ meatLotNo: '511' }, { meatLotNo: '512' }])[0].allowed).toBe(true)
  })

  it('paleta mieszana odrzucona nazywa partię spoza planu', () => {
    const mieszana = tile({
      mixed: true,
      lots: [{ lotNo: '511', meatStockId: 'ms-511', kg: 60 }, { lotNo: '512', meatStockId: 'ms-512', kg: 140 }],
    })
    expect(gateMeatTiles([mieszana], [{ meatLotNo: '511' }])[0].reason).toBe('Na palecie jest też partia 512, spoza planu')
  })

  it('partia w całości zarezerwowana przez biuro przechodzi (przypadek 524)', () => {
    // 524 ma kg_available=0 przy kg_reserved=600 — kafelek powstaje ze zlecenia,
    // więc bramka nie ma prawa go odrzucić.
    const filet = tile({ key: 'lot:ms-524', kind: 'lot', palletId: '', palletNo: '',
      lots: [{ lotNo: '524', meatStockId: 'ms-524', kg: 600 }], materialName: 'Filet z mostka wołowego' })
    expect(gateMeatTiles([filet], [{ meatLotNo: '524' }])[0].allowed).toBe(true)
  })

  it('pusty numer partii u biura nie otwiera bramki', () => {
    expect(gateMeatTiles([tile()], [{ meatLotNo: '' }])[0].allowed).toBe(true)
  })
})

describe('officeChoiceLabel', () => {
  it('wylicza partie po przecinku', () => {
    expect(officeChoiceLabel([{ meatLotNo: '511' }, { meatLotNo: '512' }])).toBe('511, 512')
  })

  it('bez partii daje pusty napis', () => {
    expect(officeChoiceLabel([])).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/meatGate.test.ts`
Expected: FAIL — `Failed to resolve import "./meatGate"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/masownia/meatGate.ts
/**
 * Bramka partii — jedyna różnica panelu wobec prototypu 0.9.
 *
 * Biuro planując masowanie może wskazać partie mięsa (`mixing_order_lots`).
 * Jeśli wskazało, operator ma do wyboru TYLKO te partie; reszta zostaje na
 * ekranie, ale szara — mięso jest, tylko nie to. Jeśli biuro nie wskazało nic
 * (8 z 12 ostatnich zleceń na produkcji), wolno wziąć wszystko, co leży.
 *
 * Kafelki odrzucone nie znikają i nie przesuwają siatki: operator ma stały
 * układ ekranu i widzi, czego nie wolno, zamiast szukać znikającego kafelka.
 */
import type { MeatTile } from './meatTiles'

export interface GatedTile extends MeatTile {
  allowed: boolean
  /** Powód odmowy pod kafelkiem; pusty, gdy kafelek jest dostępny. */
  reason: string
}

export interface OrderLot {
  meatLotNo: string
}

const numery = (orderLots: OrderLot[]) =>
  orderLots.map(l => (l.meatLotNo || '').trim()).filter(Boolean)

export function officeChoiceLabel(orderLots: OrderLot[]): string {
  return numery(orderLots).join(', ')
}

export function gateMeatTiles(tiles: MeatTile[], orderLots: OrderLot[]): GatedTile[] {
  const plan = new Set(numery(orderLots))
  if (plan.size === 0) {
    return tiles.map(t => ({ ...t, allowed: true, reason: '' }))
  }
  const etykieta = officeChoiceLabel(orderLots)
  return tiles.map(t => {
    // Paleta mieszana przechodzi tylko w komplecie: jeden dotyk nie może
    // wciągnąć do wsadu partii spoza planu, bo po zamknięciu pokrywy nikt
    // tego nie odkręci.
    const spoza = t.lots.map(l => l.lotNo).filter(no => !plan.has(no))
    if (spoza.length === 0) return { ...t, allowed: true, reason: '' }
    const reason = t.lots.length > 1
      ? `Na palecie jest też partia ${spoza.join(', ')}, spoza planu`
      : `Biuro wybrało ${plan.size > 1 ? 'partie' : 'partię'} ${etykieta}`
    return { ...t, allowed: false, reason }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/meatGate.test.ts`
Expected: PASS — 10 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia/meatGate.ts kebab_fixed/src/features/masownia/meatGate.test.ts
git commit -m "feat(masowanie): bramka partii wybranych przez biuro"
```

---

### Task 3: Wsad — wielkości, zapas i numer partii

**Files:**
- Create: `src/features/masownia/machines.ts`
- Test: `src/features/masownia/machines.test.ts`

**Interfaces:**
- Consumes: nic.
- Produces:
  - `const MACHINES: { id: 1 | 2 | 3; cap: number }[]`
  - `const T_MIX_MIN = 50`, `const OVER_KG = 60`, `const TOL_SPICE_KG = 0.05`
  - `fitsMachine(kg: number, cap: number): boolean`
  - `waterWindow(targetL: number): { min: number; max: number }`
  - `batchNoFromLots(lotNos: string[], ppSeq: number): { no: string; mixed: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/masownia/machines.test.ts
import { describe, it, expect } from 'vitest'
import { MACHINES, OVER_KG, T_MIX_MIN, fitsMachine, waterWindow, batchNoFromLots } from './machines'

describe('masownice', () => {
  it('trzy maszyny: 200, 200, 600 kg', () => {
    expect(MACHINES.map(m => [m.id, m.cap])).toEqual([[1, 200], [2, 200], [3, 600]])
  })

  it('cykl masowania to 50 minut', () => {
    expect(T_MIX_MIN).toBe(50)
  })

  it('wsad mieści się do nominału plus cichy zapas', () => {
    expect(fitsMachine(600, 600)).toBe(true)
    expect(fitsMachine(630, 600)).toBe(true)
    expect(fitsMachine(600 + OVER_KG + 0.1, 600)).toBe(false)
  })
})

describe('waterWindow', () => {
  it('okno dozownika to ±3% dawki', () => {
    expect(waterWindow(100)).toEqual({ min: 97, max: 103 })
  })

  it('przy małej dawce okno nie schodzi poniżej 0,5 L', () => {
    expect(waterWindow(10)).toEqual({ min: 9.5, max: 10.5 })
  })
})

describe('batchNoFromLots', () => {
  it('jeden wsad surowca → partia nosi jego numer', () => {
    expect(batchNoFromLots(['511'], 22)).toEqual({ no: '511', mixed: false })
  })

  it('dwa wsady → wspólny numer PP', () => {
    expect(batchNoFromLots(['511', '512'], 22)).toEqual({ no: 'PP23', mixed: true })
  })

  it('ta sama partia dwa razy to wciąż jeden wsad', () => {
    expect(batchNoFromLots(['511', '511'], 22)).toEqual({ no: '511', mixed: false })
  })

  it('bez partii nie zgaduje numeru', () => {
    expect(batchNoFromLots([], 22)).toEqual({ no: '', mixed: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/machines.test.ts`
Expected: FAIL — `Failed to resolve import "./machines"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/masownia/machines.ts
/**
 * Stałe masowni potwierdzone przez halę (2026-08-27).
 */

export const MACHINES: { id: 1 | 2 | 3; cap: number }[] = [
  { id: 1, cap: 200 },
  { id: 2, cap: 200 },
  { id: 3, cap: 600 },
]

/** Minuty masowania — tyle trzyma blokada maszyny w MES. */
export const T_MIX_MIN = 50

/** Ile kg system po cichu przepuści ponad nominalny wsad.
 *  NIGDY nie pokazywane na ekranie: zdarza się wrzucić 630 kg do trójki, ale
 *  wypisanie „max 660" zrobiłoby z zapasu normę. Operator widzi 200 i 600. */
export const OVER_KG = 60

/** Tolerancja wagi przypraw — działka wagi masowni. */
export const TOL_SPICE_KG = 0.05

export function fitsMachine(kg: number, cap: number): boolean {
  return kg <= cap + OVER_KG + 1e-9
}

/** Okno dozownika DW-1C: dokładność ±3% wg producenta, węższe okno zgłaszałoby
 *  błąd, którego urządzenie i tak nie potrafi uniknąć. Minimum 0,5 L, bo
 *  działka bywa 0,1 albo 1 L. */
export function waterWindow(targetL: number): { min: number; max: number } {
  const tol = Math.max(0.5, Math.round(targetL * 0.03 * 10) / 10)
  return { min: Math.round((targetL - tol) * 10) / 10, max: Math.round((targetL + tol) * 10) / 10 }
}

/** Tożsamość partii przyprawionej: jeden wsad surowca → partia nosi jego numer
 *  (511 zostaje 511), dwa i więcej → wspólny PP{n}. Tak liczy backend
 *  (`seasoned_batch_no_from_raw`) — tu liczymy TO SAMO tylko po to, żeby
 *  pokazać numer operatorowi przed startem. */
export function batchNoFromLots(lotNos: string[], ppSeq: number): { no: string; mixed: boolean } {
  const rozne = [...new Set(lotNos.filter(Boolean))]
  if (rozne.length === 0) return { no: '', mixed: false }
  if (rozne.length === 1) return { no: rozne[0], mixed: false }
  return { no: `PP${ppSeq + 1}`, mixed: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/machines.test.ts`
Expected: PASS — 10 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia/machines.ts kebab_fixed/src/features/masownia/machines.test.ts
git commit -m "feat(masowanie): stale masowni — wsady, okno wody, numer partii"
```

---

### Task 4: Migracje — pojemniki przypraw i wsady

**Files:**
- Modify: `backend/app/migrations.py` (dopisać na KOŃCU listy `MIGRATIONS`)
- Test: `backend/tests/test_masownia_schema_db.py`

**Interfaces:**
- Consumes: nic.
- Produces: tabele `mixing_spice_carts`, `mixing_charges`, `mixing_charge_pallets`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_masownia_schema_db.py
"""Schemat panelu masowania — pojemniki z przyprawami i wsady w masownicach."""
import pytest

from app.db import query_all, query_one

pytestmark = pytest.mark.usefixtures("db")


def _kolumny(tabela):
    return {
        r["column_name"]
        for r in query_all(
            "SELECT column_name FROM information_schema.columns WHERE table_name=%s",
            (tabela,),
        )
    }


def test_pojemnik_ma_komplet_kolumn():
    assert {"id", "cart_no", "order_id", "recipe_id", "kg_target", "status",
            "ingredients", "created_at", "dumped_at", "charge_id"} <= _kolumny("mixing_spice_carts")


def test_wsad_ma_komplet_kolumn():
    assert {"id", "order_id", "machine_id", "cart_id", "kg_meat", "water_l",
            "batch_no", "status", "started_at", "finished_at", "session_id"} <= _kolumny("mixing_charges")


def test_sklad_wsadu_ma_komplet_kolumn():
    assert {"id", "charge_id", "pallet_id", "lot_no", "meat_stock_id", "kg"} <= _kolumny("mixing_charge_pallets")


def test_numer_pojemnika_jest_z_zakresu_1_6():
    # Numer pojemnika to CAŁA tożsamość odważonych przypraw — etykieta z mokrego
    # pojemnika odpada, więc numer musi być jednym z sześciu istniejących.
    check = query_one(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint "
        "WHERE conname='mixing_spice_carts_cart_no_ck'"
    )
    assert check is not None, "brak strażnika numeru pojemnika"
    assert "1" in check["def"] and "6" in check["def"]
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_schema_db.py -v
```
Expected: FAIL — brak kolumn (`AssertionError`).

- [ ] **Step 3: Write minimal implementation**

Dopisz na końcu listy `MIGRATIONS` w `backend/app/migrations.py`:

```python
    # ── Panel masowania: pojemniki z przyprawami i wsady w masownicach ──
    #
    # Masownica chodzi 50 min, więc operator odważa przyprawy na następne wsady
    # W TYM CZASIE, do ponumerowanych pojemników (numer przeżyje mycie, papierowa
    # etykieta na mokrym pojemniku odpadnie). Pojemnik rezerwuje kilogramy
    # zlecenia — inaczej operator rozpisałby dwa razy to samo.
    """CREATE TABLE IF NOT EXISTS mixing_spice_carts (
        id          TEXT PRIMARY KEY,
        cart_no     INTEGER NOT NULL,
        order_id    TEXT NOT NULL REFERENCES mixing_orders(id) ON DELETE CASCADE,
        recipe_id   TEXT NOT NULL DEFAULT '',
        kg_target   NUMERIC(10,3) NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'prepared',
        ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ DEFAULT now(),
        dumped_at   TIMESTAMPTZ,
        charge_id   TEXT,
        CONSTRAINT mixing_spice_carts_cart_no_ck CHECK (cart_no BETWEEN 1 AND 6)
    )""",
    # Jeden numer pojemnika = jedne przyprawy. Pojemnik wsypany albo anulowany
    # zwalnia numer, więc indeks obejmuje tylko te stojące.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_spice_cart_no_live "
    "ON mixing_spice_carts(cart_no) WHERE status = 'prepared'",
    "CREATE INDEX IF NOT EXISTS idx_spice_cart_order ON mixing_spice_carts(order_id)",

    # Wsad stojący w masownicy. Istnieje po to, żeby paleta znikała z ekranu
    # w chwili ZAŁADOWANIA, a nie dopiero po odbiorze — inaczej dwa wsady
    # wzięłyby tę samą paletę.
    """CREATE TABLE IF NOT EXISTS mixing_charges (
        id          TEXT PRIMARY KEY,
        order_id    TEXT NOT NULL REFERENCES mixing_orders(id) ON DELETE CASCADE,
        machine_id  INTEGER NOT NULL,
        cart_id     TEXT,
        kg_meat     NUMERIC(10,3) NOT NULL DEFAULT 0,
        water_l     NUMERIC(10,3) NOT NULL DEFAULT 0,
        batch_no    TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'mixing',
        started_at  TIMESTAMPTZ DEFAULT now(),
        finished_at TIMESTAMPTZ,
        session_id  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_mixing_charges_status ON mixing_charges(status)",
    "CREATE INDEX IF NOT EXISTS idx_mixing_charges_order ON mixing_charges(order_id)",
    # Jedna masownica = jeden wsad naraz.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_mixing_charges_machine_live "
    "ON mixing_charges(machine_id) WHERE status = 'mixing'",

    """CREATE TABLE IF NOT EXISTS mixing_charge_pallets (
        id            TEXT PRIMARY KEY,
        charge_id     TEXT NOT NULL REFERENCES mixing_charges(id) ON DELETE CASCADE,
        pallet_id     TEXT,
        lot_no        TEXT NOT NULL DEFAULT '',
        meat_stock_id TEXT,
        kg            NUMERIC(12,3) NOT NULL DEFAULT 0
    )""",
    "CREATE INDEX IF NOT EXISTS idx_charge_pallets_charge ON mixing_charge_pallets(charge_id)",
    "CREATE INDEX IF NOT EXISTS idx_charge_pallets_pallet ON mixing_charge_pallets(pallet_id)",
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
DATABASE_URL="$TEST_DATABASE_URL" python3 -c "from app.migrations import run_migrations; run_migrations()"
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_schema_db.py -v
```
Expected: PASS — 4 testy.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/tests/test_masownia_schema_db.py
git commit -m "feat(masowanie): tabele pojemnikow z przyprawami i wsadow"
```

---

### Task 5: Endpoint mięsa dla panelu

**Files:**
- Create: `backend/app/services/masownia_service.py`
- Create: `backend/app/routes/masownia.py`
- Modify: `backend/app/main.py` (rejestracja routera obok `meat_pallets`)
- Test: `backend/tests/test_masownia_mieso_db.py`

**Interfaces:**
- Consumes: tabele z Task 4.
- Produces:
  - `masownia_service.list_meat() -> dict` z kluczami `pallets`, `lots`, `taken`
  - `GET /api/masownia/mieso`

Kształt odpowiedzi (klucze w snake_case, front mapuje jak resztę API):

```json
{
  "pallets": [{"id": "...", "pallet_no": "PAL/17/09/26/1", "kg_net": 200.0,
               "expiry_date": "2026-09-03", "lots": [{"lot_no": "511", "kg": 200.0}]}],
  "lots":    [{"meat_stock_id": "ms-511", "lot_no": "511", "material_name": "Mięso z/s",
               "kg_free": 1800.0, "expiry_date": "2026-09-03"}],
  "taken":   {"<pallet_id>": 140.0}
}
```

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_masownia_mieso_db.py
"""Mięso dla panelu masowania: palety, partie i to, co zdjęły wsady."""
import pytest

from app.db import execute
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _partia(lot_no, material="Mięso z/s", kg_free=1000.0, kg_reserved=0.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (ms_id, lot_no, material, kg_free + kg_reserved, kg_free + kg_reserved,
         kg_reserved, "2026-09-17", "2026-10-01"),
    )
    return ms_id


def _paleta(pallet_no, kg_net, lots):
    pid = cuid()
    execute(
        "INSERT INTO meat_pallets (id, pallet_no, target_kg, kg_net, containers, "
        "production_date, expiry_date) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (pid, pallet_no, kg_net, kg_net, 0, "2026-09-17", "2026-10-01"),
    )
    for i, (lot_no, kg) in enumerate(lots):
        execute(
            "INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) VALUES (%s,%s,%s,%s,%s)",
            (cuid(), pid, lot_no, kg, i),
        )
    return pid


def test_zwraca_palety_i_partie():
    _partia("511")
    _paleta("PAL/17/09/26/1", 200, [("511", 200)])
    out = svc.list_meat()
    assert [p["pallet_no"] for p in out["pallets"]] == ["PAL/17/09/26/1"]
    assert [l["lot_no"] for l in out["lots"]] == ["511"]


def test_partia_kupiona_z_zewnatrz_tez_jest_na_liscie():
    # Filet z mostka i indyk nie przechodzą przez rozbiór i nie jadą na paletach,
    # a mimo to je mieszamy — muszą być widoczne.
    _partia("524", material="Filet z mostka wołowego", kg_free=600.0)
    out = svc.list_meat()
    assert any(l["material_name"] == "Filet z mostka wołowego" for l in out["lots"])


def test_partia_w_calosci_zarezerwowana_NIE_znika():
    # Partia 524 na produkcji: kg_available=0 przy kg_reserved=600, bo biuro
    # zaplanowało ją w całości. Panel MUSI ją pokazać.
    _partia("524", material="Filet z mostka wołowego", kg_free=0.0, kg_reserved=600.0)
    out = svc.list_meat()
    assert [l["lot_no"] for l in out["lots"]] == ["524"]


def test_wsad_zdejmuje_kilogramy_z_palety():
    _partia("511")
    pid = _paleta("PAL/17/09/26/1", 200, [("511", 200)])
    ch = cuid()
    execute(
        "INSERT INTO mixing_charges (id, order_id, machine_id, kg_meat, status) "
        "VALUES (%s, NULL, 1, 140, 'mixing')",
        (ch,),
    )
    execute(
        "INSERT INTO mixing_charge_pallets (id, charge_id, pallet_id, lot_no, kg) "
        "VALUES (%s,%s,%s,%s,%s)",
        (cuid(), ch, pid, "511", 140),
    )
    assert svc.list_meat()["taken"][pid] == 140.0


def test_paleta_zdjeta_nie_istnieje_dla_hali():
    _partia("511")
    pid = _paleta("PAL/17/09/26/9", 200, [("511", 200)])
    execute("UPDATE meat_pallets SET deleted_at=now() WHERE id=%s", (pid,))
    assert svc.list_meat()["pallets"] == []
```

> Uwaga dla wykonawcy: w `test_wsad_zdejmuje_kilogramy_z_palety` wsad wchodzi
> z `order_id = NULL` — klucz obcy to dopuszcza, a test sprawdza wyłącznie
> liczenie pobrań z palety, nie powiązanie ze zleceniem.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_mieso_db.py -v
```
Expected: FAIL — `ModuleNotFoundError: app.services.masownia_service`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/masownia_service.py
"""Panel masowania — mięso, pojemniki z przyprawami i wsady w masownicach.

Mięso dla panelu bierzemy z `meat_stock` (partia) i `meat_pallets` (fizyczna
paleta z ważenia zbiorczego). Pochodzenie partii nie ma znaczenia: mięso
z rozbioru i mięso kupione z zewnątrz leżą w tej samej tabeli, więc zakup
pokazuje się sam.
"""
from typing import Any, Dict, List

from app.db import query_all
from app.logging_config import get_logger

logger = get_logger(__name__)


def _pallets() -> List[Dict[str, Any]]:
    rows = query_all(
        """
        SELECT p.id, p.pallet_no, p.kg_net, p.production_date, p.expiry_date
        FROM meat_pallets p
        WHERE p.deleted_at IS NULL
        ORDER BY p.production_date, p.pallet_no
        """
    )
    lots = query_all(
        "SELECT pallet_id, lot_no, kg FROM meat_pallet_lots ORDER BY seq"
    )
    by_pallet: Dict[str, List[Dict[str, Any]]] = {}
    for l in lots:
        by_pallet.setdefault(l["pallet_id"], []).append(
            {"lot_no": l["lot_no"], "kg": float(l["kg"] or 0)}
        )
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "pallet_no": r["pallet_no"],
            "kg_net": float(r["kg_net"] or 0),
            "production_date": str(r["production_date"] or "")[:10],
            "expiry_date": str(r["expiry_date"] or "")[:10],
            "lots": by_pallet.get(r["id"], []),
        })
    return out


def _lots() -> List[Dict[str, Any]]:
    # kg_free = kg_available - kg_reserved, dokładnie jak w /api/meat-stock.
    # Partie w całości zarezerwowane ZOSTAJĄ na liście: biuro mogło zaplanować
    # całą partię na jedno zlecenie (524: kg_available=0, kg_reserved=600),
    # a panel musi ją pokazać — bramka partii i tak pilnuje, co wolno wziąć.
    rows = query_all(
        """
        SELECT id, lot_no, material_name, expiry_date, production_date,
               kg_available, COALESCE(kg_reserved, 0) AS kg_reserved
        FROM meat_stock
        WHERE COALESCE(status, 'AVAILABLE') <> 'USED'
          AND (kg_available > 0 OR COALESCE(kg_reserved, 0) > 0)
        ORDER BY expiry_date, lot_no
        """
    )
    return [{
        "meat_stock_id": r["id"],
        "lot_no": r["lot_no"],
        "material_name": r["material_name"] or "",
        "kg_free": round(float(r["kg_available"] or 0) - float(r["kg_reserved"] or 0), 3),
        "kg_reserved": float(r["kg_reserved"] or 0),
        "expiry_date": str(r["expiry_date"] or "")[:10],
        "production_date": str(r["production_date"] or "")[:10],
    } for r in rows]


def _taken() -> Dict[str, float]:
    rows = query_all(
        """
        SELECT cp.pallet_id, SUM(cp.kg) AS kg
        FROM mixing_charge_pallets cp
        JOIN mixing_charges c ON c.id = cp.charge_id AND c.status <> 'cancelled'
        WHERE cp.pallet_id IS NOT NULL
        GROUP BY cp.pallet_id
        """
    )
    return {r["pallet_id"]: float(r["kg"] or 0) for r in rows}


def list_meat() -> Dict[str, Any]:
    """Mięso pod kafelki panelu: palety, partie i pobrania wsadów."""
    return {"pallets": _pallets(), "lots": _lots(), "taken": _taken()}
```

```python
# backend/app/routes/masownia.py
"""Panel masowania — mięso, pojemniki z przyprawami, wsady."""
from fastapi import APIRouter

from app.services import masownia_service as svc

router = APIRouter(prefix="/api/masownia", tags=["masownia"])


@router.get("/mieso")
def list_meat():
    """Kafelki mięsa: palety z ważenia zbiorczego i partie bez palet."""
    return svc.list_meat()
```

W `backend/app/main.py` dopisz `masownia` do importu routerów i do rejestracji
(`app.include_router(masownia.router)`) — dokładnie w tych samych dwóch
miejscach, w których występuje `meat_pallets` (linie ~150 i ~219).

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_mieso_db.py -v
```
Expected: PASS — 5 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/masownia_service.py kebab_fixed/backend/app/routes/masownia.py \
        kebab_fixed/backend/app/main.py kebab_fixed/backend/tests/test_masownia_mieso_db.py
git commit -m "feat(masowanie): endpoint miesa — palety, partie, pobrania"
```

---

### Task 6: Pojemniki z przyprawami — backend

**Files:**
- Modify: `backend/app/services/masownia_service.py`
- Modify: `backend/app/routes/masownia.py`
- Create: `backend/app/models/masownia.py`
- Test: `backend/tests/test_masownia_pojemniki_db.py`

**Interfaces:**
- Consumes: tabele z Task 4.
- Produces:
  - `list_carts() -> List[dict]`, `create_cart(dto) -> dict`, `weigh_ingredient(cart_id, dto) -> dict`, `cancel_cart(cart_id) -> dict`
  - `GET/POST /api/masownia/pojemniki`, `PATCH /api/masownia/pojemniki/{id}`, `DELETE /api/masownia/pojemniki/{id}`
  - Modele: `SpiceCartCreate{orderId, cartNo, kgTarget}`, `SpiceWeighDto{seq, name, unit, qty, weighed, manual}`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_masownia_pojemniki_db.py
"""Pojemniki z przyprawami: numer 1-6, rezerwacja kg zlecenia, anulowanie."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.masownia import SpiceCartCreate, SpiceWeighDto
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=1000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,%s,%s,%s,0,'confirmed')",
        (oid, "MAS/17/09/26", "r1", meat_kg),
    )
    return oid


def test_zaklada_pojemnik_na_wskazany_wsad():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    assert cart["cart_no"] == 2 and float(cart["kg_target"]) == 200.0
    assert cart["status"] == "prepared"


def test_numer_pojemnika_jest_zajety_tylko_raz():
    oid = _zlecenie()
    svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    with pytest.raises(HTTPException) as e:
        svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    assert "pojemnik" in str(e.value.detail).lower()


def test_anulowany_pojemnik_zwalnia_numer():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    svc.cancel_cart(cart["id"])
    znowu = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=200))
    assert znowu["cart_no"] == 2


def test_pojemnik_rezerwuje_kilogramy_zlecenia():
    # Bez tego operator rozpisałby dwa razy to samo zlecenie.
    oid = _zlecenie(meat_kg=1000)
    svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=600))
    assert svc.kg_prepared_of(oid) == 600.0


def test_nie_da_sie_rozpisac_wiecej_niz_zostalo_w_zleceniu():
    oid = _zlecenie(meat_kg=1000)
    svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=600))
    with pytest.raises(HTTPException) as e:
        svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=2, kgTarget=600))
    assert "zostało" in str(e.value.detail).lower()


def test_zapisuje_odwazony_skladnik_ze_sladem_recznym():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    out = svc.weigh_ingredient(cart["id"], SpiceWeighDto(
        seq=0, name="BERG SERHAT", unit="kg", qty=3.5, weighed=3.52, manual=True))
    assert out["ingredients"][0] == {
        "seq": 0, "name": "BERG SERHAT", "unit": "kg",
        "qty": 3.5, "weighed": 3.52, "manual": True,
    }


def test_kolejny_odczyt_tego_samego_skladnika_nadpisuje_poprzedni():
    oid = _zlecenie()
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    svc.weigh_ingredient(cart["id"], SpiceWeighDto(seq=0, name="X", unit="kg", qty=1, weighed=0.9, manual=False))
    out = svc.weigh_ingredient(cart["id"], SpiceWeighDto(seq=0, name="X", unit="kg", qty=1, weighed=1.0, manual=False))
    assert len(out["ingredients"]) == 1 and out["ingredients"][0]["weighed"] == 1.0


def test_lista_pokazuje_tylko_stojace_pojemniki():
    oid = _zlecenie()
    a = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    b = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=3, kgTarget=200))
    svc.cancel_cart(b["id"])
    assert [c["id"] for c in svc.list_carts()] == [a["id"]]
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_pojemniki_db.py -v
```
Expected: FAIL — `ModuleNotFoundError: app.models.masownia`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/models/masownia.py
"""Modele panelu masowania."""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class SpiceCartCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order_id: str = Field(..., alias="orderId", min_length=1)
    cart_no: int = Field(..., alias="cartNo", ge=1, le=6)
    kg_target: float = Field(..., alias="kgTarget", gt=0)


class SpiceWeighDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    seq: int = Field(..., ge=0)
    name: str = ""
    unit: str = "kg"
    qty: float = 0
    weighed: float = 0
    #: Ślad „ręcznie" — waga była odłączona, operator ważył gdzie indziej.
    manual: bool = False


class ChargeMeatDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pallet_id: Optional[str] = Field(None, alias="palletId")
    lot_no: str = Field("", alias="lotNo")
    meat_stock_id: str = Field("", alias="meatStockId")
    kg: float = Field(0, ge=0)


class ChargeCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order_id: str = Field(..., alias="orderId", min_length=1)
    machine_id: int = Field(..., alias="machineId", ge=1, le=3)
    cart_id: Optional[str] = Field(None, alias="cartId")
    water_l: float = Field(0, alias="waterL", ge=0)
    meat: List[ChargeMeatDto] = Field(default_factory=list)


class ChargeFinish(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kg_output: float = Field(..., alias="kgOutput", gt=0)
```

Dopisz do `masownia_service.py`:

```python
import json

from fastapi import HTTPException

from app.db import cx_execute, cx_execute_returning, cx_query_all, cx_query_one, transaction
from app.models.masownia import SpiceCartCreate, SpiceWeighDto
from app.utils.ids import cuid


def _cart_out(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    ing = out.get("ingredients")
    out["ingredients"] = json.loads(ing) if isinstance(ing, str) else (ing or [])
    out["kg_target"] = float(out.get("kg_target") or 0)
    return out


def list_carts() -> List[Dict[str, Any]]:
    """Pojemniki, które stoją odważone i czekają na maszynę."""
    rows = query_all(
        """
        SELECT c.*, o.order_no, o.recipe_id AS order_recipe_id
        FROM mixing_spice_carts c
        JOIN mixing_orders o ON o.id = c.order_id
        WHERE c.status = 'prepared'
        ORDER BY c.cart_no
        """
    )
    return [_cart_out(r) for r in rows]


def kg_prepared_of(order_id: str) -> float:
    """Kilogramy zlecenia zajęte przez stojące pojemniki."""
    row = query_all(
        "SELECT COALESCE(SUM(kg_target),0) AS kg FROM mixing_spice_carts "
        "WHERE order_id=%s AND status='prepared'",
        (order_id,),
    )
    return round(float(row[0]["kg"] or 0), 3)


def _kg_left_cx(conn, order_id: str) -> float:
    """Ile kg zlecenia jeszcze nie rozpisano: plan − zrobione − w maszynach − w pojemnikach."""
    o = cx_query_one(
        conn, "SELECT meat_kg, kg_done FROM mixing_orders WHERE id=%s FOR UPDATE", (order_id,)
    )
    if not o:
        raise HTTPException(404, "Zlecenie nie znalezione")
    w_maszynach = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_meat),0) AS kg FROM mixing_charges "
        "WHERE order_id=%s AND status='mixing'",
        (order_id,),
    )
    w_pojemnikach = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(kg_target),0) AS kg FROM mixing_spice_carts "
        "WHERE order_id=%s AND status='prepared'",
        (order_id,),
    )
    return round(
        float(o["meat_kg"] or 0)
        - float(o["kg_done"] or 0)
        - float((w_maszynach or {}).get("kg") or 0)
        - float((w_pojemnikach or {}).get("kg") or 0),
        3,
    )


def create_cart(dto: SpiceCartCreate) -> Dict[str, Any]:
    """Załóż pojemnik: przyprawy odważone z wyprzedzeniem na wskazany wsad.

    Pojemnik REZERWUJE kilogramy zlecenia — bez tego operator rozpisałby dwa
    razy to samo, a maszyny stoją 50 minut i pomyłka wychodzi za późno.
    """
    with transaction() as conn:
        zajety = cx_query_one(
            conn,
            "SELECT cart_no FROM mixing_spice_carts WHERE cart_no=%s AND status='prepared'",
            (dto.cart_no,),
        )
        if zajety:
            raise HTTPException(409, f"Pojemnik {dto.cart_no} jest już zajęty — wsyp go albo anuluj")

        zostalo = _kg_left_cx(conn, dto.order_id)
        if dto.kg_target > zostalo + 0.001:
            raise HTTPException(
                400,
                f"W zleceniu zostało {max(0.0, zostalo):.0f} kg, a pojemnik bierze "
                f"{dto.kg_target:.0f} kg",
            )
        recipe = cx_query_one(
            conn, "SELECT recipe_id FROM mixing_orders WHERE id=%s", (dto.order_id,)
        )
        row = cx_execute_returning(
            conn,
            """
            INSERT INTO mixing_spice_carts (id, cart_no, order_id, recipe_id, kg_target, status)
            VALUES (%s,%s,%s,%s,%s,'prepared') RETURNING *
            """,
            (cuid(), dto.cart_no, dto.order_id, (recipe or {}).get("recipe_id") or "", dto.kg_target),
        )
    logger.info("masownia.cart.created", extra={
        "cart_no": dto.cart_no, "order": dto.order_id, "kg": dto.kg_target,
    })
    return _cart_out(row)


def weigh_ingredient(cart_id: str, dto: SpiceWeighDto) -> Dict[str, Any]:
    """Zapisz odważony składnik; kolejny odczyt tej samej pozycji nadpisuje poprzedni."""
    with transaction() as conn:
        row = cx_query_one(
            conn, "SELECT * FROM mixing_spice_carts WHERE id=%s FOR UPDATE", (cart_id,)
        )
        if not row:
            raise HTTPException(404, "Nie ma takiego pojemnika")
        ing = row.get("ingredients")
        lista = json.loads(ing) if isinstance(ing, str) else list(ing or [])
        wpis = {
            "seq": dto.seq, "name": dto.name, "unit": dto.unit,
            "qty": dto.qty, "weighed": dto.weighed, "manual": dto.manual,
        }
        lista = [x for x in lista if int(x.get("seq", -1)) != dto.seq] + [wpis]
        lista.sort(key=lambda x: int(x.get("seq", 0)))
        out = cx_execute_returning(
            conn,
            "UPDATE mixing_spice_carts SET ingredients=%s WHERE id=%s RETURNING *",
            (json.dumps(lista, ensure_ascii=False), cart_id),
        )
    return _cart_out(out)


def cancel_cart(cart_id: str) -> Dict[str, Any]:
    """Anuluj pojemnik — zwalnia numer i oddaje kilogramy zleceniu."""
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_spice_carts SET status='cancelled' WHERE id=%s AND status='prepared' "
            "RETURNING *",
            (cart_id,),
        )
    if not row:
        raise HTTPException(404, "Nie ma takiego pojemnika albo już go wsypano")
    return _cart_out(row)
```

Trasy w `routes/masownia.py`:

```python
@router.get("/pojemniki")
def list_carts():
    return {"data": svc.list_carts()}


@router.post("/pojemniki")
def create_cart(dto: SpiceCartCreate):
    return svc.create_cart(dto)


@router.patch("/pojemniki/{cart_id}")
def weigh_ingredient(cart_id: str, dto: SpiceWeighDto):
    return svc.weigh_ingredient(cart_id, dto)


@router.delete("/pojemniki/{cart_id}")
def cancel_cart(cart_id: str):
    return svc.cancel_cart(cart_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_pojemniki_db.py -v
```
Expected: PASS — 8 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/models/masownia.py kebab_fixed/backend/app/services/masownia_service.py \
        kebab_fixed/backend/app/routes/masownia.py kebab_fixed/backend/tests/test_masownia_pojemniki_db.py
git commit -m "feat(masowanie): pojemniki z przyprawami rezerwuja kg zlecenia"
```

---

### Task 7: Wsad w masownicy — załadunek i odbiór

**Files:**
- Modify: `backend/app/services/masownia_service.py`
- Modify: `backend/app/routes/masownia.py`
- Test: `backend/tests/test_masownia_wsady_db.py`

**Interfaces:**
- Consumes: `ChargeCreate`, `ChargeFinish` z Task 6; `mixing_service.finish_mixing_session`.
- Produces:
  - `list_charges() -> List[dict]`, `load_charge(dto) -> dict`, `finish_charge(charge_id, dto) -> dict`
  - `POST /api/masownia/wsady`, `PATCH /api/masownia/wsady/{id}/odbior`, `GET /api/masownia/wsady`

**Zasada:** `finish_charge` woła **istniejące** `mixing_service.finish_mixing_session`
z alokacjami ze składu wsadu. Księgowania (ruchy magazynowe, `seasoned_meat`,
`kg_done`, numer partii przyprawionej) nie przepisujemy.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_masownia_wsady_db.py
"""Wsad w masownicy: załadunek zdejmuje paletę, odbiór księguje przez istniejącą ścieżkę."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.masownia import ChargeCreate, ChargeFinish, ChargeMeatDto, SpiceCartCreate
from app.services import masownia_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _zlecenie(meat_kg=1000.0):
    oid = cuid()
    execute(
        "INSERT INTO mixing_orders (id, order_no, recipe_id, meat_kg, kg_done, status) "
        "VALUES (%s,%s,%s,%s,0,'confirmed')",
        (oid, "MAS/17/09/26", "r1", meat_kg),
    )
    return oid


def _partia(lot_no, kg=1000.0):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms_id, lot_no, kg, kg, "2026-09-17", "2026-10-01"),
    )
    return ms_id


def test_zaladunek_tworzy_wsad_i_zajmuje_maszyne():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(
        orderId=oid, machineId=3, waterL=108,
        meat=[ChargeMeatDto(palletId=None, lotNo="511", meatStockId=ms, kg=600)]))
    assert ch["status"] == "mixing" and float(ch["kg_meat"]) == 600.0
    assert [c["machine_id"] for c in svc.list_charges()] == [3]


def test_druga_maszyna_nie_bierze_wsadu_gdy_juz_masuje():
    oid, ms = _zlecenie(), _partia("511")
    svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
            ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert "masownica" in str(e.value.detail).lower()


def test_wsad_zapisuje_sklad_miesny():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    sklad = query_all("SELECT lot_no, kg FROM mixing_charge_pallets WHERE charge_id=%s", (ch["id"],))
    assert [(s["lot_no"], float(s["kg"])) for s in sklad] == [("511", 200.0)]


def test_zaladunek_wsypuje_pojemnik():
    oid, ms = _zlecenie(), _partia("511")
    cart = svc.create_cart(SpiceCartCreate(orderId=oid, cartNo=1, kgTarget=200))
    svc.load_charge(ChargeCreate(orderId=oid, machineId=1, cartId=cart["id"], meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    assert query_one("SELECT status FROM mixing_spice_carts WHERE id=%s", (cart["id"],))["status"] == "dumped"
    # Wsypany pojemnik nie rezerwuje już kilogramów — robi to wsad.
    assert svc.kg_prepared_of(oid) == 0.0


def test_zaladunek_bez_miesa_jest_odrzucany():
    oid = _zlecenie()
    with pytest.raises(HTTPException) as e:
        svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[]))
    assert "mięs" in str(e.value.detail).lower()


def test_odbior_zamyka_wsad_i_zwalnia_maszyne():
    oid, ms = _zlecenie(), _partia("511")
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    out = svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    assert out["status"] == "done" and out["session_id"]
    assert svc.list_charges() == []


def test_odbior_ksieguje_zuzycie_miesa_przez_istniejaca_sciezke():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    stan = query_one("SELECT kg_available, kg_used FROM meat_stock WHERE id=%s", (ms,))
    assert float(stan["kg_used"]) == 200.0
    assert float(stan["kg_available"]) == 800.0


def test_odbior_drugi_raz_nie_ksieguje_ponownie():
    oid, ms = _zlecenie(), _partia("511", kg=1000)
    ch = svc.load_charge(ChargeCreate(orderId=oid, machineId=1, meat=[
        ChargeMeatDto(lotNo="511", meatStockId=ms, kg=200)]))
    svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    with pytest.raises(HTTPException):
        svc.finish_charge(ch["id"], ChargeFinish(kgOutput=232.5))
    assert float(query_one("SELECT kg_used FROM meat_stock WHERE id=%s", (ms,))["kg_used"]) == 200.0
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_wsady_db.py -v
```
Expected: FAIL — `AttributeError: module 'app.services.masownia_service' has no attribute 'load_charge'`.

- [ ] **Step 3: Write minimal implementation**

```python
# dopisz do backend/app/services/masownia_service.py
from app.models.masownia import ChargeCreate, ChargeFinish
from app.models.mixing import FinishMixingLotAlloc, FinishMixingSessionDto
from app.services import mixing_service
from app.utils.time import now_iso


def list_charges() -> List[Dict[str, Any]]:
    """Wsady stojące w masownicach."""
    rows = query_all(
        """
        SELECT c.*, o.order_no, o.recipe_id, o.recipe_name
        FROM mixing_charges c
        JOIN mixing_orders o ON o.id = c.order_id
        WHERE c.status = 'mixing'
        ORDER BY c.machine_id
        """
    )
    out = []
    for r in rows:
        row = dict(r)
        row["kg_meat"] = float(row.get("kg_meat") or 0)
        row["water_l"] = float(row.get("water_l") or 0)
        row["meat"] = query_all(
            "SELECT pallet_id, lot_no, meat_stock_id, kg FROM mixing_charge_pallets "
            "WHERE charge_id=%s",
            (r["id"],),
        )
        out.append(row)
    return out


def load_charge(dto: ChargeCreate) -> Dict[str, Any]:
    """Załaduj masownicę: pojemnik z przyprawami + mięso + woda.

    Wsad powstaje w chwili ZAŁADOWANIA, żeby paleta zniknęła z ekranu od razu —
    inaczej dwa wsady wzięłyby tę samą paletę. Księgowanie zużycia mięsa idzie
    dopiero przy odbiorze, przez istniejące `finish_mixing_session`.
    """
    kg_meat = round(sum(float(m.kg) for m in dto.meat), 3)
    if kg_meat <= 0:
        raise HTTPException(400, "Wsad bez mięsa — wskaż palety albo partię")

    with transaction() as conn:
        zajeta = cx_query_one(
            conn,
            "SELECT machine_id FROM mixing_charges WHERE machine_id=%s AND status='mixing'",
            (dto.machine_id,),
        )
        if zajeta:
            raise HTTPException(409, f"Masownica {dto.machine_id} jest zajęta")

        lot_nos = [m.lot_no for m in dto.meat if m.lot_no]
        batch_no = _batch_no_cx(conn, lot_nos)

        charge = cx_execute_returning(
            conn,
            """
            INSERT INTO mixing_charges
                (id, order_id, machine_id, cart_id, kg_meat, water_l, batch_no, status, started_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'mixing',%s) RETURNING *
            """,
            (cuid(), dto.order_id, dto.machine_id, dto.cart_id, kg_meat,
             dto.water_l, batch_no, now_iso()),
        )
        for m in dto.meat:
            cx_execute(
                conn,
                "INSERT INTO mixing_charge_pallets "
                "(id, charge_id, pallet_id, lot_no, meat_stock_id, kg) VALUES (%s,%s,%s,%s,%s,%s)",
                (cuid(), charge["id"], m.pallet_id, m.lot_no, m.meat_stock_id or None, float(m.kg)),
            )
        if dto.cart_id:
            cx_execute(
                conn,
                "UPDATE mixing_spice_carts SET status='dumped', dumped_at=%s, charge_id=%s "
                "WHERE id=%s AND status='prepared'",
                (now_iso(), charge["id"], dto.cart_id),
            )

    logger.info("masownia.charge.loaded", extra={
        "machine": dto.machine_id, "kg": kg_meat, "batch": batch_no,
    })
    out = dict(charge)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    return out


def _batch_no_cx(conn, lot_nos: List[str]) -> str:
    """Numer partii przyprawionej: jeden wsad surowca → jego numer, więcej → PP{n}.

    Liczymy TYLKO na potrzeby ekranu; przy odbiorze `finish_mixing_session`
    wylicza numer po swojemu i to on trafia do dokumentów.
    """
    rozne = sorted({l for l in lot_nos if l})
    return rozne[0] if len(rozne) == 1 else ""


def finish_charge(charge_id: str, dto: ChargeFinish) -> Dict[str, Any]:
    """Odbiór z masownicy: kg z paleciaka → księgowanie istniejącą ścieżką."""
    charge = query_one("SELECT * FROM mixing_charges WHERE id=%s", (charge_id,))
    if not charge:
        raise HTTPException(404, "Nie ma takiego wsadu")
    if charge["status"] != "mixing":
        raise HTTPException(409, "Ten wsad jest już odebrany")

    sklad = query_all(
        "SELECT meat_stock_id, kg FROM mixing_charge_pallets WHERE charge_id=%s", (charge_id,)
    )
    session = mixing_service.finish_mixing_session(
        charge["order_id"],
        FinishMixingSessionDto(
            kgActual=float(charge["kg_meat"] or 0),
            batchNo=charge["batch_no"] or "",
            lotAllocations=[
                FinishMixingLotAlloc(meatLotId=s["meat_stock_id"] or "", kg=float(s["kg"] or 0))
                for s in sklad
            ],
        ),
    )
    session_id = (session.get("sessions") or [{}])[-1].get("id", "") if isinstance(session, dict) else ""
    with transaction() as conn:
        row = cx_execute_returning(
            conn,
            "UPDATE mixing_charges SET status='done', finished_at=%s, session_id=%s "
            "WHERE id=%s AND status='mixing' RETURNING *",
            (now_iso(), session_id or charge_id, charge_id),
        )
    if not row:
        raise HTTPException(409, "Ten wsad jest już odebrany")
    logger.info("masownia.charge.finished", extra={
        "machine": charge["machine_id"], "kg_output": dto.kg_output,
    })
    out = dict(row)
    out["kg_meat"] = float(out.get("kg_meat") or 0)
    return out
```

Trasy:

```python
@router.get("/wsady")
def list_charges():
    return {"data": svc.list_charges()}


@router.post("/wsady")
def load_charge(dto: ChargeCreate):
    return svc.load_charge(dto)


@router.patch("/wsady/{charge_id}/odbior")
def finish_charge(charge_id: str, dto: ChargeFinish):
    return svc.finish_charge(charge_id, dto)
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 -m pytest tests/test_masownia_wsady_db.py -v
```
Expected: PASS — 8 testów. Jeśli `session_id` nie wraca z `finish_mixing_session`,
odczytaj ostatnią sesję zlecenia zapytaniem `SELECT id FROM mixing_sessions WHERE
order_id=%s ORDER BY completed_at DESC LIMIT 1` zamiast grzebać w odpowiedzi.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/masownia_service.py kebab_fixed/backend/app/routes/masownia.py \
        kebab_fixed/backend/tests/test_masownia_wsady_db.py
git commit -m "feat(masowanie): wsad w masownicy — zaladunek i odbior"
```

---

### Task 8: Klient API panelu

**Files:**
- Modify: `src/lib/api.ts` (dopisać sekcję `masowniaApi` po `meatPalletsApi`)
- Test: `src/features/masownia/masowniaApi.test.ts`

**Interfaces:**
- Consumes: endpointy z Task 5–7.
- Produces:
  - `masowniaApi.meat(): Promise<{ pallets: TilePallet[]; lots: TileLot[]; taken: Record<string, number> }>`
  - `masowniaApi.carts()`, `masowniaApi.createCart()`, `masowniaApi.weighIngredient()`, `masowniaApi.cancelCart()`
  - `masowniaApi.charges()`, `masowniaApi.load()`, `masowniaApi.finish()`
  - `mapMasowniaMeat(raw: any)` — eksportowana, żeby dało się ją przetestować bez sieci

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/masownia/masowniaApi.test.ts
import { describe, it, expect } from 'vitest'
import { mapMasowniaMeat } from '@/lib/api'

describe('mapMasowniaMeat', () => {
  it('mapuje snake_case backendu na kształt kafelków', () => {
    const out = mapMasowniaMeat({
      pallets: [{ id: 'p1', pallet_no: 'PAL/17/09/26/1', kg_net: '200.000',
                  expiry_date: '2026-10-01', lots: [{ lot_no: '511', kg: '200.000' }] }],
      lots: [{ meat_stock_id: 'ms1', lot_no: '511', material_name: 'Mięso z/s',
               kg_free: '1800.000', expiry_date: '2026-10-01' }],
      taken: { p1: '140.000' },
    })
    expect(out.pallets[0]).toEqual({
      id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-10-01',
      lots: [{ lotNo: '511', kg: 200 }],
    })
    expect(out.lots[0]).toEqual({
      meatStockId: 'ms1', lotNo: '511', materialName: 'Mięso z/s',
      kgFree: 1800, expiryDate: '2026-10-01',
    })
    expect(out.taken).toEqual({ p1: 140 })
  })

  it('pusta odpowiedź nie wysypuje ekranu', () => {
    expect(mapMasowniaMeat({})).toEqual({ pallets: [], lots: [], taken: {} })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/masowniaApi.test.ts`
Expected: FAIL — `mapMasowniaMeat is not exported`.

- [ ] **Step 3: Write minimal implementation**

W `src/lib/api.ts`, zaraz za sekcją `meatPalletsApi`:

```typescript
// ─── Panel masowania (kiosk masowni) ──────────────────────────
import type { TileLot, TilePallet } from '@/features/masownia/meatTiles'

export interface MasowniaMeat {
  pallets: TilePallet[]
  lots: TileLot[]
  taken: Record<string, number>
}

export function mapMasowniaMeat(raw: any): MasowniaMeat {
  return {
    pallets: (raw?.pallets ?? []).map((p: any) => ({
      id: p.id,
      palletNo: p.pallet_no ?? p.palletNo ?? '',
      kgNet: Number(p.kg_net ?? p.kgNet ?? 0),
      expiryDate: String(p.expiry_date ?? p.expiryDate ?? '').slice(0, 10),
      lots: (p.lots ?? []).map((l: any) => ({
        lotNo: l.lot_no ?? l.lotNo ?? '',
        kg: Number(l.kg ?? 0),
      })),
    })),
    lots: (raw?.lots ?? []).map((l: any) => ({
      meatStockId: l.meat_stock_id ?? l.meatStockId ?? '',
      lotNo: l.lot_no ?? l.lotNo ?? '',
      materialName: l.material_name ?? l.materialName ?? '',
      kgFree: Number(l.kg_free ?? l.kgFree ?? 0),
      expiryDate: String(l.expiry_date ?? l.expiryDate ?? '').slice(0, 10),
    })),
    taken: Object.fromEntries(
      Object.entries(raw?.taken ?? {}).map(([k, v]) => [k, Number(v)]),
    ),
  }
}

export const masowniaApi = {
  meat:  () => get<any>('/masownia/mieso').then(mapMasowniaMeat),

  carts: () => get<any>('/masownia/pojemniki').then(r => (r?.data ?? []) as any[]),
  createCart: (dto: { orderId: string; cartNo: number; kgTarget: number }) =>
    post<any>('/masownia/pojemniki', dto),
  weighIngredient: (cartId: string, dto: {
    seq: number; name: string; unit: string; qty: number; weighed: number; manual: boolean
  }) => patch<any>(`/masownia/pojemniki/${cartId}`, dto),
  cancelCart: (cartId: string) => del<any>(`/masownia/pojemniki/${cartId}`),

  charges: () => get<any>('/masownia/wsady').then(r => (r?.data ?? []) as any[]),
  load: (dto: {
    orderId: string; machineId: number; cartId?: string | null; waterL: number
    meat: { palletId: string | null; lotNo: string; meatStockId: string; kg: number }[]
  }) => post<any>('/masownia/wsady', dto),
  finish: (chargeId: string, kgOutput: number) =>
    patch<any>(`/masownia/wsady/${chargeId}/odbior`, { kgOutput }),
}
```

> Wykonawco: sprawdź nazwy helperów HTTP na górze `api.ts` (`get`, `post`, `patch`,
> `del`) i użyj tych, które tam są — nie dopisuj własnych.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/masowniaApi.test.ts && npm run typecheck`
Expected: PASS — 2 testy, typecheck bez błędów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/lib/api.ts kebab_fixed/src/features/masownia/masowniaApi.test.ts
git commit -m "feat(masowanie): klient API panelu"
```

---

### Task 9: Kanał kiosku „masowanie"

**Files:**
- Create: `masowanie.html` (kopia `produkcja.html` ze zmienionym tytułem i ścieżką skryptu)
- Create: `src/masowanie.tsx`
- Create: `src-tauri/tauri.masowanie.conf.json` (kopia `tauri.produkcja.conf.json`)
- Modify: `vite.config.ts` (wejście `masowanie` + wstrzyknięcie `__MASOWANIE_VERSION__`)
- Create: `src/pages/tablet/MasowanieHmiPage.tsx` (na razie szkielet)
- Test: `src/features/masownia/kioskEntry.test.ts`

**Interfaces:**
- Consumes: `KioskGuards`, `SplashGate`, `dropServiceWorker` z `@/features/kiosk/KioskFrame`.
- Produces: `MasowanieHmiPage` — komponent bez propsów, montowany przez `src/masowanie.tsx`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/masownia/kioskEntry.test.ts
/**
 * Kanał kiosku masowni: wejście, konfiguracja Tauri i wersja muszą istnieć
 * i trzymać się wzorca „produkcja" — inaczej instalator nie powstanie.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('kanał kiosku masowanie', () => {
  it('ma własne wejście HTML wskazujące na src/masowanie.tsx', () => {
    expect(read('masowanie.html')).toContain('/src/masowanie.tsx')
  })

  it('jest wpięty w build Vite', () => {
    expect(read('vite.config.ts')).toContain("'masowanie'")
  })

  it('ma konfigurację Tauri z własnym identyfikatorem', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    expect(conf.identifier).toContain('masowanie')
    expect(conf.productName).toMatch(/masowan/i)
  })

  it('kanał aktualizacji nie podszywa się pod inny kiosk', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    const endpoint = conf.plugins.updater.endpoints[0]
    expect(endpoint).toContain('masowanie')
  })

  it('CSP kiosku puszcza drukarkę etykiet na localhost:9100', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    expect(conf.app.security.csp).toContain('localhost:9100')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/kioskEntry.test.ts`
Expected: FAIL — `ENOENT: masowanie.html`.

- [ ] **Step 3: Write minimal implementation**

1. `masowanie.html` — skopiuj `produkcja.html`, zmień `<title>` na `Masowanie HMI`
   i ścieżkę skryptu na `/src/masowanie.tsx`. Reszta (odrejestrowanie service
   workera, splash, blokada zaznaczania) zostaje bez zmian.

2. `src/masowanie.tsx`:

```tsx
/**
 * masowanie.tsx — samodzielny entry dla Tauri „Masowanie HMI".
 *
 * Trzecie stanowisko hali. Rama i motyw jak w kiosku rozbioru i produkcji;
 * zasady pracy z prototypu 0.9: dwa tory (przyprawy do pojemnika / załadunek
 * masownicy) i bramka partii wskazanych przez biuro.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthContext'
import { MasowanieHmiPage } from '@/pages/tablet/MasowanieHmiPage'
import { KioskGuards, SplashGate, dropServiceWorker } from '@/features/kiosk/KioskFrame'

declare const __MASOWANIE_VERSION__: string

installGlobalErrorLogger()
dropServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <TooltipProvider>
          <KioskGuards />
          <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
            <SplashGate department="masowanie" label="Masowanie" channel="masowanie" version={__MASOWANIE_VERSION__}>
              <MasowanieHmiPage />
            </SplashGate>
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
```

3. `src/pages/tablet/MasowanieHmiPage.tsx` — na tym etapie szkielet, który
   renderuje ramę i pusty panel roboczy (wypełnia go Task 10–12):

```tsx
/**
 * Panel masowania — kiosk masowni (panel PC 21,5").
 * Układ 1:1 z prototypu 0.9: szyna masownic u góry, kolejka dnia i pojemniki
 * po lewej, panel roboczy po prawej, pasek podsumowania na dole.
 */
export function MasowanieHmiPage() {
  return <div data-testid="masowanie-hmi" style={{ height: '100%' }} />
}
```

4. `src-tauri/tauri.masowanie.conf.json` — kopia `tauri.produkcja.conf.json` ze
   zmianami: `productName: "Masowanie HMI"`, `identifier: "pl.kebabmes.masowanie"`,
   `version` startowo `"1.0.0"`, endpoint updatera z `channel=masowanie`,
   a w `frontendDist`/`windows` to samo co w produkcji. CSP skopiuj z produkcji
   **razem z** `http://localhost:9100`.

5. `vite.config.ts` — dopisz wejście obok `produkcja`:

```typescript
        // Masownia — dwa tory pracy i bramka partii biura
        'masowanie': path.resolve(__dirname, 'masowanie.html'),
```

oraz `__MASOWANIE_VERSION__` w `define` tam, gdzie stoi `__PRODUKCJA_VERSION__`
(czyta wersję z `src-tauri/tauri.masowanie.conf.json`).

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/masownia/kioskEntry.test.ts && npm run build
```
Expected: PASS — 5 testów; build wypuszcza `dist/masowanie.html`.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/masowanie.html kebab_fixed/src/masowanie.tsx kebab_fixed/src/pages/tablet/MasowanieHmiPage.tsx \
        kebab_fixed/src-tauri/tauri.masowanie.conf.json kebab_fixed/vite.config.ts \
        kebab_fixed/src/features/masownia/kioskEntry.test.ts
git commit -m "feat(masowanie): kanal kiosku masowni"
```

---

### Task 10: Ekran — rama, szyna masownic, kolejka, pojemniki

**Files:**
- Modify: `src/pages/tablet/MasowanieHmiPage.tsx`
- Create: `src/features/masownia/components/MachineRail.tsx`
- Create: `src/features/masownia/components/DayQueue.tsx`
- Create: `src/features/masownia/components/CartList.tsx`
- Create: `src/features/masownia/useMasowniaData.ts`
- Test: `src/features/masownia/masowanieHmi.test.tsx`

**Interfaces:**
- Consumes: `masowniaApi` (Task 8), `MACHINES`/`T_MIX_MIN` (Task 3), `mixingOrdersApi` z `@/lib/api`.
- Produces:
  - `useMasowniaData(): { orders, carts, charges, meat, reload, loading, error }`
  - `<MachineRail machines={...} charges={...} onPick={(machineId) => void} />`
  - `<DayQueue orders={...} selectedId={...} onPick={(orderId) => void} />`
  - `<CartList carts={...} selectedId={...} onPick={(cartId) => void} />`

Styl: wprost z prototypu (`tool-results/artifact-d0bd19cb-*.html`) — kolory
z `src/features/hmi-theme/vars.ts`, liczby czcionką `IBM Plex Mono`, kafelki
maszyn 158 px wysokości, lewa kolumna 498 px.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/masownia/masowanieHmi.test.tsx
/**
 * Panel masowania — szkielet ekranu na zamockowanym API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MasowanieHmiPage } from '@/pages/tablet/MasowanieHmiPage'

vi.mock('@/lib/api', () => ({
  masowniaApi: {
    meat: vi.fn(async () => ({ pallets: [], lots: [], taken: {} })),
    carts: vi.fn(async () => ([{ id: 'c1', cart_no: 2, order_id: 'o1', kg_target: 200,
                                 order_no: 'MAS/17/09/26', ingredients: [] }])),
    charges: vi.fn(async () => ([{ id: 'ch1', machine_id: 3, order_id: 'o1', kg_meat: 600,
                                   batch_no: '511', started_at: new Date().toISOString(),
                                   recipe_name: 'KIRMIZI', order_no: 'MAS/17/09/26', meat: [] }])),
    createCart: vi.fn(), weighIngredient: vi.fn(), cancelCart: vi.fn(),
    load: vi.fn(), finish: vi.fn(),
  },
  mixingOrdersApi: {
    list: vi.fn(async () => ([{ id: 'o1', orderNo: 'MAS/17/09/26', recipeName: 'KIRMIZI',
                                meatKg: 1000, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [] }])),
  },
}))

describe('MasowanieHmiPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pokazuje trzy masownice z wielkościami wsadu', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 1')).toBeInTheDocument())
    expect(screen.getByText('Masownica 3')).toBeInTheDocument()
    expect(screen.getAllByText(/wsad 200 kg/)).toHaveLength(2)
    expect(screen.getByText(/wsad 600 kg/)).toBeInTheDocument()
  })

  it('NIE pokazuje cichego zapasu ponad nominał', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 3')).toBeInTheDocument())
    expect(screen.queryByText(/660/)).not.toBeInTheDocument()
    expect(screen.queryByText(/260/)).not.toBeInTheDocument()
  })

  it('pokazuje zlecenie z kolejki dnia', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeInTheDocument())
  })

  it('pokazuje stojący pojemnik z przyprawami', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/pojemnik 2/i)).toBeInTheDocument())
  })

  it('masownica z wsadem odlicza czas do końca masowania', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/masowanieHmi.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Masownica 1`.

- [ ] **Step 3: Write minimal implementation**

`useMasowniaData.ts` ładuje cztery źródła równolegle i odświeża co 10 s:

```typescript
export function useMasowniaData() {
  const [state, setState] = useState({ orders: [], carts: [], charges: [],
                                       meat: { pallets: [], lots: [], taken: {} },
                                       loading: true, error: '' })
  const reload = useCallback(async () => {
    try {
      const [orders, carts, charges, meat] = await Promise.all([
        mixingOrdersApi.list(), masowniaApi.carts(), masowniaApi.charges(), masowniaApi.meat(),
      ])
      setState({ orders, carts, charges, meat, loading: false, error: '' })
    } catch (e: any) {
      setState(s => ({ ...s, loading: false, error: String(e?.message ?? e) }))
    }
  }, [])
  useEffect(() => { reload(); const t = setInterval(reload, 10_000); return () => clearInterval(t) }, [reload])
  return { ...state, reload }
}
```

`MachineRail.tsx` renderuje `MACHINES.map(...)`: nagłówek „Masownica {id}",
podpis „wsad {cap} kg" (bez zapasu!), stan (Wolna / Masuje / Gotowe — odbierz),
a przy wsadzie licznik `mm:ss` do `started_at + T_MIX_MIN` i pasek postępu,
z podpisem „do końca masowania".

`DayQueue.tsx` — wiersze zleceń: numer porządkowy, receptura, `kg_done/meat_kg`,
pasek postępu i znacznik stanu. `CartList.tsx` — wiersze pojemników z dużym
numerem w kwadracie, recepturą, `pojemnik {n}` i kilogramami.

`MasowanieHmiPage.tsx` składa to w układ z prototypu i trzyma stan wyboru
(`orderId`, `cartId`, `machineId`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/masowanieHmi.test.tsx`
Expected: PASS — 5 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia kebab_fixed/src/pages/tablet/MasowanieHmiPage.tsx
git commit -m "feat(masowanie): rama ekranu — masownice, kolejka, pojemniki"
```

---

### Task 11: Tor przypraw — ważenie do pojemnika

**Files:**
- Create: `src/features/masownia/components/SpiceWeighing.tsx`
- Create: `src/features/masownia/spiceCheck.ts`
- Modify: `src/pages/tablet/MasowanieHmiPage.tsx`
- Test: `src/features/masownia/spiceCheck.test.ts`

**Interfaces:**
- Consumes: `useScale()` z `@/features/deboning/useScale`, `TOL_SPICE_KG` (Task 3), `masowniaApi.weighIngredient` (Task 8).
- Produces:
  - `spiceVerdict(target: number, reading: number): 'low' | 'ok' | 'over'`
  - `scaleIngredients(recipe: { name: string; qty: number; unit: string }[], kgBatch: number): { seq: number; name: string; unit: string; qty: number }[]`
  - `<SpiceWeighing order={...} kgTarget={...} cartNo={...} onDone={() => void} />`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/masownia/spiceCheck.test.ts
import { describe, it, expect } from 'vitest'
import { spiceVerdict, scaleIngredients } from './spiceCheck'

describe('spiceVerdict', () => {
  it('trafienie w tolerancji 0,05 kg przechodzi', () => {
    expect(spiceVerdict(3.5, 3.5)).toBe('ok')
    expect(spiceVerdict(3.5, 3.54)).toBe('ok')
    expect(spiceVerdict(3.5, 3.46)).toBe('ok')
  })

  it('za mało i za dużo są rozpoznane osobno', () => {
    expect(spiceVerdict(3.5, 3.2)).toBe('low')
    expect(spiceVerdict(3.5, 3.7)).toBe('over')
  })

  it('granica tolerancji należy do trafienia', () => {
    expect(spiceVerdict(3.5, 3.55)).toBe('ok')
    expect(spiceVerdict(3.5, 3.45)).toBe('ok')
  })
})

describe('scaleIngredients', () => {
  const receptura = [
    { name: 'BERG SERHAT', qty: 1.75, unit: 'kg' },
    { name: 'TRANSGLUTAMINAZA', qty: 0.1, unit: 'kg' },
    { name: 'Woda', qty: 18, unit: 'L' },
  ]

  it('przelicza recepturę ze 100 kg na wsad', () => {
    const out = scaleIngredients(receptura, 200)
    expect(out.map(i => [i.name, i.qty])).toEqual([['BERG SERHAT', 3.5], ['TRANSGLUTAMINAZA', 0.2]])
  })

  it('woda NIE idzie do pojemnika — dozuje ją dozownik przy maszynie', () => {
    expect(scaleIngredients(receptura, 200).some(i => i.unit === 'L')).toBe(false)
  })

  it('numeruje pozycje od zera, w kolejności receptury', () => {
    expect(scaleIngredients(receptura, 200).map(i => i.seq)).toEqual([0, 1])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/spiceCheck.test.ts`
Expected: FAIL — `Failed to resolve import "./spiceCheck"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/masownia/spiceCheck.ts
/**
 * Bramka wagi przypraw. Odczyt musi zgadzać się z recepturą w tolerancji
 * 0,05 kg i dopiero wtedy panel puszcza dalej — automatycznie, bez dotyku.
 */
import { TOL_SPICE_KG } from './machines'

export function spiceVerdict(target: number, reading: number): 'low' | 'ok' | 'over' {
  const diff = Math.round((reading - target) * 1000) / 1000
  if (diff > TOL_SPICE_KG) return 'over'
  if (diff < -TOL_SPICE_KG) return 'low'
  return 'ok'
}

/** Składniki do odważenia na dany wsad. Receptura jest podana na 100 kg mięsa.
 *  Woda odpada: nie idzie przez wagę, dozuje ją DW-1C przy maszynie. */
export function scaleIngredients(
  recipe: { name: string; qty: number; unit: string }[],
  kgBatch: number,
): { seq: number; name: string; unit: string; qty: number }[] {
  return recipe
    .filter(i => i.unit !== 'L')
    .map((i, seq) => ({
      seq, name: i.name, unit: i.unit,
      qty: Math.round((i.qty * kgBatch) / 100 * 1000) / 1000,
    }))
}
```

`SpiceWeighing.tsx`: lista składników po lewej (pozycja bieżąca podświetlona,
odważone na zielono, ślad „ręcznie" bursztynowy), po prawej wielki odczyt wagi
z `useScale()`, pasek z oknem tolerancji i komunikat. Trafienie w okno przez
0,8 s zapisuje pozycję przez `masowniaApi.weighIngredient` i przechodzi do
następnej — **automatycznie, bez dotyku**. Gdy `connected === false`, pod
odczytem pojawia się przycisk ręcznego wpisania ze śladem `manual: true`;
przy sprawnej wadze tego przycisku NIE MA.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/spiceCheck.test.ts && npm run typecheck`
Expected: PASS — 6 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia kebab_fixed/src/pages/tablet/MasowanieHmiPage.tsx
git commit -m "feat(masowanie): tor przypraw — wazenie do pojemnika"
```

---

### Task 12: Tor załadunku — kafelki mięsa z bramką partii

**Files:**
- Create: `src/features/masownia/components/MeatPicker.tsx`
- Modify: `src/pages/tablet/MasowanieHmiPage.tsx`
- Test: `src/features/masownia/meatPicker.test.tsx`

**Interfaces:**
- Consumes: `buildMeatTiles` (Task 1), `gateMeatTiles`/`officeChoiceLabel` (Task 2), `masowniaApi.load` (Task 8).
- Produces: `<MeatPicker meat={...} orderLots={...} targetKg={...} onConfirm={(take) => void} />`, gdzie `take: { palletId: string | null; lotNo: string; meatStockId: string; kg: number }[]`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/masownia/meatPicker.test.tsx
/**
 * Kafelki mięsa na ekranie: bramka partii biura widziana oczami operatora.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeatPicker } from './components/MeatPicker'

const meat = {
  pallets: [
    { id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-10-01',
      lots: [{ lotNo: '511', kg: 200 }] },
    { id: 'p2', palletNo: 'PAL/17/09/26/2', kgNet: 200, expiryDate: '2026-10-01',
      lots: [{ lotNo: '513', kg: 200 }] },
  ],
  lots: [
    { meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
    { meatStockId: 'ms-513', lotNo: '513', materialName: 'Mięso z/s', kgFree: 200, expiryDate: '2026-10-01' },
    { meatStockId: 'ms-524', lotNo: '524', materialName: 'Filet z mostka wołowego', kgFree: 600, expiryDate: '2026-10-07' },
  ],
  taken: {},
}

describe('MeatPicker', () => {
  it('bez partii w zleceniu wszystkie kafelki są klikalne', () => {
    render(<MeatPicker meat={meat} orderLots={[]} targetKg={200} onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ })).toBeEnabled()
  })

  it('z partią biura reszta kafelków jest szara i nieklikalna', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }]} targetKg={200} onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ })).toBeDisabled()
  })

  it('kafelek odrzucony mówi, co wybrało biuro', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }]} targetKg={200} onConfirm={vi.fn()} />)
    expect(screen.getByText('Biuro wybrało partię 511')).toBeInTheDocument()
  })

  it('filet z mostka wskazany przez biuro JEST do wzięcia, choć nie ma palety', () => {
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '524' }]} targetKg={600} onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Filet z mostka wołowego/ })).toBeEnabled()
  })

  it('kliknięcie kafelka palety dokłada jego kilogramy do wsadu', async () => {
    const onConfirm = vi.fn()
    render(<MeatPicker meat={meat} orderLots={[]} targetKg={200} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: /PAL\/17\/09\/26\/1/ }))
    await userEvent.click(screen.getByRole('button', { name: /Załaduj/ }))
    expect(onConfirm).toHaveBeenCalledWith([
      { palletId: 'p1', lotNo: '511', meatStockId: 'ms-511', kg: 200 },
    ])
  })

  it('kafelek szary nie reaguje na dotyk', async () => {
    const onConfirm = vi.fn()
    render(<MeatPicker meat={meat} orderLots={[{ meatLotNo: '511' }]} targetKg={200} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: /PAL\/17\/09\/26\/2/ }))
    expect(screen.queryByText(/PAL\/17\/09\/26\/2/)?.closest('button')).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/meatPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./components/MeatPicker"`.

- [ ] **Step 3: Write minimal implementation**

`MeatPicker.tsx`:
- składa kafelki: `gateMeatTiles(buildMeatTiles(meat), orderLots)`;
- kafelek palety = `<button>` z numerem `PAL/…`, wielkimi kilogramami, składem
  partii i terminem; kafelek partii dodatkowo z nazwą materiału i podpisem
  „paleciak — wpisz kg";
- `allowed === false` → `disabled`, wygaszony (`opacity .42`), pod kafelkiem
  `reason`; kafelek **zostaje na swoim miejscu**;
- dotknięcie kafelka partii otwiera klawiaturę numeryczną (kg z paleciaka),
  dotknięcie palety dokłada całe wolne kilogramy;
- stopka: suma wsadu vs `targetKg` i przycisk „Załaduj", nieaktywny przy pustym
  wyborze;
- nad siatką, gdy biuro wskazało partie: pasek „Biuro wybrało partie: 511, 512".

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia && npm run typecheck`
Expected: PASS — wszystkie testy modułu masowni.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia kebab_fixed/src/pages/tablet/MasowanieHmiPage.tsx
git commit -m "feat(masowanie): kafelki miesa z bramka partii biura"
```

---

### Task 13: Woda i odbiór z masownicy

**Files:**
- Create: `src/features/masownia/components/WaterStep.tsx`
- Create: `src/features/masownia/components/PickupDialog.tsx`
- Create: `src/features/masownia/useDoser.ts`
- Modify: `src/pages/tablet/MasowanieHmiPage.tsx`
- Test: `src/features/masownia/waterStep.test.tsx`

**Interfaces:**
- Consumes: `waterWindow` (Task 3), `masowniaApi.load`/`finish` (Task 8).
- Produces:
  - `useDoser(): { connected: boolean; dosedL: number; running: boolean; start: (l: number) => void }`
  - `<WaterStep targetL={...} onDone={(l: number) => void} />`
  - `<PickupDialog charge={...} expectedKg={...} onConfirm={(kg: number) => void} />`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/masownia/waterStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WaterStep } from './components/WaterStep'
import { PickupDialog } from './components/PickupDialog'

describe('WaterStep', () => {
  it('bez dozownika przyjmuje litry z klawiatury', async () => {
    const onDone = vi.fn()
    render(<WaterStep targetL={108} onDone={onDone} />)
    for (const c of '108') await userEvent.click(screen.getByRole('button', { name: c }))
    await userEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(onDone).toHaveBeenCalledWith(108)
  })

  it('dawka poza oknem ±3% nie przechodzi', async () => {
    const onDone = vi.fn()
    render(<WaterStep targetL={100} onDone={onDone} />)
    for (const c of '120') await userEvent.click(screen.getByRole('button', { name: c }))
    expect(screen.getByRole('button', { name: /Zatwierdź/ })).toBeDisabled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('pokazuje zadaną dawkę, a nie zapas', () => {
    render(<WaterStep targetL={108} onDone={vi.fn()} />)
    expect(screen.getByText(/108/)).toBeInTheDocument()
  })
})

describe('PickupDialog', () => {
  const charge = { id: 'ch1', machine_id: 3, batch_no: '511', kg_meat: 600, recipe_name: 'KIRMIZI' }

  it('pokazuje wartość wyliczoną z receptury obok pola operatora', () => {
    render(<PickupDialog charge={charge} expectedKg={696} onConfirm={vi.fn()} />)
    expect(screen.getByText(/696/)).toBeInTheDocument()
  })

  it('oddaje kilogramy wpisane z paleciaka', async () => {
    const onConfirm = vi.fn()
    render(<PickupDialog charge={charge} expectedKg={696} onConfirm={onConfirm} />)
    for (const c of '694') await userEvent.click(screen.getByRole('button', { name: c }))
    await userEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(onConfirm).toHaveBeenCalledWith(694)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia/waterStep.test.tsx`
Expected: FAIL — `Failed to resolve import "./components/WaterStep"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/masownia/useDoser.ts
/**
 * Dozownik wody DW-1C (ELEKTRON s.c.) — hook o tym samym kształcie co waga.
 *
 * Moduł RS-485 dochodzi do urządzenia za jakiś miesiąc, więc most Rust
 * (`src-tauri/src/doser.rs`) na razie melduje `connected: false`, a panel
 * przyjmuje litry z klawiatury w oknie ±3%. Po dokupieniu modułu zmienia się
 * wyłącznie `doser.rs` — ten hook i ekran zostają bez zmian.
 */
import { useEffect, useState } from 'react'

export interface DoserState {
  connected: boolean
  dosedL: number
  running: boolean
  start: (l: number) => void
}

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function useDoser(): DoserState {
  const [s, setS] = useState({ connected: false, dosedL: 0, running: false })
  useEffect(() => {
    ;(window as any).__doserSim = (dosedL: number | null, running = false) => {
      setS(dosedL == null
        ? { connected: false, dosedL: 0, running: false }
        : { connected: true, dosedL, running })
    }
    return () => { delete (window as any).__doserSim }
  }, [])
  useEffect(() => {
    if (!IS_TAURI) return
    let unlisten: (() => void) | null = null
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ connected: boolean; dosedL: number; running: boolean }>('doser://state', e => setS(e.payload)),
    ).then(fn => { unlisten = fn })
    return () => unlisten?.()
  }, [])
  const start = (l: number) => {
    if (!IS_TAURI) return
    import('@tauri-apps/api/core').then(({ invoke }) => invoke('doser_dose', { liters: l }))
      .catch(e => console.error('doser_dose', e))
  }
  return { ...s, start }
}
```

`WaterStep.tsx`: duża liczba zadanej dawki, klawiatura numeryczna, okno
`waterWindow(targetL)` na pasku; „Zatwierdź" aktywne tylko w oknie. Gdy
`useDoser().connected`, zamiast klawiatury pokazuje odczyt z urządzenia i
przycisk „Dozuj", a potwierdzenie idzie automatycznie po wejściu w okno.

`PickupDialog.tsx`: numer partii wsadu, receptura, wartość wyliczona z receptury
(`expectedKg`) i klawiatura numeryczna na odczyt z paleciaka; po „Zatwierdź"
woła `masowniaApi.finish(charge.id, kg)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/masownia && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/masownia kebab_fixed/src/pages/tablet/MasowanieHmiPage.tsx
git commit -m "feat(masowanie): woda z oknem +/-3% i odbior z masownicy"
```

---

### Task 14: Most dozownika i konfiguracja wagi per kiosk

**Files:**
- Create: `src-tauri/src/doser.rs`
- Modify: `src-tauri/src/lib.rs` (rejestracja `doser_dose`, `doser::spawn_reader`)
- Modify: `src-tauri/src/scale.rs` (nazwa katalogu `ProgramData` zależna od kiosku)
- Test: testy jednostkowe Rust w `src-tauri/src/doser.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: nic z tasków front-endowych.
- Produces: event `doser://state` `{connected, dosedL, running, error}`, komenda `doser_dose(liters: f64)`.

- [ ] **Step 1: Write the failing test**

```rust
// na końcu src-tauri/src/doser.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domyslnie_dozownik_jest_wylaczony() {
        // Moduł RS-485 dochodzi do DW-1C dopiero za jakiś czas — do tego momentu
        // most ma milczeć, a panel przyjmować litry z klawiatury.
        let cfg = DoserConfig::default();
        assert!(!cfg.enabled);
    }

    #[test]
    fn czyta_litry_z_ramki_urzadzenia() {
        assert_eq!(parse_liters("DOS,+ 108.0L"), Some(108.0));
        assert_eq!(parse_liters("0108,5"), Some(108.5));
        assert_eq!(parse_liters("ERR"), None);
    }

    #[test]
    fn dawka_musi_byc_dodatnia() {
        assert!(validate_dose(108.0).is_ok());
        assert!(validate_dose(0.0).is_err());
        assert!(validate_dose(-5.0).is_err());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/src-tauri && cargo test doser`
Expected: FAIL — `file not found for module doser` / brak funkcji.

- [ ] **Step 3: Write minimal implementation**

`doser.rs` na wzór `scale.rs`: `DoserConfig { enabled: false, port, baud, unit_id }`
czytany z `doser.json` tymi samymi ścieżkami co `scale.json`, `parse_liters`
(pierwsza liczba w ramce, przecinek albo kropka), `validate_dose`, wątek
`spawn_reader` emitujący `doser://state` i komenda `doser_dose` zapisująca
żądanie dawki do `DOSE_REQUESTED: AtomicU64` (litry ×10, żeby trzymać setne).
Dopóki `enabled == false`, wątek kończy się od razu i panel nigdy nie dostaje
`connected: true`.

W `scale.rs` zamień zaszyty `"Rozbior HMI"` na nazwę z kompilacji:

```rust
/// Katalog wspólny dla całego komputera — inny dla każdego kiosku, żeby
/// stanowiska nie deptały sobie konfiguracji wagi (masownia ma wagę przypraw
/// z działką 0,01 kg, rozbiór najazdową z działką 0,5 kg).
const CONFIG_DIR: &str = match option_env!("KIOSK_CONFIG_DIR") {
    Some(v) => v,
    None => "Rozbior HMI",
};
```

i użyj `CONFIG_DIR` w `config_paths`. W `tauri.masowanie.conf.json` ustaw
`beforeBuildCommand` tak, żeby build przekazał `KIOSK_CONFIG_DIR=Masowanie HMI`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/src-tauri && cargo test doser && cargo test scale`
Expected: PASS — testy dozownika i wagi.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src-tauri/src/doser.rs kebab_fixed/src-tauri/src/lib.rs kebab_fixed/src-tauri/src/scale.rs \
        kebab_fixed/src-tauri/tauri.masowanie.conf.json
git commit -m "feat(masowanie): most dozownika wody i config wagi per kiosk"
```

---

### Task 15: E2E i próba generalna

**Files:**
- Create: `e2e/masowanie-bramka-partii.spec.ts`
- Modify: `deploy/proba_generalna.sh` (dopisać ścieżkę masowni)

**Interfaces:**
- Consumes: całość.
- Produces: scenariusz E2E „plan biura z jedną partią → na panelu klikalna tylko ona".

- [ ] **Step 1: Write the failing test**

```typescript
// e2e/masowanie-bramka-partii.spec.ts
import { test, expect } from '@playwright/test'

test.describe('panel masowania — bramka partii', () => {
  test('zlecenie z partią biura puszcza tylko tę partię', async ({ page, request }) => {
    // Zasiew: dwie partie mięsa, po palecie na każdą, zlecenie wskazujące partię A.
    const seed = await request.post('/api/test-seed/masownia-bramka')
    expect(seed.ok()).toBeTruthy()
    const { orderNo, lotA, lotB } = await seed.json()

    await page.goto('/masowanie.html')
    await page.getByRole('button', { name: new RegExp(orderNo) }).click()
    await page.getByRole('button', { name: /Załaduj masownicę/ }).click()
    await page.getByRole('button', { name: /Masownica 1/ }).click()

    await expect(page.getByRole('button', { name: new RegExp(lotA) })).toBeEnabled()
    await expect(page.getByRole('button', { name: new RegExp(lotB) })).toBeDisabled()
    await expect(page.getByText(`Biuro wybrało partię ${lotA}`)).toBeVisible()
  })

  test('zlecenie bez partii puszcza całe mięso na stanie', async ({ page, request }) => {
    const seed = await request.post('/api/test-seed/masownia-bez-partii')
    const { orderNo, lotA, lotB } = await seed.json()

    await page.goto('/masowanie.html')
    await page.getByRole('button', { name: new RegExp(orderNo) }).click()
    await page.getByRole('button', { name: /Załaduj masownicę/ }).click()
    await page.getByRole('button', { name: /Masownica 1/ }).click()

    await expect(page.getByRole('button', { name: new RegExp(lotA) })).toBeEnabled()
    await expect(page.getByRole('button', { name: new RegExp(lotB) })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx playwright test e2e/masowanie-bramka-partii.spec.ts`
Expected: FAIL — brak endpointów zasiewu.

- [ ] **Step 3: Write minimal implementation**

Dopisz zasiew do istniejącego modułu testowego backendu (ten sam, z którego
korzystają obecne scenariusze E2E — szukaj `test-seed` w `backend/app/routes/`):
`masownia-bramka` zakłada dwie partie z paletami i zlecenie z jedną partią,
`masownia-bez-partii` to samo bez `mixing_order_lots`. Oba zwracają
`{orderNo, lotA, lotB}`.

W `deploy/proba_generalna.sh` dopisz sprawdzenie, że `dist/masowanie.html`
powstał i że `GET /api/masownia/mieso` odpowiada 200.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx playwright test e2e/masowanie-bramka-partii.spec.ts
npm test && npm run typecheck
```
Expected: PASS — 2 scenariusze E2E, cały pakiet vitest zielony.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/e2e/masowanie-bramka-partii.spec.ts kebab_fixed/deploy/proba_generalna.sh \
        kebab_fixed/backend/app/routes
git commit -m "test(masowanie): e2e bramki partii i probka w probie generalnej"
```

---

## Przed deployem

1. **Diff prod ↔ repo** — obowiązkowy. Zmiany istniejące tylko na produkcji
   scommituj do `main` NAJPIERW, inaczej deploy je nadpisze.
2. Bump wersji w `src-tauri/tauri.masowanie.conf.json` — bez tego auto-update nie
   zejdzie na panel.
3. Migracje weryfikuj **po danych**, nie po wpisie „migrations.done" — `run_migrations()`
   połyka błędy.
4. Deploy backendu = `cp app/` **+ restart**; `reload` po cichu serwuje stary kod.
