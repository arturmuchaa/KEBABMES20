import { describe, expect, it } from 'vitest'
import { executiveBrief, type BriefInput } from './executiveBrief'

const BASE: BriefInput = {
  avgYield: 65.8,
  meatCostPerKg: 12.85,
  kgQuarter: 118945,
  missingKg: -1165,
  batches: [
    { batchNo: '411', yieldPct: 64.1, kgQuarter: 7005, supplierName: 'KOKO' },
    { batchNo: '405', yieldPct: 66.9, kgQuarter: 7005, supplierName: 'KOKO' },
    { batchNo: '428', yieldPct: 64.9, kgQuarter: 4605, supplierName: 'KOKO' },
  ],
  workers: [
    { workerId: 'o', workerName: 'OLHA', kgQuarter: 9825, yieldVsBatchPp: 0.97,
      attendancePct: 100, yieldStdDev: 0.56, smallSample: false, deltaPln: 1225 },
    { workerId: 'a', workerName: 'ANATOLII', kgQuarter: 12495, yieldVsBatchPp: -0.54,
      attendancePct: 65, yieldStdDev: 0.77, smallSample: false, deltaPln: -867 },
  ],
  offDays: [{ date: '2026-07-13', avgYield: 64.1, kgMeat: 3868 }],
  monthsInSystem: 1,
}

const kinds = (b: ReturnType<typeof executiveBrief>) => b.map(x => x.kind)

describe('executiveBrief — cztery zdania na górze raportu', () => {
  it('zawsze cztery pozycje, w stałej kolejności', () => {
    expect(kinds(executiveBrief(BASE))).toEqual(['good', 'watch', 'risk', 'decision'])
  })

  it('te same dane dają ten sam tekst', () => {
    expect(executiveBrief(BASE)).toEqual(executiveBrief(BASE))
  })

  it('każda pozycja niesie liczbę — bez liczby to wypełniacz', () => {
    for (const item of executiveBrief(BASE)) {
      expect(item.text).toMatch(/\d/)
    }
  })

  // Sedno: prezes ma dostać kwotę, a nie przymiotnik.
  it('największe ryzyko wskazuje konkret z kwotą', () => {
    const risk = executiveBrief(BASE).find(x => x.kind === 'risk')!
    expect(risk.text).toMatch(/411/)
    expect(risk.text).toMatch(/zł/)
  })

  // Przy jednym miesiącu danych kwota „rocznie" jest zmyślona — a to
  // pierwsza liczba, którą prezes sprawdzi.
  it('nie ekstrapoluje w skali roku', () => {
    for (const item of executiveBrief(BASE)) {
      expect(item.text).not.toMatch(/roczn|rok\b|w skali roku/i)
    }
  })

  it('decyzja to największa dźwignia, przeliczona na złotówki', () => {
    const dec = executiveBrief(BASE).find(x => x.kind === 'decision')!
    expect(dec.text).toMatch(/zł/)
    expect(dec.text).toMatch(/OLHA|partie|dostawc/i)
  })

  it('nadwyżka masy trafia do „poszło dobrze", ubytek do „wymaga uwagi"', () => {
    expect(executiveBrief(BASE).find(x => x.kind === 'good')!.text).toMatch(/nadwyżk/i)
    const withLoss = executiveBrief({ ...BASE, missingKg: 3000 })
    expect(withLoss.find(x => x.kind === 'watch')!.text).toMatch(/ubyt/i)
  })

  it('bez kosztu mięsa nadal działa — tylko bez kwot', () => {
    const b = executiveBrief({ ...BASE, meatCostPerKg: null })
    expect(b).toHaveLength(4)
    expect(b.every(x => x.text.length > 0)).toBe(true)
  })

  it('jeden miesiąc w systemie jest ryzykiem samym w sobie, gdy nie ma nic gorszego', () => {
    const b = executiveBrief({ ...BASE, batches: [], workers: [], offDays: [] })
    expect(b.find(x => x.kind === 'risk')!.text).toMatch(/porównani|jeden miesiąc/i)
  })

  it('nie wymyśla problemu, gdy wszystkie partie trzymają średnią', () => {
    const flat = executiveBrief({
      ...BASE,
      batches: [
        { batchNo: '1', yieldPct: 65.8, kgQuarter: 5000, supplierName: 'KOKO' },
        { batchNo: '2', yieldPct: 65.8, kgQuarter: 5000, supplierName: 'KOKO' },
      ],
      offDays: [],
    })
    expect(flat.find(x => x.kind === 'watch')!.text).not.toMatch(/rozrzut partii/i)
  })

  it('mała próba nie może zostać „największym ryzykiem"', () => {
    const b = executiveBrief({
      ...BASE,
      workers: [...BASE.workers,
        { workerId: 'd', workerName: 'DAWID', kgQuarter: 525, yieldVsBatchPp: -5,
          attendancePct: 6, yieldStdDev: null, smallSample: true, deltaPln: -337 }],
    })
    expect(b.find(x => x.kind === 'risk')!.text).not.toMatch(/DAWID/)
  })
})
