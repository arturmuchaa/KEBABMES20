/**
 * Warianty wyglądu do porównania przez właściciela (Figma, listopad 2026).
 * Wybór na tym komputerze: localStorage `protrima.wariant.<ekran>` = A | B | C (domyślnie A).
 * Po decyzji właściciela zostaje jeden wariant, a ten plik i przełącznik znikają.
 */
export type Wariant = 'A' | 'B' | 'C'
export function wariant(ekran: 'zamowienia' | 'pulpit'): Wariant {
  try {
    const v = window.localStorage.getItem(`protrima.wariant.${ekran}`)
    return v === 'B' || v === 'C' ? v : 'A'
  } catch { return 'A' }
}
