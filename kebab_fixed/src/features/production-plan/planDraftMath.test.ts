/**
 * Czysta arytmetyka szkicu planu: zapotrzebowanie per receptura i wiersze
 * panelu partii. Wyjęte z `PlanForm`, żeby dało się to sprawdzić bez DOM-u —
 * to na tych dwóch rachunkach opiera się cała odpowiedź „czy starczy mięsa".
 */
import { describe, it, expect } from 'vitest'
import {
  demandByRecipe, usedLinesByBatch, buildBatchRows, addLineWithFefo, recalcAll, planLinesFromPlan,
  type SeasonedLite,
} from './planDraftMath'
import { emptyPlanLine, type PlanLine } from './planLineModel'
import type { PlanAllocation } from './planMeatAllocation'

const linia = (over: Partial<PlanLine> = {}): PlanLine => ({ ...emptyPlanLine(), ...over })

const RECEPTURY = [
  { id: 'r1', name: 'WROCŁAW' },
  { id: 'r2', name: 'BULLI' },
  // Kebab komponentowy 70/30 — partie dobiera backend per komponent.
  { id: 'r7', name: '70/30', components: [{ materialTypeId: 'm1', materialName: 'Udo', pct: 70 }] },
]

describe('demandByRecipe', () => {
  it('sumuje kilogramy pozycji per receptura', () => {
    const d = demandByRecipe(
      [linia({ recipeId: 'r1', qty: '20', kgPerUnit: '35' }),
       linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10' })],
      RECEPTURY,
    )
    expect(d.r1).toEqual({ name: 'WROCŁAW', kg: 800 })
  })

  it('liczy pozycje BEZ przypisanych partii — saldo schodzi już przy wpisaniu', () => {
    const d = demandByRecipe([linia({ recipeId: 'r2', qty: '5', kgPerUnit: '20' })], RECEPTURY)
    expect(d.r2.kg).toBe(100)
  })

  /**
   * PROD/25/08/26 (25.08.2026): plan z dwiema pozycjami KIRMIZI — pierwsza
   * WYPRODUKOWANA (20 szt. × 35 kg = 700 kg), druga do zrobienia (2700 kg).
   * Partia 498 ma 3523,8 kg i trzyma 3400 kg rezerwacji tego planu.
   *
   * Przy wejściu w edycję panel krzyczał „brakuje KIRMIZI", choć nikt niczego
   * nie ruszał. Powód: mięso pozycji ZAMROŻONEJ słusznie NIE wraca do puli
   * (backend nie zwalnia jej rezerwacji), ale zapotrzebowanie liczyło ją dalej
   * — 3400 kg potrzeby przy 2823,8 kg puli daje fantomowy brak 576,2 kg.
   */
  it('pozycji WYPRODUKOWANEJ nie liczy — jej mięso jest już zarezerwowane', () => {
    const d = demandByRecipe(
      [linia({ recipeId: 'r1', qty: '20', kgPerUnit: '35', qtyDone: 20 }),
       linia({ recipeId: 'r1', qty: '90', kgPerUnit: '30' })],
      RECEPTURY,
    )
    expect(d.r1.kg).toBe(2700)
  })

  it('pozycja ZACZĘTA też nie liczy się do potrzeby — jej rezerwacja stoi w całości', () => {
    // Backend zwalnia rezerwacje tylko pozycji NIETKNIĘTYCH (skip_line_ids),
    // więc rozpoczęta trzyma swoje kilogramy do końca. Liczenie jej potrzeby
    // dawałoby ten sam fantomowy brak co przy pozycji wyprodukowanej.
    const d = demandByRecipe([linia({ recipeId: 'r1', qty: '20', kgPerUnit: '35', qtyDone: 5 })], RECEPTURY)
    expect(d.r1).toBeUndefined()
  })

  it('receptury komponentowej NIE liczy — jej partie dobiera backend', () => {
    const d = demandByRecipe([linia({ recipeId: 'r7', qty: '10', kgPerUnit: '10' })], RECEPTURY)
    expect(d.r7).toBeUndefined()
  })

  it('pozycja bez receptury albo bez kilogramów nie wchodzi', () => {
    const d = demandByRecipe(
      [linia({ recipeId: '', qty: '5', kgPerUnit: '20' }),
       linia({ recipeId: 'r1', qty: '0', kgPerUnit: '20' })],
      RECEPTURY,
    )
    expect(Object.keys(d)).toEqual([])
  })

  it('usunięcie pozycji oddaje kilogramy', () => {
    const przed = demandByRecipe([linia({ recipeId: 'r1', qty: '20', kgPerUnit: '35' })], RECEPTURY)
    const po = demandByRecipe([], RECEPTURY)
    expect(przed.r1.kg).toBe(700)
    expect(po.r1).toBeUndefined()
  })
})

const ALLOC: PlanAllocation = {
  lines: [
    { qty: 20, neededKg: 700, pieces: 20, allocatedKg: 700, missingPieces: 0, missingKg: 0,
      hasBatches: true, ok: true, perBatch: [{ batchId: 'b1', batchNo: '495', pieces: 20, kg: 700 }], joined: [] },
    { qty: 10, neededKg: 100, pieces: 10, allocatedKg: 100, missingPieces: 0, missingKg: 0,
      hasBatches: true, ok: true, perBatch: [{ batchId: 'b2', batchNo: '496', pieces: 10, kg: 100 }], joined: [] },
    { qty: 5, neededKg: 50, pieces: 5, allocatedKg: 50, missingPieces: 0, missingKg: 0,
      hasBatches: true, ok: true, perBatch: [{ batchId: 'b1', batchNo: '495', pieces: 5, kg: 50 }], joined: [] },
  ],
  freeByBatch: { b1: 100, b2: 800 },
  usedByBatch: { b1: 750, b2: 100 },
}

describe('usedLinesByBatch', () => {
  it('mówi, które pozycje biorą z danej partii — numery od 1', () => {
    expect(usedLinesByBatch(ALLOC)).toEqual({ b1: [1, 3], b2: [2] })
  })

  it('sztuki z resztek też liczą się jako użycie partii', () => {
    const zJoined: PlanAllocation = {
      ...ALLOC,
      lines: [{ ...ALLOC.lines[0], perBatch: [],
        joined: [{ label: '495/496', pieces: 1, parts: [{ batchId: 'b9', batchNo: '499', kg: 20 }] }] }],
    }
    expect(usedLinesByBatch(zJoined)).toEqual({ b9: [1] })
  })

  it('partia nietknięta nie ma wpisu', () => {
    expect(usedLinesByBatch(ALLOC).b3).toBeUndefined()
  })
})

const PARTIE: SeasonedLite[] = [
  { id: 'b1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '495', productionDay: '2026-08-22', kgFree: 850 },
  { id: 'b2', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '496', productionDay: '2026-08-22', kgFree: 900 },
  { id: 'b3', recipeId: 'r2', recipeName: 'BULLI',   batchNo: '496', productionDay: '2026-08-22', kgFree: 1220 },
]

describe('buildBatchRows', () => {
  it('pokazuje wolne kg PO przydziale bieżącego szkicu, nie surowe', () => {
    const rows = buildBatchRows(PARTIE, ALLOC)
    expect(rows.find(r => r.id === 'b1')!.kgFreeLive).toBe(100)
  })

  it('partia bez wpisu w alokacji zachowuje swoje wolne kg', () => {
    const rows = buildBatchRows(PARTIE, ALLOC)
    expect(rows.find(r => r.id === 'b3')!.kgFreeLive).toBe(1220)
  })

  it('niesie numery pozycji, które z partii biorą', () => {
    const rows = buildBatchRows(PARTIE, ALLOC)
    expect(rows.find(r => r.id === 'b1')!.usedByLines).toEqual([1, 3])
    expect(rows.find(r => r.id === 'b3')!.usedByLines).toEqual([])
  })

  it('zachowuje kolejność wejściową — API oddaje ją po terminie (FEFO)', () => {
    expect(buildBatchRows(PARTIE, ALLOC).map(r => r.id)).toEqual(['b1', 'b2', 'b3'])
  })
})

/**
 * Dokładanie pozycji i przeliczanie planu od nowa.
 *
 * Dwie pułapki, obie kosztowne po cichu:
 *  1. nowa pozycja NIE może widzieć mięsa, które zabrały już poprzednie —
 *     inaczej dwie pozycje zgłaszają te same kilogramy i backend odrzuca plan;
 *  2. przeliczenie od nowa nie może ruszyć pozycji rozpoczętych na hali —
 *     ich mięso już poszło w produkcję.
 */
describe('addLineWithFefo', () => {
  const partie: SeasonedLite[] = [
    { id: 'b1', recipeId: 'r1', batchNo: '1', expiryDate: '2026-09-01', kgFree: 300 },
    { id: 'b2', recipeId: 'r1', batchNo: '2', expiryDate: '2026-09-05', kgFree: 900 },
  ]

  it('pierwsza pozycja bierze najstarszą partię', () => {
    const out = addLineWithFefo([], linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10' }), partie)
    expect(out[0].seasonedBatchIds).toEqual(['b1'])
  })

  it('druga pozycja NIE bierze kilogramów zabranych przez pierwszą', () => {
    const po1 = addLineWithFefo([], linia({ recipeId: 'r1', qty: '30', kgPerUnit: '10' }), partie)
    const po2 = addLineWithFefo(po1, linia({ recipeId: 'r1', qty: '30', kgPerUnit: '10' }), partie)
    expect(po2[0].seasonedBatchIds).toEqual(['b1'])
    expect(po2[1].seasonedBatchIds).toEqual(['b2'])
  })

  it('nie rusza pozycji już stojących na liście', () => {
    const reczna = linia({ recipeId: 'r1', qty: '5', kgPerUnit: '10',
      seasonedBatchIds: ['b2'], seasonedBatchId: 'b2', batchesManual: true })
    const out = addLineWithFefo([reczna], linia({ recipeId: 'r1', qty: '5', kgPerUnit: '10' }), partie)
    expect(out[0].seasonedBatchIds).toEqual(['b2'])
  })
})

describe('recalcAll', () => {
  const partie: SeasonedLite[] = [
    { id: 'b1', recipeId: 'r1', batchNo: '1', expiryDate: '2026-09-01', kgFree: 300 },
    { id: 'b2', recipeId: 'r1', batchNo: '2', expiryDate: '2026-09-05', kgFree: 900 },
  ]

  it('zdejmuje ręczne decyzje i rozdaje od zera po FEFO', () => {
    const out = recalcAll(
      [linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10',
        seasonedBatchIds: ['b2'], seasonedBatchId: 'b2', batchesManual: true })],
      partie,
    )
    expect(out[0].seasonedBatchIds).toEqual(['b1'])
    expect(out[0].batchesManual).toBe(false)
  })

  it('pozycji rozpoczętej na hali NIE rusza', () => {
    const out = recalcAll(
      [linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10',
        seasonedBatchIds: ['b2'], seasonedBatchId: 'b2', qtyDone: 3 })],
      partie,
    )
    expect(out[0].seasonedBatchIds).toEqual(['b2'])
  })

  it('mięso trzymane przez pozycję rozpoczętą nie wraca do puli', () => {
    // Zamrożona bierze CAŁE 300 kg z b1; przeliczana musi pójść na b2.
    const out = recalcAll(
      [linia({ recipeId: 'r1', qty: '30', kgPerUnit: '10',
        seasonedBatchIds: ['b1'], seasonedBatchId: 'b1', qtyDone: 5 }),
       linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10',
        seasonedBatchIds: ['b1'], seasonedBatchId: 'b1', batchesManual: true })],
      partie,
    )
    expect(out[0].seasonedBatchIds).toEqual(['b1'])
    expect(out[1].seasonedBatchIds).toEqual(['b2'])
  })
})

