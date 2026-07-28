import { describe, expect, it } from 'vitest'
import {
  BONUS_SHARE, individualBonus, standoutWorker, teamBonusLadder, type BonusWorker,
} from './yieldBonus'

// Realna brygada z lipca 2026 (skrócona).
const CREW: BonusWorker[] = [
  { workerId: 'o', workerName: 'OLHA', kgQuarter: 9825, avgYield: 66.7, days: 17,
    attendancePct: 100, yieldMinDay: 65.2, yieldMaxDay: 68.0, smallSample: false },
  { workerId: 'e', workerName: 'EVGHENII', kgQuarter: 17305, avgYield: 65.9, days: 16,
    attendancePct: 94, yieldMinDay: 64.4, yieldMaxDay: 66.8, smallSample: false },
  { workerId: 'a', workerName: 'ANATOLII', kgQuarter: 12495, avgYield: 65.2, days: 11,
    attendancePct: 65, yieldMinDay: 63.8, yieldMaxDay: 66.8, smallSample: false },
  { workerId: 'd', workerName: 'DAWID', kgQuarter: 525, avgYield: 67.9, days: 1,
    attendancePct: 6, yieldMinDay: 67.9, yieldMaxDay: 67.9, smallSample: true },
]
const PLANT = 65.8
const COST = 12.85

describe('individualBonus — premia za uzysk ponad średnią zakładu', () => {
  it('płaci tylko powyżej progu, proporcjonalnie do kilogramów', () => {
    const rows = individualBonus(CREW, PLANT, COST, 0.4)
    const olha = rows.find(r => r.workerName === 'OLHA')!
    expect(olha.bonusPln).toBeCloseTo((66.7 - PLANT) / 100 * 9825 * COST * 0.4, 0)
    expect(rows.find(r => r.workerName === 'ANATOLII')!.bonusPln).toBe(0)
  })

  it('nie karze za wynik poniżej progu — premia nie schodzi poniżej zera', () => {
    expect(individualBonus(CREW, PLANT, COST, 0.4).every(r => r.bonusPln >= 0)).toBe(true)
  })

  // DAWID: 1 dzień, 525 kg, uzysk 67,9%. Bez tego progu jeden dobry dzień
  // wypłacałby premię za wynik, którego nikt nie jest w stanie potwierdzić.
  it('mała próba nie dostaje premii, ale jest widoczna z powodem', () => {
    const dawid = individualBonus(CREW, PLANT, COST, 0.4).find(r => r.workerName === 'DAWID')!
    expect(dawid.bonusPln).toBe(0)
    expect(dawid.excluded).toBe(true)
  })

  it('sortuje malejąco po kwocie premii', () => {
    const rows = individualBonus(CREW, PLANT, COST, 0.4).filter(r => !r.excluded)
    expect(rows.map(r => r.bonusPln)).toEqual([...rows.map(r => r.bonusPln)].sort((a, b) => b - a))
  })

  it('liczy, ile z korzyści zostaje firmie', () => {
    const rows = individualBonus(CREW, PLANT, COST, 0.4)
    const olha = rows.find(r => r.workerName === 'OLHA')!
    expect(olha.valuePln).toBeCloseTo(olha.bonusPln / 0.4, 0)
    expect(olha.companyPln).toBeCloseTo(olha.valuePln - olha.bonusPln, 0)
  })

  it('bez kosztu mięsa nie da się wyliczyć premii', () => {
    expect(individualBonus(CREW, PLANT, null, 0.4)).toEqual([])
  })
})

describe('teamBonusLadder — wariant zespołowy', () => {
  it('pula rośnie z uzyskiem zakładu ponad próg', () => {
    const l = teamBonusLadder(118945, PLANT, COST, 0.4, [66.0, 66.5])
    expect(l[0].poolPln).toBeCloseTo((66.0 - PLANT) / 100 * 118945 * COST * 0.4, 0)
    expect(l[1].poolPln).toBeGreaterThan(l[0].poolPln)
  })

  it('pokazuje, ile zostaje firmie na każdym szczeblu', () => {
    for (const step of teamBonusLadder(118945, PLANT, COST, 0.4, [66.0, 66.5])) {
      expect(step.companyPln).toBeCloseTo(step.gainPln - step.poolPln, 0)
      expect(step.companyPln).toBeGreaterThan(0)
    }
  })

  it('próg poniżej obecnej średniej nie trafia na drabinkę — nie ma za co płacić', () => {
    expect(teamBonusLadder(118945, PLANT, COST, 0.4, [65.0, 66.0]).map(s => s.yieldPct))
      .toEqual([66.0])
  })

  it('bez kosztu mięsa drabinki nie ma', () => {
    expect(teamBonusLadder(118945, PLANT, null, 0.4, [66.0])).toEqual([])
  })
})

describe('standoutWorker — kogo nagrodzić poza schematem', () => {
  it('wskazuje najlepszego z wiarygodną próbą, nie najlepszy jednodniowy wynik', () => {
    expect(standoutWorker(CREW, PLANT)!.workerName).toBe('OLHA')
  })

  it('niesie argumenty, nie samą kwotę', () => {
    const s = standoutWorker(CREW, PLANT)!
    expect(s.deltaPp).toBeCloseTo(0.9, 1)
    expect(s.fullAttendance).toBe(true)
    // Olha ma 65,2% w najsłabszym dniu przy średnej zakładu 65,8% — czyli
    // JEDNAK schodzi poniżej. Flaga musi to pokazywać zgodnie z prawdą,
    // bo to argument, którym da się uzasadnić premię przed załogą.
    expect(s.worstDayAbovePlant).toBe(false)
  })

  it('flaga „nawet najgorszy dzień ponad zakład" zapala się, gdy tak jest', () => {
    const stabilna = CREW.map(w => w.workerName === 'OLHA'
      ? { ...w, yieldMinDay: 66.0 } : w)
    expect(standoutWorker(stabilna, PLANT)!.worstDayAbovePlant).toBe(true)
  })

  it('nie wskazuje nikogo, gdy nikt nie jest ponad średnią', () => {
    const weak = CREW.map(w => ({ ...w, avgYield: 65.0 }))
    expect(standoutWorker(weak, PLANT)).toBeNull()
  })

  it('domyślny udział w korzyści jest jawny, nie ukryty w kodzie', () => {
    expect(BONUS_SHARE).toBeGreaterThan(0)
    expect(BONUS_SHARE).toBeLessThan(1)
  })
})
