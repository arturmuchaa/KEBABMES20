import { describe, expect, it } from 'vitest'
import {
  FINISHED_BATCHES_LIMIT,
  batchRequiresDeboning,
  filterDeboningBatches,
  lastFinishedBatches,
  sortMeatGroupsByExpiry,
  type MaterialTypeFlag,
} from './dashboardLists'

// Słownik rodzajów tak, jak zwraca /raw-batches/material-types.
const RODZAJE: MaterialTypeFlag[] = [
  { id: 'mat-cwiartka',      requiresDeboning: true },
  { id: 'mat-filet-kurczak', requiresDeboning: false },
  { id: 'mat-mieso-indyk',   requiresDeboning: false },
  { id: 'mat-mieso-zs',      requiresDeboning: false },
  { id: 'mat-mieso-bs',      requiresDeboning: false },
]

describe('batchRequiresDeboning', () => {
  it('ćwiartka idzie na rozbiór', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-cwiartka' }, RODZAJE)).toBe(true)
  })

  // Zgłoszenie 21.08.2026: partia 501 (mięso z/s, 3020 kg) i 497 (indyk, 311 kg)
  // wisiały na karcie rozbioru jako „→ 0 kg", bo ich mięso poszło prosto do magazynu.
  it('dostawa mięsa z/s i indyka nie idzie na rozbiór', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-mieso-zs' }, RODZAJE)).toBe(false)
    expect(batchRequiresDeboning({ materialTypeId: 'mat-mieso-indyk' }, RODZAJE)).toBe(false)
  })

  it('partia bez rodzaju to ćwiartka (dane sprzed kolumny material_type_id)', () => {
    expect(batchRequiresDeboning({}, RODZAJE)).toBe(true)
    expect(batchRequiresDeboning({ materialTypeId: '' }, RODZAJE)).toBe(true)
  })

  it('pusty słownik nie gasi karty — partie zostają widoczne', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-mieso-zs' }, [])).toBe(true)
  })

  it('rodzaj spoza słownika traktujemy jak rozbiorowy', () => {
    expect(batchRequiresDeboning({ materialTypeId: 'mat-wolowina' }, RODZAJE)).toBe(true)
  })
})

describe('filterDeboningBatches', () => {
  it('zdejmuje z listy dostawy bez rozbioru, resztę zostawia w kolejności', () => {
    const partie = [
      { internalBatchSeq: 499, materialTypeId: 'mat-cwiartka' },
      { internalBatchSeq: 497, materialTypeId: 'mat-mieso-indyk' },
      { internalBatchSeq: 500, materialTypeId: 'mat-cwiartka' },
      { internalBatchSeq: 501, materialTypeId: 'mat-mieso-zs' },
    ]
    expect(filterDeboningBatches(partie, RODZAJE).map(b => b.internalBatchSeq))
      .toEqual([499, 500])
  })
})

describe('lastFinishedBatches', () => {
  const historia = Array.from({ length: 40 }, (_, i) => ({ internalBatchSeq: 460 + i }))

  it('pokazuje pięć ostatnich, od najnowszej', () => {
    expect(lastFinishedBatches(historia).map(b => b.internalBatchSeq))
      .toEqual([499, 498, 497, 496, 495])
    expect(FINISHED_BATCHES_LIMIT).toBe(5)
  })

  it('krótsza historia przechodzi w całości', () => {
    expect(lastFinishedBatches([{ internalBatchSeq: 12 }, { internalBatchSeq: 9 }]))
      .toHaveLength(2)
  })

  it('nie mutuje wejścia', () => {
    const wejscie = [{ internalBatchSeq: 1 }, { internalBatchSeq: 7 }]
    lastFinishedBatches(wejscie)
    expect(wejscie.map(b => b.internalBatchSeq)).toEqual([1, 7])
  })
})

describe('sortMeatGroupsByExpiry', () => {
  it('najkrótszy termin na górze, nie największa masa', () => {
    const grupy = [
      { rawBatchNo: '500', kg: 2400, earliestExpiry: '2026-08-30' },
      { rawBatchNo: '498', kg: 310,  earliestExpiry: '2026-08-23' },
      { rawBatchNo: '499', kg: 1800, earliestExpiry: '2026-08-25' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo))
      .toEqual(['498', '499', '500'])
  })

  it('partia bez terminu ląduje na końcu', () => {
    const grupy = [
      { rawBatchNo: 'bez', kg: 9999, earliestExpiry: '' },
      { rawBatchNo: '498', kg: 100,  earliestExpiry: '2026-08-23' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo)).toEqual(['498', 'bez'])
  })

  it('ten sam termin — najpierw większa masa', () => {
    const grupy = [
      { rawBatchNo: 'mała',  kg: 100, earliestExpiry: '2026-08-23' },
      { rawBatchNo: 'duża', kg: 900, earliestExpiry: '2026-08-23' },
    ]
    expect(sortMeatGroupsByExpiry(grupy).map(g => g.rawBatchNo)).toEqual(['duża', 'mała'])
  })
})
