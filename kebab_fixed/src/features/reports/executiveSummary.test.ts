import { describe, expect, it } from 'vitest'
import {
  batchDeviations, costWaterfall, execNarrative, massBalance, reportGaps, yieldValue,
  type ExecSummary,
} from './executiveSummary'

// Realne proporcje lipca 2026 (118 945 kg ćwiartki), zaokrąglone.
const S: ExecSummary = {
  kgQuarter: 100000, kgMeat: 65800, kgBacks: 19000, kgBones: 15000, missingKg: 200,
  avgYield: 65.8, kgPerHour: 744.8, quarters: 577, workers: 12,
  quarterCost: 800000, laborCost: 55000, byproductRevenue: 10000, meatCostPerKg: 12.85,
}

describe('massBalance — bilans domknięty do 100%', () => {
  it('przy ubytku składowe sumują się do 100% ćwiartki', () => {
    const b = massBalance(S)
    expect(b.parts.reduce((a, p) => a + p.pct, 0)).toBeCloseTo(100, 1)
    expect(b.parts.some(p => p.tone === 'gap')).toBe(true)
  })

  it('ujemny bilans to NADWYŻKA nad deklarację dostawcy, nie ubytek', () => {
    expect(massBalance({ ...S, missingKg: -833 }).gap.label).toMatch(/nadwyżka/i)
    expect(massBalance({ ...S, missingKg: 833 }).gap.label).toMatch(/ubytek/i)
  })

  // Wpadka z wydruku 28.07: przy nadwyżce wiersz „100,0%" sąsiadował ze
  // składowymi sumującymi się do 101,0% — dla prezesa to błąd rachunkowy.
  it('nadwyżka nie jest frakcją: nie wchodzi do słupka, opisana jest osobno', () => {
    const b = massBalance({ ...S, kgMeat: 65800, kgBacks: 19100, kgBones: 16100, missingKg: -1000 })
    expect(b.parts.some(p => p.tone === 'gap')).toBe(false)
    expect(b.outputPct).toBeCloseTo(101, 1)
    expect(b.gap.surplus).toBe(true)
  })

  it('słupek zawsze domyka się do 100% szerokości', () => {
    for (const missingKg of [833, -833, 0]) {
      const b = massBalance({ ...S, missingKg })
      expect(b.parts.reduce((a, p) => a + p.barPct, 0)).toBeCloseTo(100, 6)
      expect(b.parts.every(p => p.barPct >= 0)).toBe(true)
    }
  })
})

describe('costWaterfall — z czego składa się koszt 1 kg mięsa', () => {
  it('zakup + robocizna − uboczne = koszt netto', () => {
    const w = costWaterfall(S)
    expect(w.netPln).toBe(845000)
    expect(w.netPerKg).toBeCloseTo(845000 / 65800, 2)
    expect(w.steps.map(s => s.sign)).toEqual(['+', '+', '−'])
  })

  it('bez cen zakupu wodospadu nie ma (zamiast zmyślonego zera)', () => {
    expect(costWaterfall({ ...S, quarterCost: null, meatCostPerKg: null })).toBeNull()
  })
})

describe('yieldValue — uzysk przeliczony na złotówki', () => {
  it('0,1 p.p. = 0,1% ćwiartki × koszt 1 kg mięsa', () => {
    const v = yieldValue(S)!
    expect(v.pointKg).toBeCloseTo(100, 1)
    expect(v.pointPln).toBeCloseTo(100 * 12.85, 0)
  })

  it('scenariusz powyżej normy daje zysk, poniżej — stratę', () => {
    const v = yieldValue(S)!
    const up = v.scenarios.find(s => s.yieldPct === 66.5)!
    const down = v.scenarios.find(s => s.yieldPct === 65)!
    expect(up.deltaPln).toBeGreaterThan(0)
    expect(down.deltaPln).toBeLessThan(0)
  })
})

const BATCHES = [
  { batchNo: '411', yieldPct: 64.1, kgQuarter: 7005, supplierName: 'KOKO' },
  { batchNo: '405', yieldPct: 66.9, kgQuarter: 7005, supplierName: 'KOKO' },
  { batchNo: '428', yieldPct: 64.9, kgQuarter: 4605, supplierName: 'KOKO' },
  { batchNo: '414', yieldPct: 66.7, kgQuarter: 5995, supplierName: 'KOKO' },
  { batchNo: '499', yieldPct: null, kgQuarter: 1000, supplierName: 'KOKO' },
]

