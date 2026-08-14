# Ważenie zbiorcze mięsa — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kiosk rozbioru dostaje ekran „Ważenie zbiorcze": operator kompletuje równą paletę albo wózek (100/200/400/600/800 kg), system pilnuje wagi, proponuje skład partii wg FEFO i drukuje etykietę z QR.

**Architecture:** Czysta logika (podział FEFO, tolerancja, netto słupka, ZPL) siedzi w osobnych modułach testowanych w vitest. Ekran HMI składa je i korzysta z istniejącego mostu wagowego (`useScale`) oraz drukarki (`@/lib/zebra`). Backend zapisuje wyłącznie OPIS palety — dwie nowe tabele, zero `stock_movements`.

**Tech Stack:** React 18 + TypeScript (kiosk), FastAPI + psycopg2, pytest, vitest, ZPL (Zebra BrowserPrint).

**Spec:** `docs/superpowers/specs/2026-08-14-wazenie-zbiorcze-miesa-design.md`

## Global Constraints

- **Zero ruchów magazynowych.** Mięso jest na stanie od rozbioru. Żadnych `stock_movements`, `kg_reserved` ani zmian `meat_stock`. Test regresyjny tego pilnuje.
- **Tolerancja ±0,5 kg** — na celu słupka (gdzie zdefiniowany) i zawsze na celu łącznym. Poza tolerancją zapis JEST możliwy, tylko ostrzegamy: to ważenie, nie wróżenie.
- **Tara nośnika tylko przy PIERWSZYM słupku** — potem paleta zostaje na wadze i operator ją taruje. Pojemniki (`E2_TARE_KG` = 2 kg) odejmujemy przy każdym słupku.
- **Suma składu = waga palety** (±0,05 kg na zaokrąglenia), inaczej backend odrzuca zapis.
- **Język:** UI, błędy, komentarze i nazwy testów po polsku.
- **Testy DB:** `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest ...` — bez tego cicho się pomijają.
- **Kiosk:** każde wydanie to bump wersji w `src-tauri/tauri.rozbior-v10.conf.json` i tag `rozbior-v10-*`.
- Katalogi: front `/opt/kebab/kebab_new/kebab_fixed`, backend `.../backend`.

---

### Task 1: Kafelki celu i tolerancja

**Files:**
- Create: `src/features/deboning/meatPallet.ts`
- Create: `src/features/deboning/meatPallet.test.ts`

**Interfaces:**
- Produces:
  - `interface PalletTarget { key: string; label: string; totalKg: number; stackKg: number | null; stacks: number | null; hint: string }`
  - `PALLET_TARGETS: PalletTarget[]`
  - `TOLERANCE_KG = 0.5`
  - `withinTolerance(kg: number, target: number): boolean`
  - `stackNetKg(gross: number, carrierKg: number, containers: number, isFirstStack: boolean): number`

- [ ] **Step 1: Test (czerwony)**

