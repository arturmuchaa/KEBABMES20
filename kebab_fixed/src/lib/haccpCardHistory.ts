/**
 * Listy kart HACCP do pobrania (historie kart).
 *
 * Karty HACCP to PUSTE formularze papierowe — MES ich nie przechowuje, tylko
 * numeruje. „Historia" jest więc listą kart, które w danym okresie powinny
 * istnieć: biuro wybiera dzień i pobiera gotową, ponumerowaną kartę.
 *
 * Numery liczą TE SAME funkcje, co strony wydruku — inaczej lista i karta
 * mogłyby pokazywać różne numery tego samego dokumentu.
 */
import { cardPeriod } from './temperatureLogCard'

export interface HaccpCardRow {
  /** Dzień identyfikujący kartę (ISO) — trafia do URL wydruku i do PDF. */
  day: string
  /** Numer karty. */
  no: string
  /** Okres karty w formie czytelnej dla człowieka. */
  when: string
  /** Dopisek pod okresem (np. dzień tygodnia). */
  note?: string
  /** Karta obejmująca dzisiejszy dzień. */
  current?: boolean
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Numer karty arkusza kontroli sanitarnej — jedna karta na dzień, więc numer
 * wyprowadzamy z daty: D/MM/RR (1 lipca 2026 → „1/07/26").
 */
export const sanitaryCardNo = (d: Date) =>
  `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`

/** Kolejne dni wstecz od `today` — po jednej karcie arkusza kontroli na dzień. */
export function sanitaryCards(count: number, today = new Date()): HaccpCardRow[] {
  const start = midnight(today)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i)
    return {
      day: iso(d),
      no: sanitaryCardNo(d),
      when: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      note: d.toLocaleDateString('pl-PL', { weekday: 'short' }),
      current: i === 0,
    }
  })
}

/** Kolejne tygodnie wstecz od `today` — po jednej karcie temperatur na tydzień. */
export function temperatureCards(count: number, today = new Date()): HaccpCardRow[] {
  const start = midnight(today)
  return Array.from({ length: count }, (_, i) => {
    const seed = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i * 7)
    const { no, days } = cardPeriod(seed)
    const first = days[0]
    const last = days[days.length - 1]
    return {
      day: iso(first),
      no,
      when: `${dm(first)} – ${dm(last)}.${last.getFullYear()}`,
      note: 'pon–ndz',
      current: i === 0,
    }
  })
}