describe('batchDeviations — gdzie uciekają pieniądze', () => {
  it('przelicza odchylenie od średniej na złotówki', () => {
    const d = batchDeviations(BATCHES, 65.8, 12.85)!
    const b411 = d.all.find(x => x.batchNo === '411')!
    expect(b411.deltaPln).toBeCloseTo((64.1 - 65.8) / 100 * 7005 * 12.85, 0)
    expect(b411.deltaPln).toBeLessThan(0)
  })

  it('najgorsze na początku, najlepsze na końcu', () => {
    const d = batchDeviations(BATCHES, 65.8, 12.85)!
    expect(d.worst[0].batchNo).toBe('411')
    expect(d.best[0].batchNo).toBe('405')
  })

  it('partie bez policzonego uzysku wypadają (nie liczą się jako 0%)', () => {
    expect(batchDeviations(BATCHES, 65.8, 12.85)!.all.some(b => b.batchNo === '499')).toBe(false)
  })

  it('suma strat liczy tylko partie poniżej średniej', () => {
    const d = batchDeviations(BATCHES, 65.8, 12.85)!
    expect(d.lossPln).toBeLessThan(0)
    expect(d.lossPln).toBeCloseTo(d.all.filter(b => b.deltaPln < 0)
      .reduce((a, b) => a + b.deltaPln, 0), 0)
  })

  it('bez ceny mięsa nie ma rankingu w złotówkach', () => {
    expect(batchDeviations(BATCHES, 65.8, null)).toBeNull()
  })
})

describe('execNarrative — podsumowanie regułowe, nie AI', () => {
  const months = [{ yearMonth: '2026-07', avgYield: 65.8, meatCostPerKg: 12.85,
    deltaYieldPp: null, deltaMeatCostPerKg: null }]

  it('te same dane dają ten sam tekst', () => {
    expect(execNarrative(S, BATCHES, months)).toEqual(execNarrative(S, BATCHES, months))
  })

  // Sedno: bez poprzedniego miesiąca raport nie ma prawa napisać „+0,3 p.p.".
  it('bez poprzedniego miesiąca mówi wprost, że nie ma porównania', () => {
    const t = execNarrative(S, BATCHES, months).join(' ')
    expect(t).toMatch(/pierwszy miesiąc|brak.*porównani/i)
    expect(t).not.toMatch(/p\.p\. (więcej|mniej|vs)/i)
  })

  it('z poprzednim miesiącem podaje kierunek zmiany', () => {
    const t = execNarrative(S, BATCHES, [
      { yearMonth: '2026-06', avgYield: 65.5, meatCostPerKg: 12.97, deltaYieldPp: null, deltaMeatCostPerKg: null },
      { yearMonth: '2026-07', avgYield: 65.8, meatCostPerKg: 12.85, deltaYieldPp: 0.3, deltaMeatCostPerKg: -0.12 },
    ]).join(' ')
    expect(t).toMatch(/0,3 p\.p\./)
    expect(t).toMatch(/wyżej|wzrost|poprawa/i)
  })

  it('wskazuje najsłabszą partię z kwotą', () => {
    expect(execNarrative(S, BATCHES, months).join(' ')).toMatch(/411/)
  })
})

describe('reportGaps — czego raport nie obejmuje', () => {
  it('jeden miesiąc danych = jawna informacja o braku trendu', () => {
    const g = reportGaps(S, BATCHES, [{ yearMonth: '2026-07' } as never])
    expect(g.join(' ')).toMatch(/jeden miesiąc|1 miesiąc/i)
  })

  it('partie bez ceny zakupu są wymienione', () => {
    const g = reportGaps(S, [...BATCHES, { batchNo: '450', yieldPct: 65, kgQuarter: 900,
      supplierName: 'X', quarterCost: null }], [])
    expect(g.join(' ')).toMatch(/bez ceny|cen zakupu/i)
  })

  it('zawsze mówi, że sprzedaż jest poza MES', () => {
    expect(reportGaps(S, BATCHES, []).join(' ')).toMatch(/sprzedaż|marż/i)
  })
})
