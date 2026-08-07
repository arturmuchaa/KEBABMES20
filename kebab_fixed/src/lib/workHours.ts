/**
 * Siatka godzin pracowników ogólnych — czysta logika, bez DOM i bez API.
 *
 * Dzień bywa NIEDOKOŃCZONY: biuro zapisuje rano sam start, koniec dopisuje
 * po południu (czasem po dwóch dniach). Dlatego `timeTo` bywa puste, a
 * `hours` jest wtedy `null` — to zmiana OTWARTA, nie zero godzin.
 *
 * BRAK KOMÓRKI ≠ WOLNE. Brak znaczy „jeszcze nie wpisane" i właśnie dlatego
 * `weekGaps` liczy te dwa stany osobno.
 */

export type HourStatus = 'work' | 'off' | 'vacation' | 'sick' | 'absent'

export interface HourCell {
  workerId: string
  workDate: string
  status: HourStatus
  timeFrom: string
  timeTo: string
  hours: number | null
  /** Dzień objęty rozliczeniem — komórka tylko do odczytu. */
  settled?: boolean
}

export const STATUS_LABEL: Record<HourStatus, string> = {
  work: 'Praca',
  off: 'Wolne',
  vacation: 'Urlop',
  sick: 'Chorobowe',
  absent: 'Nieobecność',
}

/**
 * '6' → 360, '6:30' → 390, '8,5' → 510, '8,30' → 510.
 *
 * Dwukropek wymaga Shift, więc połówki wpisuje się przecinkiem. Cyfry po
 * przecinku czytamy zależnie od ich liczby, bo oba zapisy są w użyciu:
 *   1 cyfra  → ułamek godziny  ('8,5'  = pół do dziewiątej = 8:30)
 *   2 cyfry  → minuty          ('8,30' = 8:30, nie 8:18)
 * Bez tego rozróżnienia „8,30" wyszłoby 8:18 i po cichu zaniżyło wypłatę.
 *
 * null gdy to nie jest godzina.
 */
export function parseTime(v: string): number | null {
  const s = (v ?? '').trim()
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (colon) {
    const hh = Number(colon[1]); const mm = Number(colon[2])
    return hh > 23 || mm > 59 ? null : hh * 60 + mm
  }
  const dec = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(s)
  if (!dec) return null
  const hh = Number(dec[1])
  if (hh > 23) return null
  const frac = dec[2]
  if (frac === undefined) return hh * 60
  const mm = frac.length === 1
    ? Math.round(Number(frac) / 10 * 60)   // '8,5' → 30 min
    : Number(frac)                          // '8,30' → 30 min
  return mm > 59 ? null : hh * 60 + mm
}

export function formatTime(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

/** null = zmiana otwarta albo błędny wpis. Koniec przed startem = przez północ. */
export function computeHours(from: string, to: string): number | null {
  const a = parseTime(from)
  const b0 = parseTime(to)
  if (a === null || b0 === null || a === b0) return null
  const b = b0 < a ? b0 + 24 * 60 : b0
  return Math.round(((b - a) / 60) * 100) / 100
}

/** Poniedziałek tygodnia zawierającego podaną datę (tydzień Pn–Nd). */
export function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const dow = d.getDay()               // 0 = niedziela
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return d.toISOString().slice(0, 10)
}

export function weekDays(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayIso + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

/** Niedziela — jedyny dzień, za który należy się premia niedzielna. */
export function isSunday(iso: string): boolean {
  return new Date(iso + 'T12:00:00').getDay() === 0
}

export function isOpenCell(c: HourCell): boolean {
  return c.status === 'work' && !c.timeTo
}

/**
 * Ile dni czeka na domknięcie, a ile na jakikolwiek wpis — liczone do
 * dnia dzisiejszego włącznie (dni przyszłe nie są brakiem).
 */
export function weekGaps(
  cells: HourCell[],
  workerIds: string[],
  days: string[],
  todayIso: string,
): { open: number; missing: number } {
  const byKey = new Map(cells.map(c => [`${c.workerId}|${c.workDate}`, c]))
  let open = 0
  let missing = 0
  for (const day of days) {
    if (day > todayIso) continue
    for (const w of workerIds) {
      const c = byKey.get(`${w}|${day}`)
      if (!c) { missing += 1; continue }
      if (isOpenCell(c)) open += 1
    }
  }
  return { open, missing }
}
