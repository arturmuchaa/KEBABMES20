/**
 * Przerwa na produkcji — trzy w ciągu dnia.
 *
 * Przerwa BLOKUJE dodawanie sztuk (decyzja właściciela 24.08.2026). Dzięki
 * temu jedyna możliwa pomyłka — zapomniana przerwa — poprawia się sama:
 * operator zderzy się z nią przy pierwszej sztuce. Wariant „kończy się sama
 * przy zapisie" ukrywałby ten błąd i po cichu ZAWYŻAŁ tempo.
 */
import { describe, it, expect } from 'vitest'
import {
  BRAK_PRZERW, breakStarted, breakEnded, onBreak, canSave, pausedMs, workedMs,
} from './breakState'

const t = (hhmm: string) => `2026-08-25T${hhmm}:00`

describe('breakState', () => {
  it('bez przerwy wolno zapisywać sztuki', () => {
    expect(canSave(BRAK_PRZERW)).toBe(true)
    expect(onBreak(BRAK_PRZERW)).toBe(false)
  })

  it('w trakcie przerwy zapis jest zablokowany', () => {
    const s = breakStarted(BRAK_PRZERW, t('09:00'))
    expect(onBreak(s)).toBe(true)
    expect(canSave(s)).toBe(false)
  })

  it('po wyłączeniu przerwy znowu wolno zapisywać', () => {
    const s = breakEnded(breakStarted(BRAK_PRZERW, t('09:00')), t('09:15'))
    expect(canSave(s)).toBe(true)
    expect(pausedMs(s, t('12:00'))).toBe(15 * 60_000)
  })

  it('przerwa wyłączona dwa razy nie dubluje sumy', () => {
    const raz = breakEnded(breakStarted(BRAK_PRZERW, t('09:00')), t('09:15'))
    const dwa = breakEnded(raz, t('09:40'))
    expect(dwa.pauses).toHaveLength(1)
    expect(pausedMs(dwa, t('12:00'))).toBe(15 * 60_000)
  })

  it('start przerwy w trakcie przerwy nie otwiera drugiej', () => {
    const s = breakStarted(breakStarted(BRAK_PRZERW, t('09:00')), t('09:05'))
    expect(s.pauses).toHaveLength(1)
    expect(s.pauses[0].from).toBe(t('09:00'))
  })

  it('trwająca przerwa liczy się do teraz', () => {
    const s = breakStarted(BRAK_PRZERW, t('09:00'))
    expect(pausedMs(s, t('09:20'))).toBe(20 * 60_000)
  })

  it('sumuje kilka przerw dnia', () => {
    let s = breakEnded(breakStarted(BRAK_PRZERW, t('09:00')), t('09:15'))
    s = breakEnded(breakStarted(s, t('12:00')), t('12:30'))
    expect(s.pauses).toHaveLength(2)
    expect(pausedMs(s, t('14:00'))).toBe(45 * 60_000)
  })
})

describe('workedMs', () => {
  it('godzina zegarowa minus 20 min przerwy to 40 min pracy', () => {
    const s = breakEnded(breakStarted(BRAK_PRZERW, t('09:10')), t('09:30'))
    expect(workedMs(t('09:00'), t('10:00'), s)).toBe(40 * 60_000)
  })

  it('trwająca przerwa też odchodzi od czasu pracy', () => {
    const s = breakStarted(BRAK_PRZERW, t('09:40'))
    expect(workedMs(t('09:00'), t('10:00'), s)).toBe(40 * 60_000)
  })

  it('bez przerw czas pracy to czas zegarowy', () => {
    expect(workedMs(t('06:00'), t('14:00'), BRAK_PRZERW)).toBe(8 * 3_600_000)
  })

  it('nie schodzi poniżej zera, gdy przerwa zaczęła się przed startem zmiany', () => {
    const s = breakEnded(breakStarted(BRAK_PRZERW, t('05:00')), t('07:00'))
    // Liczy się tylko część przerwy PO starcie zmiany: 06:00–07:00.
    expect(workedMs(t('06:00'), t('08:00'), s)).toBe(1 * 3_600_000)
  })

  it('zegar cofnięty nie daje ujemnego czasu pracy', () => {
    expect(workedMs(t('10:00'), t('09:00'), BRAK_PRZERW)).toBe(0)
  })
})
