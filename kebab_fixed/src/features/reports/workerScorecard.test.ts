import { describe, expect, it } from 'vitest'
import {
  batchBiasNotes, potentialPln, SMALL_SAMPLE_KG, workerScorecard, type ScorecardWorker,
} from './workerScorecard'

const PLANT = 65.75

const w = (over: Partial<ScorecardWorker> = {}): ScorecardWorker => ({
  workerId: 'w1', workerName: 'OLHA', quarters: 40, kgQuarter: 9825, kgMeat: 6553,
  avgYield: 66.7, kgPerHour: 210, days: 17, attendancePct: 100,
  yieldVsBatchPp: 0.97, yieldMinDay: 65.2, yieldMaxDay: 68.0, yieldRangePp: 2.8, ...over,
})

describe('workerScorecard — ranking pracowników w złotówkach', () => {
  // Miarą jest odchylenie od ŚREDNIEJ ZAKŁADU: prosto i tak, jak każdy to
  // rozumie bez tłumaczenia (zgłoszenie z biura 28.07).
  it('liczy odchylenie od średniej zakładu i przelicza je na złotówki', () => {
    const [r] = workerScorecard([w()], 12.85, PLANT)
    expect(r.deltaPp).toBeCloseTo(66.7 - PLANT, 2)
    expect(r.deltaPln).toBeCloseTo((66.7 - PLANT) / 100 * 9825 * 12.85, 0)
  })

  it('sortuje od największego wkładu do największej straty', () => {
    const rows = workerScorecard([
      w({ workerId: 'a', workerName: 'A', avgYield: 65.0 }),
      w({ workerId: 'b', workerName: 'B', avgYield: 66.9 }),
      w({ workerId: 'c', workerName: 'C', avgYield: 65.9 }),
    ], 12.85, PLANT)
    expect(rows.map(r => r.workerName)).toEqual(['B', 'C', 'A'])
  })

  it('bez kosztu mięsa nie ma kwot, ranking idzie po p.p.', () => {
    const rows = workerScorecard(
      [w({ avgYield: 64.5 }), w({ workerId: 'b', avgYield: 66.9 })], null, PLANT)
    expect(rows[0].deltaPln).toBeNull()
    expect(rows[0].avgYield).toBe(66.9)
  })

  // DAWID z lipca: 1 dzień, 525 kg. Ocenianie go obok kogoś z 17 t to nonsens.
  it('mała próba jest oznaczona, żeby nikt jej nie oceniał', () => {
    const [r] = workerScorecard([w({ kgQuarter: 525, days: 1, yieldRangePp: null })], 12.85, PLANT)
    expect(r.smallSample).toBe(true)
    expect(SMALL_SAMPLE_KG).toBeGreaterThan(525)
  })

  it('pełny miesiąc pracy nie jest małą próbą', () => {
    expect(workerScorecard([w()], 12.85, PLANT)[0].smallSample).toBe(false)
  })

  it('mała próba nie trafia na czoło ani na koniec rankingu', () => {
    const rows = workerScorecard([
      w({ workerId: 'x', workerName: 'DAWID', kgQuarter: 525, days: 1, avgYield: 72 }),
      w({ workerId: 'b', workerName: 'B', avgYield: 66.5 }),
    ], 12.85, PLANT)
    expect(rows[0].workerName).toBe('B')
  })

  it('udział w wolumenie daje kontekst dla kwoty', () => {
    const rows = workerScorecard([
      w({ workerId: 'a', workerName: 'A', kgQuarter: 7500 }),
      w({ workerId: 'b', workerName: 'B', kgQuarter: 2500 }),
    ], 12.85, PLANT)
    expect(rows.find(r => r.workerName === 'A')!.volumeSharePct).toBeCloseTo(75, 1)
  })

  it('rozstęp bez drugiego dnia zostaje pusty, nie zerowy', () => {
    expect(workerScorecard([w({ yieldRangePp: null })], 12.85, PLANT)[0].yieldRangePp).toBeNull()
  })
})

describe('batchBiasNotes — korekta o partię tylko wtedy, gdy coś zmienia', () => {
  // Na lipcu 2026 obie miary różniły się o 0,00–0,17 p.p. Trzymanie stale
  // drugiej kolumny kosztowałoby zrozumiałość i nic nie wnosiło.
  it('milczy, gdy różnica jest nieistotna', () => {
    const rows = workerScorecard([w({ avgYield: 66.7, yieldVsBatchPp: 0.97 })], 12.85, PLANT)
    expect(batchBiasNotes(rows)).toEqual([])
  })

  it('zgłasza pracownika, który dostawał wyraźnie gorsze partie', () => {
    const rows = workerScorecard(
      [w({ workerName: 'ANATOLII', avgYield: 64.0, yieldVsBatchPp: 1.0 })], 12.85, PLANT)
    const [n] = batchBiasNotes(rows)
    expect(n.workerName).toBe('ANATOLII')
    expect(n.batchBiasPp).toBeGreaterThan(0)
  })

  it('nie zgłasza małych prób — tam różnica to szum', () => {
    const rows = workerScorecard(
      [w({ kgQuarter: 525, avgYield: 60, yieldVsBatchPp: 3 })], 12.85, PLANT)
    expect(batchBiasNotes(rows)).toEqual([])
  })
})

describe('potentialPln — realna stawka sekcji pracowników', () => {
  // Suma kolumny „Skutek" jest bliska zeru (to porównanie między sobą).
  // Prawdziwa kwota to: najlepszy poziom rozciągnięty na całą ćwiartkę.
  it('liczy różnicę najlepszego rozciągniętą na ćwiartkę zakładu', () => {
    const rows = workerScorecard([w({ avgYield: 66.7 }),
      w({ workerId: 'b', workerName: 'B', avgYield: 65.0 })], 12.85, PLANT)
    const p = potentialPln(rows, 118945, 12.85)!
    expect(p.workerName).toBe('OLHA')
    expect(p.pln).toBeCloseTo((66.7 - PLANT) / 100 * 118945 * 12.85, 0)
  })

  it('mała próba nie może zostać wzorcem — jeden dobry dzień to nie poziom', () => {
    const rows = workerScorecard([
      w({ workerId: 'x', workerName: 'DAWID', kgQuarter: 525, days: 1, avgYield: 72 }),
      w({ avgYield: 66.7 })], 12.85, PLANT)
    expect(potentialPln(rows, 118945, 12.85)!.workerName).toBe('OLHA')
  })

  it('gdy nikt nie jest nad średnią własnych partii, nie ma czego obiecywać', () => {
    expect(potentialPln(workerScorecard([w({ avgYield: 65.0 })], 12.85, PLANT), 100000, 12.85)).toBeNull()
  })

  it('bez kosztu mięsa brak kwoty', () => {
    expect(potentialPln(workerScorecard([w()], null, PLANT), 100000, null)).toBeNull()
  })
})
