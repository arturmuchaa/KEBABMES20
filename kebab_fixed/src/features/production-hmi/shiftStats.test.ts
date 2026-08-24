/**
 * Statystyki zmiany — kto ile zrobił i w jakim tempie.
 *
 * Tempo w KILOGRAMACH na godzinę, nie w sztukach: 40 kg i 10 kg to inna
 * praca, a tempo w sztukach karałoby za robienie dużych kebabów. Czas przerw
 * odchodzi od czasu pracy.
 */
import { describe, it, expect } from 'vitest'
import { shiftStats, type ShiftEntry } from './shiftStats'
import { BRAK_PRZERW, breakStarted, breakEnded } from './breakState'

const t = (hhmm: string) => `2026-08-25T${hhmm}:00`
const e = (worker: string, pieces: number, kgPerPiece: number): ShiftEntry =>
  ({ worker, pieces, kgPerPiece, at: t('08:00') })

const okno = { from: t('06:00'), now: t('08:36'), pauses: BRAK_PRZERW }

describe('shiftStats', () => {
  it('liczy kilogramy jako sztuki × waga sztuki', () => {
    const s = shiftStats([e('DAWID', 5, 40), e('DAWID', 12, 35)], okno)
    expect(s.perWorker[0].kg).toBe(5 * 40 + 12 * 35)
    expect(s.perWorker[0].pieces).toBe(17)
  })

  it('tempo bierze się z czasu PRACY, nie zegarowego', () => {
    const zPrzerwa = breakEnded(breakStarted(BRAK_PRZERW, t('07:00')), t('08:00'))
    const bez = shiftStats([e('DAWID', 10, 40)], { from: t('06:00'), now: t('08:00'), pauses: BRAK_PRZERW })
    const zP  = shiftStats([e('DAWID', 10, 40)], { from: t('06:00'), now: t('08:00'), pauses: zPrzerwa })
    expect(bez.perWorker[0].kgPerHour).toBe(200)  // 400 kg / 2 godz.
    expect(zP.perWorker[0].kgPerHour).toBe(400)   // 400 kg / 1 godz. pracy
  })

  it('rozbicie na wagi sztuk — „5 × 40 kg, 10 × 20 kg"', () => {
    const s = shiftStats([e('DAWID', 5, 40), e('DAWID', 10, 20), e('DAWID', 3, 40)], okno)
    expect(s.perWorker[0].split).toEqual([
      { kgPerPiece: 40, pieces: 8 },   // powtórzona waga sumowana
      { kgPerPiece: 20, pieces: 10 },
    ])
  })

  it('rozbicie idzie od najcięższej sztuki', () => {
    const s = shiftStats([e('DAWID', 1, 10), e('DAWID', 1, 35), e('DAWID', 1, 20)], okno)
    expect(s.perWorker[0].split.map(x => x.kgPerPiece)).toEqual([35, 20, 10])
  })

  it('kolejność pracowników wg kilogramów, najwięcej pierwszy', () => {
    const s = shiftStats([e('DAWID', 1, 10), e('DENYS', 1, 50)], okno)
    expect(s.perWorker.map(w => w.worker)).toEqual(['DENYS', 'DAWID'])
  })

  it('suma zmiany to suma pracowników', () => {
    const s = shiftStats([e('DAWID', 5, 40), e('DENYS', 10, 30)], okno)
    expect(s.total.kg).toBe(500)
    expect(s.total.pieces).toBe(15)
    expect(s.total.workers).toBe(2)
  })

  it('zero czasu pracy daje tempo 0, nie Infinity', () => {
    const s = shiftStats([e('DAWID', 5, 40)], { from: t('08:00'), now: t('08:00'), pauses: BRAK_PRZERW })
    expect(s.perWorker[0].kgPerHour).toBe(0)
    expect(s.total.kgPerHour).toBe(0)
  })

  it('brak wpisów daje puste statystyki, nie NaN', () => {
    const s = shiftStats([], okno)
    expect(s.perWorker).toEqual([])
    expect(s.total).toEqual({ kg: 0, pieces: 0, kgPerHour: 0, workers: 0, workedMs: 9_360_000 })
  })

  it('podaje czas pracy zmiany, żeby ekran mógł pokazać „2 godz. 36 min"', () => {
    expect(shiftStats([], okno).total.workedMs).toBe((2 * 60 + 36) * 60_000)
  })
})
