/**
 * paySlipPrint.ts — czysta logika druku zbiorczego pasków wypłat
 * (src/pages/office/PayrollPage.tsx): filtr zakresu dat i podział pasków
 * na strony A4 po 4 (siatka 2×2). Wydzielone, żeby dało się to testować
 * bez renderowania React.
 */

export const SLIPS_PER_PAGE = 4

export interface SettlementRange {
  date_from: string
  date_to: string
}

/** Okres rozliczenia zahacza o zakres [from, to] (brzegi włącznie).
 * Pusty koniec zakresu = brak ograniczenia z tej strony. */
export function settlementOverlapsRange(s: SettlementRange, from: string, to: string): boolean {
  if (to && s.date_from > to) return false
  if (from && s.date_to < from) return false
  return true
}

/** Podział na strony po 4, ostatnia dopełniona `null` (puste komórki 2×2).
 * Pusta lista → jedna pusta strona (tak drukował dotychczasowy kod). */
export function chunkIntoPages<T>(items: T[]): (T | null)[][] {
  const pages: (T | null)[][] = []
  for (let i = 0; i < Math.max(1, items.length); i += SLIPS_PER_PAGE) {
    const chunk: (T | null)[] = items.slice(i, i + SLIPS_PER_PAGE)
    while (chunk.length < SLIPS_PER_PAGE) chunk.push(null)
    pages.push(chunk)
  }
  return pages
}

/** Liczba kartek A4 dla n pasków (min 1) — licznik w stopce dialogu. */
export function pageCount(n: number): number {
  return Math.max(1, Math.ceil(n / SLIPS_PER_PAGE))
}
