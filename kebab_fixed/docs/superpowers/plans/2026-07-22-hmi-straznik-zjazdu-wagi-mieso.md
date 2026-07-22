# Strażnik zjazdu z wagi na ważeniu mięsa — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gdy wózek z mięsem zjedzie z wagi bez naciśnięcia ZAPISZ, HMI rozbioru pokazuje okno z zamrożonym odczytem (pracownik, partia, pobrano/zważono, %) i pozwala zapisać porcję albo domknąć pobranie — zamiast po cichu gubić kilogramy.

**Architecture:** Istniejący tracker `driveOffStep` (dziś tylko kreator ubocznych) zostaje zgeneralizowany na dowolny ładunek `<T>`. Nowy czysty moduł `meatDriveOff.ts` buduje snapshot ważenia mięsa i wybiera wariant przycisków na bazie istniejącej reguły `decideTakeSave`. `DeboningHmiV10Page` trzyma tracker w stanie, renderuje modal i zapisuje **z zamrożonego snapshotu**, nie z żywej wagi.

**Tech Stack:** React 18 + TypeScript, Vite, vitest (testy czystej logiki), Tauri (kiosk rozbior-v10). Backend bez zmian.

**Spec:** `docs/superpowers/specs/2026-07-22-hmi-straznik-zjazdu-wagi-mieso-design.md`

## Global Constraints

- Katalog roboczy: `/opt/kebab/kebab_new/kebab_fixed` (kanoniczne źródła MES). Gałąź `main`.
- Testy uruchamiane jako `TZ=UTC npx vitest run <ścieżka>`; pełny zestaw `npm test`; typy `npm run typecheck`.
- Czysta logika mieszka w `src/features/deboning/utils/` i ma **zero** zależności od React/DOM. Komponenty tylko renderują i wołają hooki.
- Progi domenowe bierzemy z istniejących stałych: `SCALE_EMPTY_KG = 10` (waga uznana za opuszczoną), `PARTIAL_ASK_BELOW_PCT = 63` (dolna granica normy uzysku), `E2_TARE_KG = 2.0`.
- Wszystkie kilogramy zaokrąglane do 0,1 kg (`Math.round(x * 10) / 10`).
- Teksty na ekranie po polsku, wersalikami tylko na przyciskach akcji — jak reszta HMI v10.
- Backendu nie ruszamy: `createTake`, `weighPart`, `completeTake` już istnieją.
- Repo nie ma testów komponentów (brak testing-library). Zadania UI weryfikujemy `npm run typecheck` + `npm run build` + checklistą manualną z Zadania 6.

## Uzupełnienie względem specu

Spec nie przewidział kolizji z kreatorem ubocznych: kreator waży palety **tą samą wagą**, więc tracker mięsa mógłby się uzbroić na odczycie palety grzbietów i po zjeździe wyskoczyć z oknem „zważone mięso — nie zapisano". Dlatego `buildMeatSnapshot` dostaje pole `blocked` i zwraca `null`, gdy otwarty jest kreator ubocznych albo prompt zakończenia partii. Ujęte w Zadaniu 2 (test) i Zadaniu 4 (wpięcie).

## Struktura plików

| Plik | Odpowiedzialność | Zadanie |
|---|---|---|
| `src/features/deboning/utils/weighing.ts` | tracker zjazdu z wagi, generyczny po ładunku | 1 |
| `src/features/deboning/utils/weighing.test.ts` | testy trackera | 1 |
| `src/features/deboning/ByproductsWizard.tsx` | buduje własny `PalletSnapshot` (dotąd robił to tracker) | 1 |
| `src/features/deboning/utils/meatDriveOff.ts` | **nowy** — snapshot ważenia mięsa + wariant przycisków | 2 |
| `src/features/deboning/utils/meatDriveOff.test.ts` | **nowy** — testy powyższego | 2 |
| `src/features/deboning/hooks/index.ts` | `addTake` oddaje utworzone pobranie przez ref | 3 |
| `src/pages/tablet/DeboningHmiV10Page.tsx` | stan trackera, efekt, modal, cztery ścieżki zapisu | 4, 5 |

---

### Task 1: Generalizacja trackera zjazdu z wagi

Tracker przestaje znać budowę palety — ładunek staje się parametrem typu, a snapshot buduje wywołujący. Zachowanie kreatora ubocznych bez zmian.

**Files:**
- Modify: `src/features/deboning/utils/weighing.ts:69-112`
- Modify: `src/features/deboning/ByproductsWizard.tsx:66`, `:78-87`
- Test: `src/features/deboning/utils/weighing.test.ts:74-111`

**Interfaces:**
- Consumes: nic (pierwsze zadanie).
- Produces:
  - `interface DriveOffTracker<T> { armed: T | null; prompt: T | null }`
  - `const DRIVE_OFF_IDLE: DriveOffTracker<never>`
  - `function driveOffStep<T>(state: DriveOffTracker<T>, reading: { connected: boolean; stable: boolean; gross: number }, snap: T | null): DriveOffTracker<T>`
  - `interface PalletSnapshot` (bez zmian: `tareLabel, tareKg, containers, gross, net`)

- [ ] **Step 1: Przepisz testy trackera na jawny snapshot**

W `src/features/deboning/utils/weighing.test.ts` zastąp cały blok `describe('driveOffStep …')` (linie 74–111) poniższym. Zmiana: snapshot jest gotowym obiektem podawanym z zewnątrz, a „dane niekompletne" to `null`. Dochodzi test, że tracker działa dla ładunku innego niż paleta.

