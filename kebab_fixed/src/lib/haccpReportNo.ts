/**
 * Numer karty raportu HACCP rozbioru: `R/<nr>/MM/RR`.
 *
 * Numer jest PORZĄDKOWY w obrębie miesiąca — liczy karty, nie dni kalendarza.
 * Wcześniej brano wprost dzień miesiąca, więc każdy dzień bez produkcji robił
 * dziurę w numeracji: sobota 1.08 → R/1, niedziela wolna, poniedziałek 3.08 →
 * R/3 (zgłoszenie 2026-08-04). Karty muszą iść R/1, R/2, R/3…, bo inspekcja
 * czyta je jako kolejne dokumenty, a nie jako daty.
 *
 * Reset z nowym miesiącem — jak dotąd (decyzja właściciela 2026-07-16).
 */

/** Dni z produkcją w miesiącu `date`, posortowane rosnąco, bez duplikatów. */
function monthDays(date: string, productionDates: Iterable<string>): string[] {
  const ym = date.slice(0, 7)
  return [...new Set([...productionDates].filter(d => d.slice(0, 7) === ym))].sort()
}

/**
 * @param date            dzień karty, `YYYY-MM-DD`
 * @param productionDates wszystkie dni z produkcją (dowolna kolejność, dowolne miesiące)
 *
 * Numer = ile dni produkcyjnych tego miesiąca wypada do `date` włącznie. Dzięki
 * liczeniu "do daty włącznie" numer nie zmienia się wstecz, gdy dojdą kolejne
 * dni, i działa też, gdy `date` nie ma jeszcze na liście (podgląd pustego dnia).
 */
export function haccpReportNo(date: string, productionDates: Iterable<string>): string {
  const days = monthDays(date, productionDates)
  const upTo = days.filter(d => d <= date).length
  // Dzień spoza listy (np. podgląd dnia bez wpisów) i tak dostaje numer —
  // kolejny po ostatnim dniu produkcyjnym przed nim.
  const nth = days.includes(date) ? upTo : upTo + 1
  return `R/${nth}/${date.slice(5, 7)}/${date.slice(2, 4)}`
}
