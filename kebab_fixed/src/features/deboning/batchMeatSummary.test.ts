/**
 * Podsumowanie mięsa partii — to, czego brakowało po zakończeniu rozbioru.
 *
 * Gdy partia jest zamknięta, kafel prowadził wyłącznie do ubocznych: nie dało
 * się sprawdzić, ile mięsa z niej zważono, które palety z niej poszły ani ile
 * zostało do rozważenia. Z partii 503 została 24.08.2026 końcówka 422 kg
 * i nie było jej jak dokończyć.
 */
import { describe, it, expect } from 'vitest'
import { buildBatchMeatSummary } from './batchMeatSummary'

const PALETY = [
  { palletNo: 'PAL/24/08/26/13', kgNet: 200, containers: 9, lots: [{ lotNo: '503', kg: 200 }] },
  { palletNo: 'PAL/24/08/26/14', kgNet: 200, containers: 9, lots: [{ lotNo: '503', kg: 200 }] },
  // Paleta łączona: z 503 poszło tylko 60 kg, reszta z 504.
  { palletNo: 'PAL/24/08/26/19', kgNet: 200, containers: 9,
    lots: [{ lotNo: '503', kg: 60 }, { lotNo: '504', kg: 140 }] },
  { palletNo: 'PAL/24/08/26/12', kgNet: 200, containers: 9, lots: [{ lotNo: '504', kg: 200 }] },
]

// 882 zważone − 460 na paletach = 422 kg końcówki (jak realnie na 24.08).
const LOT = { lotNo: '503', kgInitial: 882, kgBulkFree: 422 }

describe('buildBatchMeatSummary', () => {
  it('podaje zważone, na paletach i pozostało', () => {
    const s = buildBatchMeatSummary(LOT, PALETY)
    expect(s.weighedKg).toBe(882)
    expect(s.onPalletsKg).toBe(460)
    expect(s.leftKg).toBe(422)
  })

  it('wypisuje TYLKO palety z tej partii', () => {
    const s = buildBatchMeatSummary(LOT, PALETY)
    expect(s.pallets.map(p => p.palletNo)).toEqual([
      'PAL/24/08/26/13', 'PAL/24/08/26/14', 'PAL/24/08/26/19',
    ])
  })

  it('przy palecie łączonej liczy kilogramy Z TEJ partii, nie całą paletę', () => {
    const s = buildBatchMeatSummary(LOT, PALETY)
    const laczona = s.pallets.find(p => p.palletNo.endsWith('/19'))!
    expect(laczona.kgFromBatch).toBe(60)
    expect(laczona.kgNet).toBe(200)
  })

  it('oznacza paletę złożoną z kilku partii', () => {
    const s = buildBatchMeatSummary(LOT, PALETY)
    expect(s.pallets.find(p => p.palletNo.endsWith('/19'))!.mixed).toBe(true)
    expect(s.pallets.find(p => p.palletNo.endsWith('/13'))!.mixed).toBe(false)
  })

  it('partia bez palet ma zero i pustą listę', () => {
    const s = buildBatchMeatSummary({ lotNo: '999', kgInitial: 100, kgBulkFree: 100 }, PALETY)
    expect(s.onPalletsKg).toBe(0)
    expect(s.pallets).toEqual([])
  })

  it('bez lotu mięsa nie udaje wiedzy', () => {
    const s = buildBatchMeatSummary(null, PALETY)
    expect(s.weighedKg).toBe(0)
    expect(s.leftKg).toBe(0)
    expect(s.pallets).toEqual([])
  })

  it('gdy backend nie poda limitu, pozostało liczymy z palet', () => {
    const s = buildBatchMeatSummary({ lotNo: '503', kgInitial: 882 }, PALETY)
    expect(s.leftKg).toBe(422)
  })
})