```ts
describe('driveOffStep (strażnik zjazdu z wagi)', () => {
  const pallet = { tareLabel: 'H1', tareKg: 18, containers: 12, gross: 538.0, net: 496.0 }
  const onScale = { connected: true, stable: true, gross: 538.0 }
  const offScale = { connected: true, stable: false, gross: 0 }

  it('stabilny kompletny odczyt uzbraja tracker (kandydat do zapisu)', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    expect(s.armed).toEqual(pallet)
    expect(s.prompt).toBeNull()
  })

  it('zjazd z wagi → prompt z ostatnim odczytem, armed się czyści', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const s = driveOffStep(armed, offScale, null)
    expect(s.prompt).toEqual(pallet)
    expect(s.armed).toBeNull()
  })

  it('drganie przy zjeżdżaniu (niestabilne odczyty nad progiem) nie gubi odczytu', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const mid = driveOffStep(armed, { connected: true, stable: false, gross: 214.0 }, pallet)
    expect(mid.armed).toEqual(pallet)
    const s = driveOffStep(mid, offScale, null)
    expect(s.prompt).toEqual(pallet)
  })

  it('snap = null (dane niekompletne) nie uzbraja', () => {
    expect(driveOffStep(DRIVE_OFF_IDLE, onScale, null)).toEqual(DRIVE_OFF_IDLE)
  })

  it('prompt czeka na decyzję — kolejne odczyty go nie nadpisują', () => {
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, pallet)
    const prompted = driveOffStep(armed, offScale, null)
    const next = driveOffStep(prompted, { connected: true, stable: true, gross: 320.0 },
      { ...pallet, gross: 320.0, net: 287.0 })
    expect(next).toEqual(prompted)
  })

  it('waga rozłączona nie uzbraja', () => {
    const s = driveOffStep(DRIVE_OFF_IDLE, { connected: false, stable: true, gross: 538.0 }, pallet)
    expect(s).toEqual(DRIVE_OFF_IDLE)
  })

  it('działa dla dowolnego ładunku — nie tylko palety', () => {
    const meat = { netKg: 100.0, workerName: 'Anatoli' }
    const armed = driveOffStep(DRIVE_OFF_IDLE, onScale, meat)
    expect(driveOffStep(armed, offScale, null).prompt).toEqual(meat)
  })
})
```

- [ ] **Step 2: Uruchom testy — mają paść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/features/deboning/utils/weighing.test.ts`
Expected: FAIL — obecny `driveOffStep` buduje snapshot sam i oczekuje obiektu `{ tareKg, tareLabel, containers, net }`, więc `s.armed` nie będzie równe `pallet`, a wariant z `meat` nie skompiluje się/zwróci śmieci.

- [ ] **Step 3: Zgeneralizuj tracker**

W `src/features/deboning/utils/weighing.ts` zastąp linie 69–112 (od `export interface PalletSnapshot` do końca `driveOffStep`):

```ts
export interface PalletSnapshot {
  tareLabel: string
  tareKg: number
  containers: number
  gross: number
  net: number
}

/** Ładunek jest parametrem: paleta ubocznych (PalletSnapshot) albo ważenie
 * mięsa (MeatSnapshot z meatDriveOff.ts). Tracker zna tylko wagę. */
export interface DriveOffTracker<T> {
  /** Ostatni kompletny stabilny odczyt — kandydat do zapisu. */
  armed: T | null
  /** Zjazd z wagi z niezapisanym odczytem — czeka na decyzję operatora. */
  prompt: T | null
}

export const DRIVE_OFF_IDLE: DriveOffTracker<never> = { armed: null, prompt: null }

/**
 * @param snap gotowy snapshot do zapamiętania albo `null`, gdy dane są
 *   niekompletne (brak tary, brak pracownika, netto 0 …) — wtedy nie uzbrajamy.
 */
export function driveOffStep<T>(
  state: DriveOffTracker<T>,
  reading: { connected: boolean; stable: boolean; gross: number },
  snap: T | null,
): DriveOffTracker<T> {
  // Prompt czeka na decyzję operatora — kolejne odczyty go nie ruszają,
  // inaczej następny wózek wjeżdżający na wagę skasowałby pytanie.
  if (state.prompt) return state
  if (reading.connected && reading.stable && reading.gross > SCALE_EMPTY_KG && snap != null) {
    return { armed: snap, prompt: null }
  }
  if (state.armed && reading.gross <= SCALE_EMPTY_KG) {
    return { armed: null, prompt: state.armed }
  }
  // Niestabilne odczyty nad progiem (drganie przy zjeżdżaniu) — armed zostaje.
  return state
}
```

- [ ] **Step 4: Przenieś budowę snapshotu do kreatora ubocznych**

W `src/features/deboning/ByproductsWizard.tsx` zmień typ stanu (linia 66):

```ts
  const [driveOff, setDriveOff] = useState<DriveOffTracker<PalletSnapshot>>(DRIVE_OFF_IDLE)
```

dopisz `PalletSnapshot` do importu z `utils/weighing` (linia 15–17):

```ts
import {
  E2_TARE_KG, DRIVE_OFF_IDLE, driveOffStep,
  type DriveOffTracker, type PalletSnapshot,
} from '@/features/deboning/utils/weighing'
```

i zastąp efekt (linie 78–87):

```ts
  // Śledź odczyt palety na wadze; zjazd bez „Dodaj do sumy" → driveOff.prompt
  // (pytanie o dodanie). Ratuje najczęstszy błąd: zważył, policzył i zjechał.
  useEffect(() => {
    if (phase !== 'setup') return
    const snap: PalletSnapshot | null = tareKg != null && net > 0
      ? { tareLabel, tareKg, containers, gross, net: Math.round(net * 10) / 10 }
      : null
    setDriveOff(s => driveOffStep(
      s,
      { connected: scale.connected, stable: scale.stable, gross },
      snap,
    ))
  }, [phase, scale.connected, scale.stable, gross, tareKg, tareLabel, containers, net])
