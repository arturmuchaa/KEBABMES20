import { describe, expect, it } from 'vitest'
import { potentialPln, SMALL_SAMPLE_KG, workerScorecard, type ScorecardWorker } from './workerScorecard'

const w = (over: Partial<ScorecardWorker> = {}): ScorecardWorker => ({
  workerId: 'w1', workerName: 'OLHA', quarters: 40, kgQuarter: 9825, kgMeat: 6553,
  avgYield: 66.7, kgPerHour: 210, days: 17, attendancePct: 100,
  yieldVsBatchPp: 0.97, yieldStdDev: 0.56, ...over,
})

describe('workerScorecard — ranking pracowników w złotówkach', () => {
  it('przelicza odchylenie od partii na złotówki', () => {
    const [r] = workerScorecard([w()], 12.85)
    expect(r.deltaPln).toBeCloseTo(0.97 / 100 * 9825 * 12.85, 0)
    expect(r.deltaPln).toBeGreaterThan(0)
  })

  // Sedno sprawiedliwości: oceniamy względem WŁASNEJ partii, nie zakładu —
  // kto dostał gorszy surowiec, nie może za to odpowiadać.
  it('liczy z korekty o partię, nie z surowego uzysku', () => {
    const bad = w({ avgYield: 64.0, yieldVsBatchPp: 1.0, kgQuarter: 1000 })
    expect(workerScorecard([bad], 10)[0].deltaPln).toBeGreaterThan(0)
  })

  it('sortuje od największego wkładu do największej straty', () => {
    const rows = workerScorecard([
      w({ workerId: 'a', workerName: 'A', yieldVsBatchPp: -0.5 }),
      w({ workerId: 'b', workerName: 'B', yieldVsBatchPp: 1.0 }),
      w({ workerId: 'c', workerName: 'C', yieldVsBatchPp: 0.1 }),
    ], 12.85)
    expect(rows.map(r => r.workerName)).toEqual(['B', 'C', 'A'])
  })

  it('bez kosztu mięsa nie ma kwot, ranking idzie po p.p.', () => {
    const rows = workerScorecard([w({ yieldVsBatchPp: -1 }), w({ workerId: 'b', yieldVsBatchPp: 1 })], null)
    expect(rows[0].deltaPln).toBeNull()
    expect(rows[0].yieldVsBatchPp).toBe(1)
  })

  // DAWID z lipca: 1 dzień, 525 kg. Ocenianie go obok kogoś z 17 t to nonsens.
  it('mała próba jest oznaczona, żeby nikt jej nie oceniał', () => {
    const [r] = workerScorecard([w({ kgQuarter: 525, days: 1, yieldStdDev: null })], 12.85)
    expect(r.smallSample).toBe(true)
    expect(SMALL_SAMPLE_KG).toBeGreaterThan(525)
  })

  it('pełny miesiąc pracy nie jest małą próbą', () => {
    expect(workerScorecard([w()], 12.85)[0].smallSample).toBe(false)
  })

  it('mała próba nie trafia na czoło ani na koniec rankingu', () => {
    const rows = workerScorecard([
      w({ workerId: 'x', workerName: 'DAWID', kgQuarter: 525, days: 1, yieldVsBatchPp: 5 }),
      w({ workerId: 'b', workerName: 'B', yieldVsBatchPp: 1.0 }),
    ], 12.85)
    expect(rows[0].workerName).toBe('B')
  })

  it('udział w wolumenie daje kontekst dla kwoty', () => {
    const rows = workerScorecard([
      w({ workerId: 'a', workerName: 'A', kgQuarter: 7500 }),
      w({ workerId: 'b', workerName: 'B', kgQuarter: 2500 }),
    ], 12.85)
    expect(rows.find(r => r.workerName === 'A')!.volumeSharePct).toBeCloseTo(75, 1)
  })

  it('powtarzalność bez drugiego dnia zostaje pusta, nie zerowa', () => {
    expect(workerScorecard([w({ yieldStdDev: null })], 12.85)[0].yieldStdDev).toBeNull()
  })
})

describe('potentialPln — realna stawka sekcji pracowników', () => {
  // Suma kolumny „Skutek" jest bliska zeru (to porównanie między sobą).
  // Prawdziwa kwota to: najlepszy poziom rozciągnięty na całą ćwiartkę.
  it('liczy różnicę najlepszego rozciągniętą na ćwiartkę zakładu', () => {
    const rows = workerScorecard([w({ yieldVsBatchPp: 0.97 }),
      w({ workerId: 'b', workerName: 'B', yieldVsBatchPp: -0.5 })], 12.85)
    const p = potentialPln(rows, 118945, 12.85)!
    expect(p.workerName).toBe('OLHA')
    expect(p.pln).toBeCloseTo(0.97 / 100 * 118945 * 12.85, 0)
  })

  it('mała próba nie może zostać wzorcem — jeden dobry dzień to nie poziom', () => {
    const rows = workerScorecard([
      w({ workerId: 'x', workerName: 'DAWID', kgQuarter: 525, days: 1, yieldVsBatchPp: 5 }),
      w({ yieldVsBatchPp: 0.97 })], 12.85)
    expect(potentialPln(rows, 118945, 12.85)!.workerName).toBe('OLHA')
  })

  it('gdy nikt nie jest nad średnią własnych partii, nie ma czego obiecywać', () => {
    expect(potentialPln(workerScorecard([w({ yieldVsBatchPp: -0.2 })], 12.85), 100000, 12.85)).toBeNull()
  })

  it('bez kosztu mięsa brak kwoty', () => {
    expect(potentialPln(workerScorecard([w()], null), 100000, null)).toBeNull()
  })
})
