/**
 * Warianty wyglądu do porównania przez właściciela (Figma, listopad 2026).
 * Pilot 0.6.0 (5.11.2026, decyzja właściciela: „daj opcję B, zobaczę, jak to wygląda w produkcji”):
 * domyślnie B — lista zamówień z kolumną „Dalej”, Pulpit „Do zrobienia teraz”.
 * Na tym komputerze można przełączyć: localStorage `protrima.wariant.<ekran>` = A | B | C.
 * Po ostatecznej decyzji zostaje jeden wariant, a ten plik i przełącznik znikają.
 */
export type Wariant = 'A' | 'B' | 'C'
export function wariant(ekran: 'zamowienia' | 'pulpit'): Wariant {
  try {
    const v = window.localStorage.getItem(`protrima.wariant.${ekran}`)
    if (v === 'A' || v === 'C') return v
  } catch { /* bez pamięci przeglądarki — domyślny */ }
  return 'B'
}