```

- [ ] **Step 5: Testy i typy mają przejść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/features/deboning/utils/weighing.test.ts && npm run typecheck`
Expected: PASS (8 testów w bloku `driveOffStep`), typecheck bez błędów.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/deboning/utils/weighing.ts src/features/deboning/utils/weighing.test.ts src/features/deboning/ByproductsWizard.tsx
git commit -m "refactor(rozbior): tracker zjazdu z wagi generyczny po ładunku"
```

---

### Task 2: Moduł `meatDriveOff` — snapshot ważenia mięsa i wariant przycisków

Czysta logika decydująca, **czy** zapamiętać odczyt mięsa i **jakie** przyciski pokazać po zjeździe.

**Files:**
- Create: `src/features/deboning/utils/meatDriveOff.ts`
- Test: `src/features/deboning/utils/meatDriveOff.test.ts`

**Interfaces:**
- Consumes: `decideTakeSave(weighedKg, portionKg, takenKg): 'block' | 'ask' | 'complete'` z `./partialWeighing`.
- Produces:
  - `interface MeatSnapshot { netKg, gross, cartTareKg, e2Count, workerId, workerName, batchId, batchNo, takenKg, weighedSoFarKg, resumeId }`
  - `interface MeatSnapshotInput` (jak niżej)
  - `function buildMeatSnapshot(input: MeatSnapshotInput): MeatSnapshot | null`
  - `type MeatPromptAction = 'part' | 'complete' | 'entry' | 'entry-part'`
  - `interface MeatPromptVariant { primary: MeatPromptAction; secondary: MeatPromptAction | null; totalWeighedKg: number; pct: number }`
  - `function meatPromptVariant(s: MeatSnapshot): MeatPromptVariant`

- [ ] **Step 1: Napisz testy**

Utwórz `src/features/deboning/utils/meatDriveOff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildMeatSnapshot, meatPromptVariant, type MeatSnapshotInput } from './meatDriveOff'

const base: MeatSnapshotInput = {
  autoMode: true,
  connected: true,
  ready: true,
  blocked: false,
  netKg: 100.0,
  gross: 125.5,
  cartTareKg: 5.5,
  e2Count: 10,
  worker: { id: 'w1', name: 'Anatoli' },
  batch: { id: 'b1', internalBatchNo: '412' },
  takenKg: 300.0,
  weighedSoFarKg: 0,
  resumeId: null,
}

describe('buildMeatSnapshot', () => {
  it('komplet danych → snapshot z ZAMROŻONYM netto i kontekstem', () => {
    expect(buildMeatSnapshot(base)).toEqual({
      netKg: 100.0, gross: 125.5, cartTareKg: 5.5, e2Count: 10,
      workerId: 'w1', workerName: 'Anatoli',
      batchId: 'b1', batchNo: '412',
      takenKg: 300.0, weighedSoFarKg: 0, resumeId: null,
    })
  })

  it('tryb ręczny (awaria wagi) → null, nie ma zjazdu do wykrycia', () => {
    expect(buildMeatSnapshot({ ...base, autoMode: false })).toBeNull()
  })

  it('waga rozłączona → null', () => {
    expect(buildMeatSnapshot({ ...base, connected: false })).toBeNull()
  })

  it('brak tary wózka lub pojemników (ready=false) → null', () => {
    expect(buildMeatSnapshot({ ...base, ready: false })).toBeNull()
  })

  it('otwarty kreator ubocznych → null (to paleta na wadze, nie mięso)', () => {
    expect(buildMeatSnapshot({ ...base, blocked: true })).toBeNull()
  })

  it('brak pracownika → null (decyzja: okno tylko przy komplecie danych)', () => {
    expect(buildMeatSnapshot({ ...base, worker: null })).toBeNull()
  })

  it('brak partii → null', () => {
    expect(buildMeatSnapshot({ ...base, batch: null })).toBeNull()
  })

  it('brak pobranej ćwiartki → null', () => {
    expect(buildMeatSnapshot({ ...base, takenKg: 0 })).toBeNull()
  })

  it('netto 0 (pusta waga / sam wózek) → null', () => {
    expect(buildMeatSnapshot({ ...base, netKg: 0 })).toBeNull()
  })

  it('mięso większe niż pobranie → null (błędna tara albo nie ta partia)', () => {
    expect(buildMeatSnapshot({ ...base, netKg: 210, weighedSoFarKg: 100 })).toBeNull()
  })

  it('domykanie pobrania: dolicza wcześniejsze porcje', () => {
    const s = buildMeatSnapshot({ ...base, resumeId: 'e9', weighedSoFarKg: 120 })
    expect(s?.resumeId).toBe('e9')
    expect(s?.weighedSoFarKg).toBe(120)
  })
})

describe('meatPromptVariant', () => {
  const snap = buildMeatSnapshot(base)!

  it('domykanie, 100 z 300 kg = 33% → podpowiada PORCJĘ', () => {
    const v = meatPromptVariant({ ...snap, resumeId: 'e9' })
    expect(v.primary).toBe('part')
    expect(v.secondary).toBe('complete')
    expect(v.totalWeighedKg).toBe(100.0)
    expect(Math.round(v.pct)).toBe(33)
  })

  it('domykanie, 200 z 300 kg = 67% (≥63) → podpowiada CAŁOŚĆ', () => {
    const v = meatPromptVariant({ ...snap, resumeId: 'e9', netKg: 200 })
    expect(v.primary).toBe('complete')
    expect(v.secondary).toBe('part')
    expect(Math.round(v.pct)).toBe(67)
  })

  it('domykanie z wcześniejszymi porcjami: 80 + 120 z 300 = 67% → CAŁOŚĆ', () => {
    const v = meatPromptVariant({ ...snap, resumeId: 'e9', netKg: 120, weighedSoFarKg: 80 })
    expect(v.primary).toBe('complete')
    expect(v.totalWeighedKg).toBe(200.0)
  })

  it('zwykły wpis, 33% → podpowiada „to dopiero część", wpis w rezerwie', () => {
    const v = meatPromptVariant(snap)
    expect(v.primary).toBe('entry-part')
    expect(v.secondary).toBe('entry')
  })

  it('zwykły wpis, 67% → zwykły wpis, bez wariantu części', () => {
    const v = meatPromptVariant({ ...snap, netKg: 200 })
    expect(v.primary).toBe('entry')
    expect(v.secondary).toBeNull()
  })

  it('zaokrągla sumę do 0,1 kg (bez artefaktów float)', () => {
    const v = meatPromptVariant({ ...snap, netKg: 100.15, weighedSoFarKg: 0.1 })
    expect(v.totalWeighedKg).toBe(100.3)
  })
})
```

- [ ] **Step 2: Uruchom testy — mają paść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/features/deboning/utils/meatDriveOff.test.ts`
Expected: FAIL — `Failed to resolve import "./meatDriveOff"`.

