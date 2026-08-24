/**
 * Sumy i stany pozycji planu.
 *
 * Postęp liczymy w KILOGRAMACH — plan rozlicza się w kg, a dzień z samych
 * 40-kilogramowych kebabów i dzień z 10-kilogramowych to inna robota. Procent
 * ze sztuk kłamałby operatorowi o tym, gdzie jest dzień.
 */
import { describe, it, expect } from 'vitest'
import { planTotals, lineState, linePct, byWorker, type ProgressLine } from './planProgress'

const p = (over: Partial<ProgressLine> = {}): ProgressLine => ({
  id: 'l1', qty: 20, kgPerUnit: 35, qtyDone: 0, workerEntries: [], ...over,
})

describe('planTotals', () => {
  it('sumuje kilogramy i sztuki', () => {
    const t = planTotals([p({ qty: 20, kgPerUnit: 35, qtyDone: 12 }), p({ id: 'l2', qty: 90, kgPerUnit: 30 })])
    expect(t.sztPlan).toBe(110)
    expect(t.sztDone).toBe(12)
    expect(t.kgPlan).toBe(700 + 2700)
    expect(t.kgDone).toBe(420)
  })

  it('procent liczy z KILOGRAMÓW, nie ze sztuk', () => {
    // 40 sztuk po 10 kg zrobione, 0 z 40 sztuk po 40 kg.
    // Po sztukach wyszłoby 50%. Po kilogramach: 400 / 2000 = 20%.
    const t = planTotals([
      p({ id: 'a', qty: 40, kgPerUnit: 10, qtyDone: 40 }),
      p({ id: 'b', qty: 40, kgPerUnit: 40, qtyDone: 0 }),
    ])
    expect(t.pct).toBe(20)
  })

  it('pusty plan daje zera, nie NaN', () => {
    const t = planTotals([])
    expect(t).toEqual({ kgPlan: 0, kgDone: 0, pct: 0, sztPlan: 0, sztDone: 0 })
  })

  it('nadwyżka nie przekracza 100% — hala zrobiła więcej, to nie błąd ekranu', () => {
    expect(planTotals([p({ qty: 20, kgPerUnit: 35, qtyDone: 23 })]).pct).toBe(100)
  })

  it('zaokrągla procent do całości', () => {
    expect(planTotals([p({ qty: 3, kgPerUnit: 10, qtyDone: 1 })]).pct).toBe(33)
  })

  it('plan bez wagi (0 kg) nie dzieli przez zero', () => {
    expect(planTotals([p({ qty: 10, kgPerUnit: 0, qtyDone: 5 })]).pct).toBe(0)
  })
})

describe('lineState', () => {
  it('bez postępu = zaplanowana', () => { expect(lineState(p({ qtyDone: 0 }))).toBe('PLANNED') })
  it('częściowo = w trakcie',     () => { expect(lineState(p({ qtyDone: 12 }))).toBe('IN_PROGRESS') })
  it('komplet = gotowa',          () => { expect(lineState(p({ qtyDone: 20 }))).toBe('DONE') })
  it('nadwyżka też gotowa',       () => { expect(lineState(p({ qtyDone: 23 }))).toBe('DONE') })
  it('pozycja na zero sztuk jest gotowa od razu, nie wisi w PLANNED', () => {
    expect(lineState(p({ qty: 0, qtyDone: 0 }))).toBe('DONE')
  })
})

describe('linePct', () => {
  it('procent pozycji liczy się ze sztuk — w wierszu waga sztuki jest stała', () => {
    expect(linePct(p({ qty: 20, qtyDone: 12 }))).toBe(60)
  })
  it('nadwyżka ucięta do 100', () => { expect(linePct(p({ qty: 20, qtyDone: 25 }))).toBe(100) })
  it('pozycja na zero sztuk daje 100, nie NaN', () => { expect(linePct(p({ qty: 0 }))).toBe(100) })
})

describe('byWorker', () => {
  it('sumuje wpisy tej samej osoby', () => {
    const linia = p({ workerEntries: [
      { workerId: 'w1', workerName: 'DAWID', pieces: 5, addedAt: '' },
      { workerId: 'w2', workerName: 'DENYS', pieces: 4, addedAt: '' },
      { workerId: 'w1', workerName: 'DAWID', pieces: 3, addedAt: '' },
    ] })
    expect(byWorker(linia)).toEqual([
      { workerId: 'w1', workerName: 'DAWID', pieces: 8 },
      { workerId: 'w2', workerName: 'DENYS', pieces: 4 },
    ])
  })

  it('kolejność wg wkładu, największy pierwszy', () => {
    const linia = p({ workerEntries: [
      { workerId: 'w1', workerName: 'DAWID', pieces: 2, addedAt: '' },
      { workerId: 'w2', workerName: 'DENYS', pieces: 9, addedAt: '' },
    ] })
    expect(byWorker(linia).map(w => w.workerName)).toEqual(['DENYS', 'DAWID'])
  })

  it('brak wpisów to pusta lista, nie wybuch', () => {
    expect(byWorker(p({ workerEntries: undefined as any }))).toEqual([])
  })
})
