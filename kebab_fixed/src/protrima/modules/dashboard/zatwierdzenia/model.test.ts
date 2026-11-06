import { describe, it, expect } from 'vitest'
import { doZatwierdzenia, porownaniePlanu, resztyDoRozliczenia, korektyReszty, type PlanZ } from './model'

/** Plan w kształcie z productionPlansApi.list (syntetyczny): dwie pozycje, partie mięsa w alokacji. */
const plan = (o: Partial<PlanZ> = {}): PlanZ => ({
  id: 'p1', planNo: 'PP/12/11/26', planDate: '2026-11-06', status: 'active',
  tabletFinishedAt: '2026-11-06T13:10:00Z', officeConfirmedAt: null,
  lines: [
    { id: 'l1', qty: 100, kgPerUnit: 40, productTypeName: 'KEBAB UDO', recipeId: 'r1', recipeName: 'KIRMIZI', packagingName: 'METAL 65', clientName: 'YALCIN', batchAllocation: { m1: { batch_id: 's1' } }, seasonedBatchNos: ['m1'] },
    { id: 'l2', qty: 50, kgPerUnit: 30, productTypeName: 'KEBAB UDO', recipeId: 'r2', recipeName: 'BEYAZ', packagingName: '', clientName: 'POLAT', batchAllocation: { m2: { batch_id: 's2' } }, seasonedBatchNos: ['m2'] },
  ],
  tabletPendingEntries: [
    { planLineId: 'l1', qty: 100, kgPerUnit: 40, workerNames: ['Jan'] },
    { planLineId: 'l2', qty: 30, kgPerUnit: 30, workerNames: [] },
  ],
  ...o,
})

describe('do zatwierdzenia przez biuro', () => {
  it('sesje zamknięte i plany zakończone na tablecie; zaległe (sprzed dziś) na górze', () => {
    const lista = doZatwierdzenia(
      [{ id: 's-dzis', processType: 'deboning', sessionDate: '2026-11-06', endedAt: '2026-11-06T14:02:00Z' },
       { id: 's-wczoraj', processType: 'mixing', sessionDate: '2026-11-05', endedAt: null }],
      [plan(), plan({ id: 'p2', planNo: 'PP/9', tabletFinishedAt: null }), plan({ id: 'p3', planNo: 'PP/8', officeConfirmedAt: 'x' })],
      '2026-11-06',
    )
    expect(lista.map(p => p.key)).toEqual(['sesja:s-wczoraj', 'sesja:s-dzis', 'plan:p1'])
    expect(lista[0]).toMatchObject({ zalegla: true, tytul: 'Masowanie' })
    expect(lista[1]).toMatchObject({ zalegla: false, tytul: 'Rozbiór' })
    expect(lista[2]).toMatchObject({ tytul: 'Produkcja PP/12/11/26', zalegla: false })
  })
})

describe('potwierdzenie planu — co trafi do magazynu', () => {
  it('wpisy tabletu przy pozycjach planu: komplet, część; suma sztuk i kg', () => {
    const p = porownaniePlanu(plan())
    expect(p.wiersze.map(w => [w.recipeName, w.zgloszono, w.planowano, w.stan])).toEqual([['KIRMIZI', 100, 100, 'ok'], ['BEYAZ', 30, 50, 'czesc']])
    expect(p.suma).toEqual({ szt: 130, kg: 4900 })
    expect(p.ostrzezenia).toEqual(['BEYAZ 30 kg (POLAT): 30 z 50 szt. — reszta NIE zostanie wyprodukowana w tym planie.'])
  })
  it('pozycja bez żadnego wpisu z tabletu — ostrzeżenie; brak wpisów w ogóle — nie ma czego potwierdzać', () => {
    const bezDrugiej = porownaniePlanu(plan({ tabletPendingEntries: [{ planLineId: 'l1', qty: 100, kgPerUnit: 40, workerNames: [] }] }))
    expect(bezDrugiej.wiersze[1]).toMatchObject({ zgloszono: 0, stan: 'brak' })
    expect(bezDrugiej.ostrzezenia[0]).toMatch(/BEYAZ 30 kg \(POLAT\): tablet nie zgłosił produkcji/)
    expect(porownaniePlanu(plan({ tabletPendingEntries: [] })).pusty).toBe(true)
  })
})

describe('reszta mięsa przyprawionego po produkcji', () => {
  const partie = [
    { id: 's1', batchNo: 'm1', recipeId: 'r1', recipeName: 'KIRMIZI', kgAvailable: 12.5, expiryDate: '2026-11-10' },
    { id: 's2', batchNo: 'm2', recipeId: 'r2', recipeName: 'BEYAZ', kgAvailable: 0.01, expiryDate: '2026-11-10' },
    { id: 's9', batchNo: 'm9', recipeId: 'r1', recipeName: 'KIRMIZI', kgAvailable: 40, expiryDate: '2026-11-10' },
  ]
  it('pyta per recepturę tylko o partie użyte w planie, z teorią (kg wg księgi) do poprawienia', () => {
    const r = resztyDoRozliczenia(plan(), partie)
    expect(r).toEqual([{ recipeId: 'r1', recipeName: 'KIRMIZI', teoria: 12.5, batches: [{ id: 's1', batchNo: 'm1', theoryKg: 12.5, expiryDate: '2026-11-10' }] }])
  })
  it('„nic nie zostało” zamyka partię; podana waga koryguje ją do pomiaru; bez zmiany — bez korekty', () => {
    const r = resztyDoRozliczenia(plan(), partie)
    expect(korektyReszty(r, { r1: 0 })).toEqual([{ id: 's1', targetKg: 0, close: true }])
    expect(korektyReszty(r, { r1: 10 })).toEqual([{ id: 's1', targetKg: 10, close: false }])
    expect(korektyReszty(r, { r1: 12.5 })).toEqual([])
  })
})