- [ ] **Step 3: Napisz moduł**

Utwórz `src/features/deboning/utils/meatDriveOff.ts`:

```ts
/**
 * meatDriveOff.ts — strażnik zjazdu z wagi na ważeniu MIĘSA (HMI rozbiór v10).
 *
 * Operator wjeżdża wózkiem, system liczy netto, po czym wózek zjeżdża z wagi
 * BEZ naciśnięcia ZAPISZ — kilogramy przepadały, bo `meat` liczy się z żywego
 * odczytu. Ten moduł decyduje, czy odczyt wolno zapamiętać (`buildMeatSnapshot`)
 * i jakie wyjścia pokazać po zjeździe (`meatPromptVariant`).
 *
 * Sam tracker (uzbrojenie/zjazd) siedzi w weighing.ts — tu tylko ładunek.
 */
import { decideTakeSave } from './partialWeighing'

/** Zamrożony odczyt ważenia mięsa — wszystko, czego potrzeba do zapisu PO
 * zjeździe z wagi (scale.gross jest wtedy zerem, więc żywych danych nie ma). */
export interface MeatSnapshot {
  netKg: number
  gross: number
  cartTareKg: number | null
  e2Count: number
  workerId: string
  workerName: string
  batchId: string
  batchNo: string
  /** Pobrana ćwiartka (kg). */
  takenKg: number
  /** Porcje zważone wcześniej w ramach tego pobrania (0 w trybie zwykłym). */
  weighedSoFarKg: number
  /** != null = domykanie otwartego pobrania. */
  resumeId: string | null
}

export interface MeatSnapshotInput {
  /** Mięso liczone z wagi (false = operator przejął ręcznie). */
  autoMode: boolean
  connected: boolean
  /** Tara wózka wybrana i brutto > tara (computeWeighing().ready). */
  ready: boolean
  /** Otwarty kreator ubocznych / prompt zakończenia partii — na wadze stoi
   * paleta grzbietów, nie wózek z mięsem. */
  blocked: boolean
  netKg: number
  gross: number
  cartTareKg: number | null
  e2Count: number
  worker: { id: string; name: string } | null
  batch: { id: string; internalBatchNo: string } | null
  takenKg: number
  weighedSoFarKg: number
  resumeId: string | null
}

/** Snapshot albo `null` = nie uzbrajaj trackera. Okno pojawia się WYŁĄCZNIE
 * przy komplecie danych (decyzja użytkownika 2026-07-22) — przy braku
 * pracownika czy ćwiartki zachowujemy się jak dotąd. */
export function buildMeatSnapshot(i: MeatSnapshotInput): MeatSnapshot | null {
  if (!i.autoMode || !i.connected || !i.ready || i.blocked) return null
  if (!i.worker || !i.batch) return null
  if (i.takenKg <= 0 || i.netKg <= 0) return null
  if (i.weighedSoFarKg + i.netKg > i.takenKg) return null
  return {
    netKg: i.netKg,
    gross: i.gross,
    cartTareKg: i.cartTareKg,
    e2Count: i.e2Count,
    workerId: i.worker.id,
    workerName: i.worker.name,
    batchId: i.batch.id,
    batchNo: i.batch.internalBatchNo,
    takenKg: i.takenKg,
    weighedSoFarKg: i.weighedSoFarKg,
    resumeId: i.resumeId,
  }
}

/** part = zapisz porcję (pobranie otwarte) · complete = domknij pobranie ·
 *  entry = zwykły wpis ćwiartka+mięso · entry-part = zamień wpis na otwarte
 *  pobranie i zapisz porcję. */
export type MeatPromptAction = 'part' | 'complete' | 'entry' | 'entry-part'

export interface MeatPromptVariant {
  /** Przycisk wypełniony — podpowiedź systemu. */
  primary: MeatPromptAction
  /** Przycisk obrysowany; null = brak drugiego wyjścia. */
  secondary: MeatPromptAction | null
  /** Zważone łącznie z tą porcją (kg, 0,1). */
  totalWeighedKg: number
  /** Procent pobrania po tej porcji. */
  pct: number
}

export function meatPromptVariant(s: MeatSnapshot): MeatPromptVariant {
  const totalWeighedKg = Math.round((s.weighedSoFarKg + s.netKg) * 10) / 10
  const pct = s.takenKg > 0 ? (totalWeighedKg / s.takenKg) * 100 : 0
  // Ta sama reguła co po ręcznym ZAPISZ: ≥63% uzysku = pewnie całość.
  const decision = decideTakeSave(s.weighedSoFarKg, s.netKg, s.takenKg)
  if (s.resumeId) {
    return decision === 'complete'
      ? { primary: 'complete', secondary: 'part', totalWeighedKg, pct }
      : { primary: 'part', secondary: 'complete', totalWeighedKg, pct }
  }
  return decision === 'complete'
    ? { primary: 'entry', secondary: null, totalWeighedKg, pct }
    : { primary: 'entry-part', secondary: 'entry', totalWeighedKg, pct }
}
```

- [ ] **Step 4: Testy mają przejść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/features/deboning/utils/meatDriveOff.test.ts`
Expected: PASS — 17 testów.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/deboning/utils/meatDriveOff.ts src/features/deboning/utils/meatDriveOff.test.ts
git commit -m "feat(rozbior): logika strażnika zjazdu z wagi dla ważenia mięsa"
```

---

### Task 3: `addTake` oddaje utworzone pobranie

Ścieżka „TO DOPIERO CZĘŚĆ" robi `addTake` → `weighPart`, więc potrzebuje `id` nowego pobrania **w tym samym obrocie funkcji**. Stan Reacta jest za późno — ref jest w sam raz.

**Files:**
- Modify: `src/features/deboning/hooks/index.ts:181-200` (funkcja `addTake`), `:296-314` (obiekt zwracany)

**Interfaces:**
- Consumes: `deboningApi.createTake(dto): Promise<DeboningEntry>` (już istnieje).
- Produces: hook `useDeboningEntries` zwraca dodatkowo `lastTakeRef: React.MutableRefObject<DeboningEntry | null>` — ustawiany po każdym udanym `addTake`.