```ts
import { describe, it, expect } from 'vitest'
import {
  PALLET_TARGETS, TOLERANCE_KG, withinTolerance, stackNetKg,
} from './meatPallet'

describe('PALLET_TARGETS — kafelki celu', () => {
  it('pięć kafelków w kolejności od najmniejszego', () => {
    expect(PALLET_TARGETS.map(t => t.totalKg)).toEqual([100, 200, 400, 600, 800])
  })

  it('400 i 800 prowadzą po cztery słupki, 600 jest bez podziału', () => {
    const wg = (kg: number) => PALLET_TARGETS.find(t => t.totalKg === kg)!
    expect(wg(400).stackKg).toBe(100)
    expect(wg(400).stacks).toBe(4)
    expect(wg(800).stackKg).toBe(200)
    expect(wg(800).stacks).toBe(4)
    expect(wg(600).stackKg).toBeNull()
    expect(wg(600).stacks).toBeNull()
  })

  it('100 i 200 to jedno ważenie na wózku', () => {
    const wg = (kg: number) => PALLET_TARGETS.find(t => t.totalKg === kg)!
    expect(wg(100).stacks).toBe(1)
    expect(wg(200).stacks).toBe(1)
    expect(wg(200).stackKg).toBe(200)
  })
})

describe('withinTolerance — ±0,5 kg', () => {
  it('100,4 kg mieści się w normie', () => {
    expect(withinTolerance(100.4, 100)).toBe(true)
  })

  it('100,6 kg już nie', () => {
    expect(withinTolerance(100.6, 100)).toBe(false)
  })

  it('granica 0,5 kg należy do normy', () => {
    expect(withinTolerance(99.5, 100)).toBe(true)
    expect(withinTolerance(100.5, 100)).toBe(true)
  })

  it('tolerancja to pół kilograma', () => {
    expect(TOLERANCE_KG).toBe(0.5)
  })
})

describe('stackNetKg — netto słupka', () => {
  it('pierwszy słupek odejmuje nośnik i pojemniki', () => {
    // brutto 130, paleta H1 18 kg, 5 pojemników × 2 kg
    expect(stackNetKg(130, 18, 5, true)).toBe(102)
  })

  it('kolejny słupek NIE odejmuje nośnika — paleta jest już wytarowana', () => {
    expect(stackNetKg(110, 18, 5, false)).toBe(100)
  })

  it('nie schodzi poniżej zera przy pustej wadze', () => {
    expect(stackNetKg(0, 18, 0, true)).toBe(0)
  })

  it('zaokrągla do 0,1 kg — waga ma działkę 0,5, ale liczymy stabilnie', () => {
    expect(stackNetKg(110.44, 0, 0, false)).toBe(110.4)
  })
})
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `npx vitest run src/features/deboning/meatPallet.test.ts`
Expected: FAIL — `Failed to load url ./meatPallet`

- [ ] **Step 3: Implementacja**

```ts
/**
 * Ważenie zbiorcze mięsa — kafelki celu i arytmetyka słupka.
 *
 * Kafelek niesie cel ŁĄCZNY i opcjonalnie cel SŁUPKA. Gdzie cel słupka jest,
 * ekran prowadzi słupek po słupku (paleta: cztery równe stosy); gdzie go nie
 * ma, operator dokłada swobodnie aż do celu łącznego.
 */
export const TOLERANCE_KG = 0.5

export interface PalletTarget {
  key: string
  label: string
  totalKg: number
  /** Cel jednego słupka albo null, gdy kafelek nie dzieli palety. */
  stackKg: number | null
  /** Ile słupków przewiduje kafelek (null = dowolnie). */
  stacks: number | null
  hint: string
}

export const PALLET_TARGETS: PalletTarget[] = [
  { key: 't100', label: '100 kg', totalKg: 100, stackKg: 100, stacks: 1, hint: 'wózek' },
  { key: 't200', label: '200 kg', totalKg: 200, stackKg: 200, stacks: 1, hint: 'wózek' },
  { key: 't400', label: '400 kg', totalKg: 400, stackKg: 100, stacks: 4, hint: 'paleta — 4 słupki po 100 kg' },
  { key: 't600', label: '600 kg', totalKg: 600, stackKg: null, stacks: null, hint: 'paleta — bez podziału' },
  { key: 't800', label: '800 kg', totalKg: 800, stackKg: 200, stacks: 4, hint: 'paleta — 4 słupki po 200 kg' },
]

export function withinTolerance(kg: number, target: number): boolean {
  return Math.abs(kg - target) <= TOLERANCE_KG + 1e-9
}

/** Netto słupka. Nośnik odejmujemy TYLKO przy pierwszym — potem paleta stoi
 *  na wadze wytarowana, a operator dokłada kolejny stos. */