/**
 * Wczytanie istniejącego planu do edycji.
 *
 * Baza NIE ma kolumny `seasoned_batch_ids` — partie pozycji trzeba odczytać
 * z zapisanej alokacji. Zgłoszenie z 13.08.2026: pozycja wielopartyjna gubiła
 * po kliknięciu ołówka wszystkie partie poza główną i świeciła „brakuje mięsa".
 */
describe('planLinesFromPlan', () => {
  it('odczytuje partie z alokacji, nie z jednego pola', () => {
    const [l] = planLinesFromPlan({ lines: [{
      id: 'l1', qty: 20, kgPerUnit: 35, productTypeId: 'pt1', recipeId: 'r1',
      seasonedBatchId: 'b1',
      // Alokacja jest kluczowana NUMEREM partii, id siedzi w środku wiadra.
      batchAllocation: { '495': { batch_id: 'b1', kg: 500 }, '496': { batch_id: 'b2', kg: 200 } },
      seasonedBatchNos: ['495', '496'],
    }] } as any)
    expect(l.seasonedBatchIds).toEqual(['b1', 'b2'])
  })

  it('kolejność partii bierze z seasonedBatchNos, nie z kluczy JSON', () => {
    // JS porządkuje klucze liczbowopodobne przed tekstowymi, więc sama
    // alokacja nie niesie kolejności zapisu.
    const [l] = planLinesFromPlan({ lines: [{
      id: 'l1', qty: 20, kgPerUnit: 35, recipeId: 'r1',
      batchAllocation: { '472': { batch_id: 'bA' }, 'PP13': { batch_id: 'bB' } },
      seasonedBatchNos: ['PP13', '472'],
    }] } as any)
    expect(l.seasonedBatchIds).toEqual(['bB', 'bA'])
  })

  it('gdy alokacji nie ma, zostaje partia główna', () => {
    const [l] = planLinesFromPlan({ lines: [{
      id: 'l1', qty: 5, kgPerUnit: 10, recipeId: 'r1', seasonedBatchId: 'b9',
    }] } as any)
    expect(l.seasonedBatchIds).toEqual(['b9'])
  })

  it('wczytane partie liczą się jako RĘCZNE — automat ich nie przemieli', () => {
    const [l] = planLinesFromPlan({ lines: [{
      id: 'l1', qty: 5, kgPerUnit: 10, recipeId: 'r1', seasonedBatchId: 'b9',
    }] } as any)
    expect(l.batchesManual).toBe(true)
  })

  it('niesie wykonane sztuki — po nich poznajemy pozycję zamrożoną', () => {
    const [l] = planLinesFromPlan({ lines: [{
      id: 'l1', qty: 5, kgPerUnit: 10, recipeId: 'r1', qtyDone: 3,
    }] } as any)
    expect(l.qtyDone).toBe(3)
  })

  it('zachowuje powiązanie z pozycją zamówienia', () => {
    const [l] = planLinesFromPlan({ lines: [{
      id: 'l1', qty: 5, kgPerUnit: 10, recipeId: 'r1',
      clientOrderId: 'z1', clientOrderLineId: 'zl1', clientOrderNo: 'ZAM/1', clientName: 'Bulli',
    }] } as any)
    expect(l.clientOrderLineId).toBe('zl1')
    expect(l.clientName).toBe('Bulli')
  })

  it('pusty plan daje pustą listę', () => {
    expect(planLinesFromPlan(undefined)).toEqual([])
  })
})