- [ ] **Step 1: Dodaj ref i zapisuj do niego utworzone pobranie**

W `src/features/deboning/hooks/index.ts`, tuż nad `const createTakeMutation = …` (linia 175) dopisz:

```ts
  // Utworzone pobranie z ostatniego addTake. Ref, nie stan: ścieżka „to dopiero
  // część" (HMI: zjazd z wagi) potrzebuje id od razu, żeby dopiąć weighPart.
  const lastTakeRef = useRef<DeboningEntry | null>(null)
```

(`useRef` jest już zaimportowane w linii 8.)

W ciele `addTake` zastąp blok `try` (linie 193–199):

```ts
    try {
      const created = await createTakeMutation.mutate(dto)
      lastTakeRef.current = created ?? null
      refetch()
      return null
    } catch (e) {
      lastTakeRef.current = null
      return e instanceof Error ? e.message : 'Błąd zapisu pobrania'
    }
```

W obiekcie zwracanym (po linii `lastCreated,`) dopisz:

```ts
    lastTakeRef,
```

- [ ] **Step 2: Typy mają przejść**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów.

- [ ] **Step 3: Pełny zestaw testów bez regresji**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test`
Expected: PASS, wszystkie pliki testowe.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/deboning/hooks/index.ts
git commit -m "feat(rozbior): addTake oddaje utworzone pobranie przez ref"
```

---

### Task 4: Wpięcie trackera w HMI + wyodrębnienie domknięcia partii

Strona zaczyna śledzić zjazd z wagi i kasować tracker po każdym zapisie. Osobno wyciągamy dwie kopie logiki „partia wyczerpana → prompt ubocznych", żeby Zadanie 5 nie zrobiło z nich trzeciej i czwartej.

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx` — importy (`:23-27`), stan (przy `:448`), nowy efekt (za blokiem `weighing`, `:655-660`), `handleSave` (`:876-889`), `doCompleteTake` (`:968-979`), `cancelResume` (`:802-805`), `handleWeighPart` (`:936-940`), `handleSaveTake` (`:900-902`)

**Interfaces:**
- Consumes: `driveOffStep`, `DRIVE_OFF_IDLE`, `DriveOffTracker` (Zadanie 1); `buildMeatSnapshot`, `MeatSnapshot` (Zadanie 2).
- Produces (dla Zadania 5):
  - stan `meatDriveOff: DriveOffTracker<MeatSnapshot>` + `setMeatDriveOff`
  - `function maybeFinishBatch(b: RawBatch, takenKg: number): void`
  - `function maybeFinishAfterComplete(batchId: string, completedId: string): void`

- [ ] **Step 1: Importy**

W `src/pages/tablet/DeboningHmiV10Page.tsx` rozszerz import z `utils/weighing` (linie 25–27) i dopisz nowy:

```ts
import {
  computeWeighing, sanitizeCartTares, CART_TARES_KG, E2_TARE_KG, KG_PER_E2_MIN, KG_PER_E2_MAX,
  DRIVE_OFF_IDLE, driveOffStep, type DriveOffTracker,
} from '@/features/deboning/utils/weighing'
import {
  buildMeatSnapshot, meatPromptVariant, type MeatSnapshot,
} from '@/features/deboning/utils/meatDriveOff'
```

(`meatPromptVariant` użyje dopiero Zadanie 5 — importujemy raz, żeby nie wracać do tej linii.)

- [ ] **Step 2: Stan trackera**

Pod deklaracją `partialPrompt` (linia 448) dopisz:

```ts
  // Zjazd z wagi bez ZAPISZ — zamrożony odczyt czeka na decyzję operatora.
  const [meatDriveOff, setMeatDriveOff] = useState<DriveOffTracker<MeatSnapshot>>(DRIVE_OFF_IDLE)
```

- [ ] **Step 3: Wyciągnij `lastTakeRef` z hooka**

W destrukturyzacji `useDeboningEntries` (linia 396) dopisz `lastTakeRef` na końcu listy:

```ts
  const { entries, addEntry, addTake, completeTake, weighPart, editTake, editEntry, removeEntry, lastCreated, lastTakeRef, addLoading, addTakeLoading, completeTakeLoading, weighPartLoading, removeLoading } = useDeboningEntries(session?.id ?? null)
```

- [ ] **Step 4: Efekt śledzący wagę**

Bezpośrednio pod blokiem liczącym `canSaveTake` (za linią 669) dopisz:

```ts
  // Strażnik zjazdu z wagi: zapamiętaj ostatni kompletny stabilny odczyt mięsa,
  // a gdy wózek zjedzie bez ZAPISZ — pokaż okno z zamrożonymi kilogramami.
  useEffect(() => {
    const snap = buildMeatSnapshot({
      autoMode,
      connected: scale.connected,
      ready: weighing.ready,
      blocked: wizard != null || finishPrompt != null,
      netKg: weighing.netKg,
      gross: scale.gross,
      cartTareKg: cartTareTotal,
      e2Count,
      worker: selWorker,
      batch: selBatch,
      takenKg: taken,
      weighedSoFarKg: resumeWeighedKg,
      resumeId,
    })
    setMeatDriveOff(s => driveOffStep(
      s,
      { connected: scale.connected, stable: scale.stable, gross: scale.gross },
      snap,
    ))
  }, [autoMode, scale.connected, scale.stable, scale.gross, weighing.ready, weighing.netKg,
      cartTareTotal, e2Count, selWorker, selBatch, taken, resumeWeighedKg, resumeId,
      wizard, finishPrompt])
```

- [ ] **Step 5: Kasuj tracker po każdym zapisie i przy anulowaniu domykania**

Dopisz `setMeatDriveOff(DRIVE_OFF_IDLE)` w czterech miejscach, zaraz obok istniejących `setKgTaken(''); setKgMeat('')`:

- `handleSave` — po `if (err) { … return }`, przy czyszczeniu pól (linia 858)
- `handleSaveTake` — przy czyszczeniu pól (linia 901)
- `handleWeighPart` — po `setPartialPrompt(null)` (linia 937)
- `doCompleteTake` — przy czyszczeniu pól (linia 966)

oraz w `cancelResume` (linie 802–805):

```ts
  const cancelResume = useCallback(() => {
    setResumeId(null)
    setMeatDriveOff(DRIVE_OFF_IDLE)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
  }, [])