export function stackNetKg(
  gross: number, carrierKg: number, containers: number, isFirstStack: boolean,
): number {
  const tare = (isFirstStack ? carrierKg : 0) + containers * 2
  return Math.max(0, Math.round((gross - tare) * 10) / 10)
}
```

Stała 2 kg: zaimportuj `E2_TARE_KG` z `@/features/deboning/utils/weighing` zamiast powtarzać liczbę.

- [ ] **Step 4: Uruchom — zielone**

Run: `npx vitest run src/features/deboning/meatPallet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/deboning/meatPallet.ts src/features/deboning/meatPallet.test.ts
git commit -m "feat(kiosk): kafelki celu i arytmetyka słupka dla ważenia zbiorczego"
```

---

### Task 2: Podział FEFO na partie

**Files:**
- Modify: `src/features/deboning/meatPallet.ts`
- Modify: `src/features/deboning/meatPallet.test.ts`

**Interfaces:**
- Produces:
  - `interface LotPick { lotNo: string; kg: number }`
  - `interface FefoResult { picks: LotPick[]; unassignedKg: number }`
  - `proposeLots(available: { lotNo: string; kgFree: number }[], kg: number): FefoResult`

- [ ] **Step 1: Test (czerwony)**

```ts
import { proposeLots } from './meatPallet'

describe('proposeLots — skład palety wg FEFO', () => {
  // Wejście jest JUŻ posortowane od najstarszej partii (API sortuje po
  // expiry_date), więc bierzemy po kolei.
  const pula = [
    { lotNo: '475', kgFree: 420 },
    { lotNo: '476', kgFree: 900 },
  ]

  it('jedna partia pokrywa cel — jeden wiersz', () => {
    expect(proposeLots(pula, 300)).toEqual({
      picks: [{ lotNo: '475', kg: 300 }], unassignedKg: 0,
    })
  })

  it('najstarsza do dna, reszta z kolejnej', () => {
    expect(proposeLots(pula, 600)).toEqual({
      picks: [{ lotNo: '475', kg: 420 }, { lotNo: '476', kg: 180 }], unassignedKg: 0,
    })
  })

  it('resztka poniżej 0,1 kg nie tworzy wiersza-śmiecia', () => {
    const r = proposeLots([{ lotNo: '475', kgFree: 100.04 }, { lotNo: '476', kgFree: 500 }], 100)
    expect(r.picks).toEqual([{ lotNo: '475', kg: 100 }])
  })

  it('za mało mięsa w puli — reszta zostaje DO PRZYPISANIA, nie dopisuje się po cichu', () => {
    const r = proposeLots([{ lotNo: '475', kgFree: 200 }], 600)
    expect(r.picks).toEqual([{ lotNo: '475', kg: 200 }])
    expect(r.unassignedKg).toBe(400)
  })

  it('pusta pula — całość do przypisania', () => {
    expect(proposeLots([], 100)).toEqual({ picks: [], unassignedKg: 100 })
  })

  it('kilogramy zaokrągla do 0,1 — suma musi trafić w wagę palety', () => {
    const r = proposeLots([{ lotNo: '475', kgFree: 33.333 }, { lotNo: '476', kgFree: 500 }], 100)
    expect(r.picks[0].kg).toBe(33.3)
    expect(r.picks[1].kg).toBe(66.7)
    expect(r.picks.reduce((s, p) => s + p.kg, 0)).toBeCloseTo(100, 5)
  })
})
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `npx vitest run src/features/deboning/meatPallet.test.ts`
Expected: FAIL — `proposeLots is not a function`

- [ ] **Step 3: Implementacja**

```ts
export interface LotPick { lotNo: string; kg: number }
export interface FefoResult { picks: LotPick[]; unassignedKg: number }

/**
 * Podział wagi palety na partie: bierz z najstarszej tyle, ile w niej zostało,
 * resztę z kolejnej. Lista wejściowa jest już w kolejności FEFO (API sortuje
 * po terminie), więc idziemy po niej wprost.
 *
 * Braku pokrycia NIE dopisujemy po cichu do ostatniego lotu — wraca jako
 * `unassignedKg` i ekran prosi o wskazanie partii. Zgadywanie w tym miejscu
 * kosztowałoby dokładnie tę identyfikowalność, po którą powstaje etykieta.
 */
export function proposeLots(
  available: { lotNo: string; kgFree: number }[], kg: number,
): FefoResult {
  const r1 = (n: number) => Math.round(n * 10) / 10
  let zostalo = r1(kg)
  const picks: LotPick[] = []
  for (const lot of available) {
    if (zostalo <= 0.05) break
    const wziete = r1(Math.min(zostalo, lot.kgFree))
    if (wziete <= 0.05) continue
    picks.push({ lotNo: lot.lotNo, kg: wziete })
    zostalo = r1(zostalo - wziete)
  }
  return { picks, unassignedKg: Math.max(0, zostalo) }
}
```

