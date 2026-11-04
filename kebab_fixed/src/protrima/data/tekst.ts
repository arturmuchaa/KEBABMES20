/**
 * Teksty interfejsu wspólne dla modułów: polska odmiana liczebników i krótkie nazwy kontrahentów.
 */

/** Polska odmiana liczebnika: 1 sprawa, 2–4 sprawy, 5+ spraw (12–14 zawsze „spraw”). */
export const odm = (n: number, f1: string, f2: string, f5: string) => {
  const a = Math.abs(n), d = a % 10, s = a % 100
  return a === 1 ? f1 : d >= 2 && d <= 4 && (s < 12 || s > 14) ? f2 : f5
}

/** „5 dni”, „1 dzień”, „2 sztuki” — liczba ze słowem w poprawnej formie. */
export const ile = (n: number, f1: string, f2: string, f5: string) => `${n} ${odm(n, f1, f2, f5)}`

/** Krótka nazwa kontrahenta na gęste panele: bez formy prawnej („SPÓŁKA Z O.O.”, „SP. J.”…). */
export const krotkaNazwa = (n: string) => n
  .replace(/\s+(SPÓŁKA\s+Z\s+OGRANICZONĄ\s+ODPOWIEDZIALNOŚCIĄ|SPÓŁKA\s+AKCYJNA|SPÓŁKA\s+JAWNA|SPÓŁKA\s+KOMANDYTOWA|SP\.?\s*Z\s*O\.?\s*O\.?|S\.\s*A\.|SP\.\s*J\.|SP\.\s*K\.)\s*$/i, '')
  .replace(/\s+(SPÓŁKA|SP\.)\s*$/i, '').trim() || n