```

- [ ] **Step 6: Wyodrębnij „partia wyczerpana → prompt ubocznych" (zwykły wpis)**

W `handleSave` zastąp końcowy blok (linie 876–889) wywołaniem:

```ts
    maybeFinishBatch(selBatch, taken)
  }

  // Automatyczne zakończenie partii: gdy sztuka wyczerpała ćwiartkę (zostało
  // mniej niż na kolejną), sam pokazuj komunikat o ważeniu ubocznych — bez
  // klikania „Zakończ partię". Wołane z ZAPISZ i z okna zjazdu z wagi.
  function maybeFinishBatch(b: RawBatch, takenKg: number) {
    const remaining = Number(b.kgAvailable) - takenKg
    if (remaining > 0.5) return
    if (byproductsByBatch.has(b.id)) return
    if (pendingTakes.some(p => (p as any).rawBatchId === b.id)) return
    setSelBatch(prev => (prev?.id === b.id ? null : prev)) // wyczerpana — operator wybierze następną
    byproductsApi.finish(b.id, loggedInUser?.name)
      .then(rec => { byproductsData.refetch(); setFinishPrompt({ batch: b, record: rec }) })
      // Backend i tak sam zakańcza wyczerpaną partię (gwarancja serwerowa) —
      // tu tylko informacja, że prompt ważenia nie wyskoczył.
      .catch(() => showToast(`Partia ${b.internalBatchNo} wyczerpana — zważ uboczne z szarego kafla`, 'err'))
  }
```

- [ ] **Step 7: Wyodrębnij to samo dla domknięcia pobrania**

W `doCompleteTake` zastąp końcowy blok (linie 969–979):

```ts
    maybeFinishAfterComplete(selBatch?.id ?? '', completedId)
  }

  // Domknięcie OSTATNIEGO pobrania wyczerpanej partii = koniec rozbioru →
  // prompt ważenia ubocznych. Backend i tak sam zakańcza (gwarancja serwerowa).
  function maybeFinishAfterComplete(batchId: string, completedId: string) {
    if (!batchId) return
    const all = (batchData.data?.data ?? []) as RawBatch[]
    const b = all.find(x => x.id === batchId) ?? (selBatch?.id === batchId ? selBatch : null)
    if (!b) return
    const others = pendingTakes.filter(p => (p as any).rawBatchId === batchId && p.id !== completedId)
    if (others.length > 0) return
    if (Number(b.kgAvailable) > 0.5 || byproductsByBatch.has(b.id)) return
    setSelBatch(prev => (prev?.id === b.id ? null : prev))
    byproductsApi.finish(b.id, loggedInUser?.name)
      .then(rec => { byproductsData.refetch(); setFinishPrompt({ batch: b, record: rec }) })
      .catch(() => {})
  }
```

- [ ] **Step 8: Typy, testy, build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck && npm test && npm run build`
Expected: brak błędów typów, testy PASS, build OK.

- [ ] **Step 9: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/DeboningHmiV10Page.tsx
git commit -m "feat(rozbior): HMI śledzi zjazd z wagi przy ważeniu mięsa"
```

---

### Task 5: Okno „ZWAŻONE — NIE ZAPISANO" i cztery ścieżki zapisu

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx` — nowe funkcje obok `handleWeighPart` (za linią 941), nowy modal przed blokiem `{partialPrompt && …}` (linia 1152)

**Interfaces:**
- Consumes: `meatDriveOff`, `setMeatDriveOff`, `maybeFinishBatch`, `maybeFinishAfterComplete` (Zadanie 4); `meatPromptVariant`, `MeatSnapshot` (Zadanie 2); `lastTakeRef` (Zadanie 3); istniejące `addEntry`, `addTake`, `weighPart`, `completeTake`, `showToast`, `fmtKg`, `fmtPct`.
- Produces: nic dla dalszych zadań.

- [ ] **Step 1: DTO z zamrożonego snapshotu**

Za `handleWeighPart` (linia 941) dopisz:

```ts
  // ── Zjazd z wagi bez ZAPISZ: zapis z ZAMROŻONEGO odczytu ──────────────────
  // Wózek już zjechał, więc scale.gross to zero — wszystkie liczby muszą iść
  // ze snapshotu, inaczej wpis wyląduje z 0 kg i bezsensowną tarą.
  function driveOffDto(s: MeatSnapshot) {
    return {
      kgMeat: s.netKg,
      weighMode: 'auto' as const,
      kgGross: s.gross,
      tareCartKg: s.cartTareKg ?? undefined,
      tareE2Kg: Math.round(s.e2Count * E2_TARE_KG * 10) / 10,
      e2Count: s.e2Count,
    }
  }

  // Partia ze snapshotu (operator mógł w międzyczasie nic nie zmienić — modal
  // przykrywa ekran — ale partia bywa już poza listą aktywnych, gdy zeszła do 0).
  function driveOffBatch(s: MeatSnapshot): RawBatch | null {
    const all = (batchData.data?.data ?? []) as RawBatch[]
    return all.find(x => x.id === s.batchId) ?? (selBatch?.id === s.batchId ? selBatch : null)
  }

  function clearAfterDriveOff() {
    setMeatDriveOff(DRIVE_OFF_IDLE)
    setResumeId(null)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 350)
  }
```

- [ ] **Step 2: Cztery ścieżki zapisu**

Bezpośrednio pod spodem dopisz:

