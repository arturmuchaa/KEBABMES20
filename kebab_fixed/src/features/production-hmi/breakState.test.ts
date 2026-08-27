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
  BRAK_PRZERW, breakStarted, breakEnded, breaksFromServer, onBreak, canSave, pausedMs, workedMs,
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

// Serwer jest źródłem prawdy od 27.08.2026: kiosk odświeżony w środku przerwy
// (albo postoju — hala wbija wtedy przerwę) musi ją zobaczyć, a nie puścić
// zapis sztuk tak, jakby nic się nie działo.
describe('breaksFromServer', () => {
  it('przerwa zamknięta wraca jako odcinek z końcem', () => {
    const s = breaksFromServer([{ startedAt: t('09:00'), endedAt: t('09:20') }])
    expect(s.pauses).toEqual([{ from: t('09:00'), to: t('09:20') }])
  })

  it('przerwa TRWAJĄCA wraca jako otwarta i blokuje zapis', () => {
    const s = breaksFromServer([{ startedAt: t('09:00'), endedAt: null }])
    expect(onBreak(s)).toBe(true)
    expect(canSave(s)).toBe(false)
  })

  it('kilka przerw dnia wraca w kolejności rozpoczęcia', () => {
    const s = breaksFromServer([
      { startedAt: t('11:00'), endedAt: t('11:15') },
      { startedAt: t('09:00'), endedAt: t('09:20') },
    ])
    expect(s.pauses.map(p => p.from)).toEqual([t('09:00'), t('11:00')])
  })

  it('pusta lista i brak danych dają brak przerw', () => {
    expect(breaksFromServer([])).toEqual(BRAK_PRZERW)
    expect(breaksFromServer(null)).toEqual(BRAK_PRZERW)
    expect(breaksFromServer(undefined)).toEqual(BRAK_PRZERW)
  })

  it('wiersz bez czasu startu jest pomijany, a nie psuje sumy', () => {
    const s = breaksFromServer([
      { startedAt: '', endedAt: null },
      { startedAt: t('09:00'), endedAt: t('09:20') },
    ])
    expect(s.pauses).toHaveLength(1)
  })

  it('czas przerw z serwera liczy się tak samo jak lokalnych', () => {
    const s = breaksFromServer([{ startedAt: t('09:00'), endedAt: t('09:30') }])
    expect(pausedMs(s, t('10:00'))).toBe(30 * 60_000)
  })
})