- [ ] **Step 4: Uruchom — zielone**

Run: `npx vitest run src/features/deboning/meatPallet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/deboning/meatPallet.ts src/features/deboning/meatPallet.test.ts
git commit -m "feat(kiosk): podział palety na partie wg FEFO z resztą do przypisania"
```

---

### Task 3: Etykieta palety mięsa (ZPL 50×80)

**Files:**
- Create: `src/features/deboning/meatPalletLabelZpl.ts`
- Create: `src/features/deboning/meatPalletLabelZpl.test.ts`

**Interfaces:**
- Consumes: `LABEL_DPI`, `LABEL_W_MM`, `LABEL_H_MM`, `mmToDots`, `fmtLabelDate`, `fmtLabelKg` z `./byproductLabelZpl`.
- Produces: `meatPalletLabelZpl(input: MeatPalletLabelInput, opts?: { dpi?: number }): string` gdzie `MeatPalletLabelInput = { palletNo: string; netKg: number; containers: number; productionDate: string; expiryDate: string; lots: LotPick[] }`.

- [ ] **Step 1: Test (czerwony)**

```ts
import { describe, it, expect } from 'vitest'
import { meatPalletLabelZpl, MAX_LOTS_ON_LABEL } from './meatPalletLabelZpl'
import { mmToDots, LABEL_W_MM, LABEL_H_MM } from './byproductLabelZpl'

const BASE = {
  palletNo: 'PAL/14/08/26/3',
  netKg: 600,
  containers: 30,
  productionDate: '2026-08-14',
  expiryDate: '2026-08-19',
  lots: [{ lotNo: '475', kg: 420 }, { lotNo: '476', kg: 180 }],
}

describe('meatPalletLabelZpl — etykieta palety mięsa', () => {
  it('rozmiar taśmy taki sam jak przy ubocznych', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain(`^PW${mmToDots(LABEL_W_MM)}`)
    expect(zpl).toContain(`^LL${mmToDots(LABEL_H_MM)}`)
    expect(zpl).toContain('^CI28')
  })

  it('niesie numer palety, wagę i pojemniki', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('PAL/14/08/26/3')
    expect(zpl).toContain('600 kg')
    expect(zpl).toContain('30 pojem')
  })

  it('QR koduje numer palety — masownia go zeskanuje', () => {
    expect(meatPalletLabelZpl(BASE)).toContain('^BQ')
    expect(meatPalletLabelZpl(BASE)).toContain('PAL/14/08/26/3')
  })

  it('drukuje skład partii z kilogramami', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('475')
    expect(zpl).toContain('420 kg')
    expect(zpl).toContain('476')
    expect(zpl).toContain('180 kg')
  })

  it('przy piątej partii ostatni wiersz to „+ N kolejnych"', () => {
    const duzo = { ...BASE, lots: [
      { lotNo: '471', kg: 100 }, { lotNo: '472', kg: 100 }, { lotNo: '473', kg: 100 },
      { lotNo: '474', kg: 100 }, { lotNo: '475', kg: 100 }, { lotNo: '476', kg: 100 },
    ] }
    const zpl = meatPalletLabelZpl(duzo)
    expect(zpl).toContain('471')
    expect(zpl).toContain(`+ ${6 - MAX_LOTS_ON_LABEL} kolejnych`)
    expect(zpl).not.toContain('476')
  })

  it('daty w formacie dd.mm.rrrr', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('14.08.2026')
    expect(zpl).toContain('19.08.2026')
  })

  it('żaden wiersz nie wychodzi poza szerokość taśmy', () => {
    const maxX = mmToDots(LABEL_W_MM)
    const zpl = meatPalletLabelZpl({ ...BASE, netKg: 1234.5, containers: 120 })
    for (const [, x, , h, tekst] of zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)) {
      expect(Number(x) + tekst.length * Number(h) * 0.6).toBeLessThanOrEqual(maxX)
    }
  })
})
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `npx vitest run src/features/deboning/meatPalletLabelZpl.test.ts`
Expected: FAIL — brak modułu

- [ ] **Step 3: Implementacja**

Układ pionowy na 50×80 mm, marginesy 3 mm, `^CI28`, `^LH0,0`, `^MNY` (jak etykieta ubocznych — te same pułapki taśmy). Kolejność: nagłówek „MIĘSO" (6 mm), numer palety (4,5 mm), QR `^BQN,2,4` po prawej u góry, linia, waga + pojemniki (7 mm / 3,2 mm opis), linia, „Partie:" i do `MAX_LOTS_ON_LABEL = 4` wierszy `{lotNo} — {kg} kg` (4 mm), ewentualne „+ N kolejnych", linia, daty (3,2 mm opis + 4,5 mm wartość). Wyliczaj `^FO` z `mmToDots`, teksty escapuj tak samo jak w `byproductLabelZpl` (wytnij `^` i `~`).

- [ ] **Step 4: Uruchom + obejrzyj wynik**

Run: `npx vitest run src/features/deboning/meatPalletLabelZpl.test.ts`
Expected: PASS. Dodatkowo wyrenderuj przykład przez `npx vite-node` i sprawdź wzrokiem, czy pionowo mieści się w 639 punktach.

- [ ] **Step 5: Commit**

```bash
git add src/features/deboning/meatPalletLabelZpl.ts src/features/deboning/meatPalletLabelZpl.test.ts
git commit -m "feat(kiosk): etykieta palety mięsa 50x80 ze składem partii i QR"
```

---

### Task 4: Backend — tabele, zapis i odczyt palety

**Files:**
- Create: `backend/app/services/meat_pallets_service.py`
- Create: `backend/app/routes/meat_pallets.py`
- Create: `backend/app/models/meat_pallets.py`
- Modify: `backend/app/migrations.py` (dwa `CREATE TABLE IF NOT EXISTS` w `_DDL`)
- Modify: `backend/app/main.py` (rejestracja routera)
- Test: `backend/tests/test_meat_pallets_db.py`

**Interfaces:**
- Produces:
  - `MeatPalletCreate` (pydantic): `target_kg`, `stack_kg`, `kg_net`, `containers`, `carrier_label`, `carrier_kg`, `operator`, `production_date`, `expiry_date`, `lots: List[{lotNo, kg}]`
  - `meat_pallets_service.create_pallet(dto) -> Dict` — nadaje `pallet_no`, zapisuje skład, zwraca paletę z listą partii
  - `meat_pallets_service.get_pallet(pallet_no) -> Dict`
  - `POST /api/meat-pallets`, `GET /api/meat-pallets/{pallet_no}`

- [ ] **Step 1: Test (czerwony)**

```python
"""Ważenie zbiorcze mięsa: paleta to OPIS, nie ruch magazynowy.

Mięso jest na stanie od rozbioru — ten ekran tylko zapisuje, co na czym
leży, żeby masownia wiedziała, co zabiera.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import query_all, query_one
from app.models.meat_pallets import MeatPalletCreate
from app.services.meat_pallets_service import create_pallet, get_pallet


def _dto(**over):
    baza = {
        "targetKg": 600, "stackKg": None, "kgNet": 600, "containers": 30,
        "carrierLabel": "H1", "carrierKg": 18, "operator": "ANATOLII",
        "productionDate": "2026-08-14", "expiryDate": "2026-08-19",
        "lots": [{"lotNo": "475", "kg": 420}, {"lotNo": "476", "kg": 180}],
    }
    baza.update(over)
    return MeatPalletCreate.model_validate(baza)


def test_zapis_palety_ze_skladem(db):
    out = create_pallet(_dto())

    assert out["pallet_no"].startswith("PAL/14/08/26/")
    lots = query_all("SELECT lot_no, kg FROM meat_pallet_lots WHERE pallet_id=%s ORDER BY seq",
                     (out["id"],))
    assert [(l["lot_no"], float(l["kg"])) for l in lots] == [("475", 420.0), ("476", 180.0)]


def test_numer_palety_rosnie_w_obrebie_dnia(db):
    a = create_pallet(_dto())
    b = create_pallet(_dto())
    assert a["pallet_no"].endswith("/1")
    assert b["pallet_no"].endswith("/2")


def test_suma_skladu_musi_sie_zgadzac_z_waga(db):
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(lots=[{"lotNo": "475", "kg": 100}]))
    assert err.value.status_code == 400
    assert query_one("SELECT COUNT(*) AS n FROM meat_pallets")["n"] == 0


def test_paleta_NIE_rusza_stanu_magazynowego(db):
    """Regresja: to ma być wyłącznie opis. Każdy ruch tutaj byłby podwójnym
    księgowaniem mięsa, które już jest na stanie po rozbiorze."""
    create_pallet(_dto())
    assert query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"] == 0


def test_odczyt_po_numerze_do_dodruku(db):
    out = create_pallet(_dto())
    rec = get_pallet(out["pallet_no"])
    assert float(rec["kg_net"]) == 600.0
    assert [l["lot_no"] for l in rec["lots"]] == ["475", "476"]


def test_nieznana_paleta_daje_404(db):
    with pytest.raises(HTTPException) as err:
        get_pallet("PAL/01/01/26/9")
    assert err.value.status_code == 404
```

- [ ] **Step 2: Uruchom — ma paść na imporcie**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_meat_pallets_db.py -q`
Expected: FAIL — `ModuleNotFoundError: app.models.meat_pallets`

- [ ] **Step 3: Migracje**

Dopisz do `_DDL` w `backend/app/migrations.py` dwa `CREATE TABLE IF NOT EXISTS` dokładnie wg speca (`meat_pallets`, `meat_pallet_lots` z `ON DELETE CASCADE`) oraz indeks `CREATE INDEX IF NOT EXISTS meat_pallet_lots_pallet_idx ON meat_pallet_lots (pallet_id)`. Dopisz `meat_pallets` i `meat_pallet_lots` do listy `_TRUNCATE` w `backend/tests/conftest.py` — inaczej numery palet przeciekną między testami.

- [ ] **Step 4: Model + serwis + trasa**

Numer palety: `PAL/{DD}/{MM}/{RR}/{n}` gdzie `n` to kolejna paleta tego dnia produkcyjnego (`SELECT COUNT(*) ... WHERE production_date=%s` w tej samej transakcji, wzór jak numery sesji rozbioru). Walidacja: `abs(sum(lots.kg) - kg_net) > 0.05` → `HTTPException(400, "Suma składu (X kg) nie zgadza się z wagą palety (Y kg)")`. Router rejestruj w `main.py` obok pozostałych.

- [ ] **Step 5: Uruchom testy backendu**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_meat_pallets_db.py -q`
Expected: PASS (6 testów)

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/meat_pallets.py backend/app/services/meat_pallets_service.py backend/app/routes/meat_pallets.py backend/app/migrations.py backend/app/main.py backend/tests/test_meat_pallets_db.py backend/tests/conftest.py
git commit -m "feat(mieso): zapis palety zbiorczej ze składem partii, bez ruchów magazynowych"
```

---

### Task 5: Klient API

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `meatPalletsApi.create(dto)`, `meatPalletsApi.byNo(palletNo)` z mapowaniem snake→camel jak reszta pliku.

- [ ] **Step 1: Dopisz klienta**

```ts
export interface MeatPalletLot { lotNo: string; kg: number }
export interface MeatPallet {
  id: string; palletNo: string; targetKg: number; kgNet: number
  containers: number; carrierLabel: string
  productionDate: string; expiryDate: string; lots: MeatPalletLot[]
}
export const meatPalletsApi = {
  create: (dto: Omit<MeatPallet, 'id' | 'palletNo'> & { stackKg: number | null; carrierKg: number; operator: string }) =>
    post<any>('/meat-pallets', dto).then(mapMeatPallet),
  byNo: (no: string) => get<any>(`/meat-pallets/${encodeURIComponent(no)}`).then(mapMeatPallet),
}
```

`mapMeatPallet` przepisuje `pallet_no → palletNo`, `kg_net → kgNet`, `lots[].lot_no → lotNo` — wzoruj się na `mapMeatStock`.

- [ ] **Step 2: Weryfikacja**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: bez błędów

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(kiosk): klient API palet zbiorczych mięsa"
```

---

### Task 6: Ekran „Ważenie zbiorcze" w kiosku

**Files:**
- Create: `src/features/deboning/BulkWeighingWizard.tsx`
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx` (przycisk w pasku górnym + montaż kreatora)

**Interfaces:**
- Consumes: `PALLET_TARGETS`, `withinTolerance`, `stackNetKg`, `proposeLots`, `meatPalletLabelZpl`, `meatPalletsApi`, `meatStockApi.list()`, `useScale`, `byproductTareOptions(cartTares)`, `getDevices`/`sendZpl`, `getProductionDate`.
- Produces: `<BulkWeighingWizard cartTares={number[]} operator={string} onClose={() => void} />`

- [ ] **Step 1: Kreator — ekran po ekranie**

Cztery fazy w jednym komponencie (wzorzec `ByproductsWizard`):
1. `target` — pięć kafelków z `PALLET_TARGETS` (label + hint).
2. `carrier` — `byproductTareOptions(cartTares)`, czyli paleta H1 18 kg i wózki z ustawień.
3. `stack` — waga na żywo, „słupek 2 z 4" albo sama suma przy 600 kg, licznik „do celu brakuje X kg", pole liczby pojemników (klawiatura jak w `ByproductsWizard`), przycisk „Dodaj słupek" zielony w tolerancji. Po ostatnim słupku (albo gdy suma trafi w cel łączny) przejście do `summary`.
4. `summary` — propozycja `proposeLots` na danych z `meatStockApi.list()`, edycja kilogramów przy partii, czerwony pasek „do przypisania: X kg" blokujący zapis, przycisk „Zapisz i drukuj".

Zapis: `meatPalletsApi.create(...)` → po sukcesie `sendZpl(dev, meatPalletLabelZpl({ palletNo: zapisana.palletNo, ... }))`. Etykieta dopiero PO zapisie, bo numer palety nadaje backend.

- [ ] **Step 2: Przycisk w kiosku**

W pasku górnym `DeboningHmiV10Page.tsx` (obok „Zakończ partię", linia ~2072) dołóż:

```tsx
<button type="button" onClick={() => setBulkOpen(true)}
  className="h-9 px-4 text-[13px] font-bold flex items-center gap-2 flex-shrink-0"
  style={{ border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 8, background: 'var(--panel)' }}>
  <Layers size={15} /> Ważenie zbiorcze
</button>
```

oraz montaż `{bulkOpen && <BulkWeighingWizard cartTares={cartTares} operator={loggedInUser?.name ?? ''} onClose={() => setBulkOpen(false)} />}` obok pozostałych modali. `cartTares` weź z tego samego źródła, z którego bierze je `ByproductsWizard`.

- [ ] **Step 3: Weryfikacja**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build`
Expected: wszystko zielone

- [ ] **Step 4: Commit**

```bash
git add src/features/deboning/BulkWeighingWizard.tsx src/pages/tablet/DeboningHmiV10Page.tsx
git commit -m "feat(kiosk): ekran ważenia zbiorczego mięsa — słupki, skład partii i etykieta"
```

---

### Task 7: Weryfikacja i wydanie

- [ ] **Step 1: Pełna bateria**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run && npm run build
cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest -q
```
Expected: wszystko zielone

- [ ] **Step 2: Sprawdź spec**

Przejdź spec sekcja po sekcji i potwierdź pokrycie w kodzie.

- [ ] **Step 3: Wydanie kiosku**

Bump `src-tauri/tauri.rozbior-v10.conf.json` (+ v11), commit, tag `rozbior-v10-<wersja>`, push. CI zbuduje instalator.

- [ ] **Step 4: Deploy backendu — decyzja użytkownika**

Backend ma nowe tabele i trasę, więc kiosk bez deployu dostanie 404 przy zapisie. NIE wdrażaj samodzielnie: przypomnij o obowiązkowym diffie prod↔repo, `deploy/deploy.sh` (kopiuje `app/` i **restartuje**) i weryfikacji DANYCH po deployu (migracje potrafią paść cicho).