```ts
  // Porcja — pobranie zostaje otwarte, mięso od razu na magazyn.
  async function driveOffSavePart(s: MeatSnapshot) {
    if (!session || !s.resumeId) return
    const err = await weighPart(s.resumeId, driveOffDto(s), session)
    if (err) { showToast(err, 'err'); return } // okno zostaje — operator ponawia
    clearAfterDriveOff()
    showToast(`Zapisano ${fmtKg(s.netKg, 1)} kg — razem ${fmtKg(s.weighedSoFarKg + s.netKg, 1)}/${fmtKg(s.takenKg, 1)} kg, pobranie otwarte`)
  }

  // Całość — domknięcie otwartego pobrania.
  async function driveOffComplete(s: MeatSnapshot) {
    if (!session || !s.resumeId) return
    const err = await completeTake(s.resumeId, driveOffDto(s), session)
    if (err) { showToast(err, 'err'); return }
    clearAfterDriveOff()
    batchData.refetch()
    showToast(`Zważono ${fmtKg(s.netKg, 1)} kg mięsa`)
    maybeFinishAfterComplete(s.batchId, s.resumeId)
  }

  // Zwykły wpis: ćwiartka + mięso w jednym rekordzie (jak ZAPISZ).
  async function driveOffSaveEntry(s: MeatSnapshot) {
    if (!session) return
    const b = driveOffBatch(s)
    if (!b) { showToast('Partia zniknęła z listy — zapisz wpis ręcznie', 'err'); return }
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: s.batchId, workerId: s.workerId, kgTaken: s.takenKg, ...driveOffDto(s) },
      session, Number(b.kgAvailable), b.expiryDate,
    )
    if (err) { showToast(err, 'err'); return }
    clearAfterDriveOff()
    batchData.refetch()
    setUndoUntil(Date.now() + 60_000); setUndoNow(Date.now())
    showToast(`Zapisano: ${fmtKg(s.netKg)} kg mięsa`)
    maybeFinishBatch(b, s.takenKg)
  }

  // „To dopiero część" w trybie zwykłym: zamiast wpisu z fałszywym uzyskiem
  // zakładamy POBRANIE na całą ćwiartkę i dopinamy zważoną porcję.
  async function driveOffSaveEntryPart(s: MeatSnapshot) {
    if (!session) return
    const b = driveOffBatch(s)
    if (!b) { showToast('Partia zniknęła z listy — zapisz wpis ręcznie', 'err'); return }
    const takeErr = await addTake(
      { sessionId: session.id, rawBatchId: s.batchId, workerId: s.workerId, kgTaken: s.takenKg },
      session, Number(b.kgAvailable), b.expiryDate,
    )
    if (takeErr) { showToast(takeErr, 'err'); return }
    const created = lastTakeRef.current
    if (!created) { showToast('Pobranie zapisane — zważ porcję z kafelka pracownika', 'err'); setMeatDriveOff(DRIVE_OFF_IDLE); return }
    const err = await weighPart(created.id, driveOffDto(s), session)
    if (err) { showToast(err, 'err'); setMeatDriveOff(DRIVE_OFF_IDLE); return }
    clearAfterDriveOff()
    batchData.refetch()
    showToast(`Zapisano ${fmtKg(s.netKg, 1)} kg z ${fmtKg(s.takenKg, 1)} kg — pobranie zostaje otwarte`)
  }

  function runDriveOffAction(action: MeatPromptAction, s: MeatSnapshot) {
    if (action === 'part') { void driveOffSavePart(s); return }
    if (action === 'complete') { void driveOffComplete(s); return }
    if (action === 'entry') { void driveOffSaveEntry(s); return }
    void driveOffSaveEntryPart(s)
  }

  const DRIVE_OFF_LABEL: Record<MeatPromptAction, string> = {
    part: 'ZAPISZ PORCJĘ — RESZTA DOJEDZIE',
    complete: 'TO CAŁOŚĆ — ZAMKNIJ POBRANIE',
    entry: 'ZAPISZ WPIS',
    'entry-part': 'TO DOPIERO CZĘŚĆ — POBRANIE ZOSTAJE OTWARTE',
  }
```

Do importu z `meatDriveOff` (Zadanie 4, Step 1) dopisz typ `MeatPromptAction`:

```ts
import {
  buildMeatSnapshot, meatPromptVariant, type MeatSnapshot, type MeatPromptAction,
} from '@/features/deboning/utils/meatDriveOff'
```

- [ ] **Step 3: Modal**

Bezpośrednio przed blokiem `{/* Częściowe ważenie: łączny % poniżej normy … */}` (linia 1151) wstaw:

```tsx
      {/* Zjazd z wagi bez ZAPISZ — zamrożony odczyt czeka na decyzję. */}
      {meatDriveOff.prompt && (() => {
        const s = meatDriveOff.prompt
        const v = meatPromptVariant(s)
        const busy = addLoading || addTakeLoading || weighPartLoading || completeTakeLoading
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" style={VARS}>
            <div className="w-[520px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 flex items-center justify-center flex-shrink-0" style={{ borderRadius: 12, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}><Scale size={26} /></div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-xl leading-tight">Zważone — nie zapisano</h3>
                  <p className="text-sm" style={{ color: 'var(--mut)' }}>
                    {s.workerName} · partia {s.batchNo}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="hmi-v10-mono font-extrabold text-5xl text-center" style={{ color: 'var(--accent)' }}>
                  {fmtKg(s.netKg, 1)} kg
                </div>
                <div className="text-sm font-bold text-center" style={{ color: 'var(--mut)' }}>
                  pobrano {fmtKg(s.takenKg, 1)} kg · zważono {fmtKg(v.totalWeighedKg, 1)} kg
                </div>
                <div className="w-full h-3 overflow-hidden" style={{ borderRadius: 999, background: 'var(--bg)', border: '1px solid var(--line)' }}>
                  <div style={{ width: `${Math.min(100, Math.max(0, v.pct))}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
                <div className="text-sm font-bold text-center">{fmtPct(v.pct, 0)} pobrania</div>
              </div>

              <div className="flex flex-col gap-3">
                <button type="button" disabled={busy} onClick={() => runDriveOffAction(v.primary, s)}
                  className="h-14 text-base font-bold flex items-center justify-center gap-3"
                  style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
                  {busy ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={20} />}
                  {DRIVE_OFF_LABEL[v.primary]}
                </button>
                {v.secondary && (
                  <button type="button" disabled={busy} onClick={() => runDriveOffAction(v.secondary as MeatPromptAction, s)}
                    className="h-14 text-base font-bold"
                    style={{ borderRadius: 10, border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
                    {DRIVE_OFF_LABEL[v.secondary]}
                  </button>
                )}
                {/* Anuluj: nisko, szaro, pod kreską — palec nie może go pomylić z zapisem. */}
                <div style={{ height: 1, background: 'var(--line)', marginTop: 4 }} />
                <button type="button" disabled={busy} onClick={() => setMeatDriveOff(DRIVE_OFF_IDLE)}
                  className="h-10 text-sm font-bold self-center px-8"
                  style={{ borderRadius: 10, color: 'var(--mut)', background: 'transparent' }}>
                  anuluj
                </button>
              </div>
            </div>
          </div>
        )
      })()}
```

- [ ] **Step 4: Sprawdź, że zmienne z modala istnieją pod tymi nazwami**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && grep -n "const VARS\|ambSoft\|hmi-v10-mono\|setUndoUntil\|saveFlashRef" src/pages/tablet/DeboningHmiV10Page.tsx | head -20`
Expected: `VARS`, `saveFlashRef`, `setUndoUntil` istnieją w pliku, `--ambSoft`/`--ambLine`/`--amb` są zdefiniowane w `VARS` (używa ich modal `partialPrompt`), klasa `hmi-v10-mono` jest w `DeboningHmiV10Page.css`. Jeśli któregoś brakuje — użyj nazwy faktycznie obecnej w pliku, nie dodawaj nowych zmiennych CSS.

- [ ] **Step 5: Typy, testy, build**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck && npm test && npm run build`
Expected: brak błędów, testy PASS, build OK.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/DeboningHmiV10Page.tsx
git commit -m "feat(rozbior): okno zapisu po zjeździe z wagi przy ważeniu mięsa"
```

---

### Task 6: Weryfikacja na żywym HMI

Testów komponentów w repo nie ma, więc ścieżki UI sprawdzamy ręcznie w przeglądarce z symulowaną wagą albo na kiosku hali.

**Files:**
- Modify (dopiero po zaakceptowaniu przez użytkownika): `src-tauri/tauri.rozbior-v10.conf.json` — bump `version` z `1.0.60`

- [ ] **Step 1: Odpal dev i wejdź na HMI**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run dev`
Otwórz `http://localhost:5173/rozbior-v10.html`. Bez podłączonej wagi strażnik jest bezczynny (`autoMode=false`) — do pełnej weryfikacji potrzebny kiosk z wagą albo mock `useScale`.

- [ ] **Step 2: Przejdź checklistę**

| # | Scenariusz | Oczekiwane |
|---|---|---|
| 1 | Partia + pracownik + ćwiartka 300, wjazd wózkiem (100 kg netto), zjazd bez ZAPISZ | Okno: „Anatoli · partia 412", 100,0 kg, „pobrano 300,0 · zważono 100,0", 33%, wypełniony „TO DOPIERO CZĘŚĆ" |
| 2 | W oknie z pkt 1 → „TO DOPIERO CZĘŚĆ" | Pobranie 300 kg widoczne na kafelku pracownika jako „⏳ czeka", zważone 100 kg na magazynie |
| 3 | Kafelek „⏳ czeka" → wjazd 100 kg → zjazd bez ZAPISZ | Okno pokazuje „zważono 200,0" (dolicza wcześniejsze), 67%, wypełniony „TO CAŁOŚĆ" |
| 4 | W oknie z pkt 3 → „ZAPISZ PORCJĘ" | Pobranie nadal otwarte, suma 200/300 |
| 5 | Ćwiartka 300, wjazd 200 kg, zjazd | Wypełniony „ZAPISZ WPIS", brak drugiego przycisku (67% ≥ 63%) |
| 6 | Dowolne okno → „anuluj" | Okno znika, nic nie zapisane, kolejny wjazd na wagę znów uzbraja tracker |
| 7 | Zjazd bez wybranego pracownika | Okno **nie** wyskakuje (decyzja: tylko komplet danych) |
| 8 | Otwarty kreator ubocznych, ważenie palety grzbietów i zjazd | Okno mięsa **nie** wyskakuje — działa wyłącznie prompt kreatora |
| 9 | Zjazd z wagi, okno otwarte, wjazd następnego wózka | Okno stoi z pierwszym odczytem, nie podmienia się |
| 10 | Zapis z okna przy wyłączonym backendzie | Toast z błędem, okno **zostaje** — odczyt się nie gubi |
| 11 | Ostatnia sztuka wyczerpuje partię, zapis z okna | Wyskakuje prompt ważenia ubocznych (jak po zwykłym ZAPISZ) |

- [ ] **Step 3: Sprawdź dane w bazie po scenariuszu 2**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && grep -rn "kg_gross" backend/app/models/deboning.py backend/app/services/deboning_service.py | head -5`
Nazwy kolumn weź z wyniku, a potem sprawdź w bazie (MCP `kebab-mes-db` albo psql na 5433, baza `kebab_mes`), że wpis zapisany z okna ma `kg_gross` i tarę wózka ze snapshotu, a **nie** zera — to jest główna pułapka tej zmiany.

- [ ] **Step 4: Commit ewentualnych poprawek z checklisty**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add -A
git commit -m "fix(rozbior): poprawki po weryfikacji strażnika zjazdu z wagi"
```

- [ ] **Step 5: Wydanie kiosku — dopiero na wyraźną zgodę użytkownika**

Bump `version` w `src-tauri/tauri.rozbior-v10.conf.json` (`1.0.60` → `1.0.61`) i tag `rozbior-v10-1.0.61` z `main`. Bump jest **obowiązkowy** — bez niego auto-update kiosków nie podmieni wersji. Przed wypchnięciem: `git diff` produkcji względem repo (zmiany prod-only scommitować do `main` NAJPIERW).

---

## Kolejność i zależności

```
Task 1 (tracker generyczny) ─┬─> Task 4 (wpięcie w HMI) ──> Task 5 (modal) ──> Task 6 (weryfikacja)
Task 2 (meatDriveOff) ───────┤
Task 3 (addTake → ref) ──────┘
```

Zadania 1–3 są niezależne i mogą lecieć równolegle. Zadania 4 i 5 dotykają tego samego pliku — sekwencyjnie.
