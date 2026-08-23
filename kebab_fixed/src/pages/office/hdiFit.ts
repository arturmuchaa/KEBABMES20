/**
 * hdiFit — dopasowanie arkusza HDI do JEDNEJ strony A4.
 *
 * HDI ma się mieścić na jednej kartce: na dole jest pole na podpis i pieczęć
 * wystawiającego i to ono spada na drugą stronę, gdy zabraknie miejsca.
 *
 * Mechanika: tabela ma najwyżej MAX_ROWS wierszy (pozycje + puste dopełniające),
 * a wolną przestrzeń rozkładamy równo podwyższając wiersze, aż arkusz wypełni
 * kartkę. Gdy pozycji jest tyle, że i tak się nie mieści — skalujemy w dół.
 *
 * DLACZEGO ZAPAS JEST DUŻY (poprawka 2026-08-23):
 * Zadrukowana część A4 przy marginesie 5 mm to zmierzone 1085 px (96 dpi).
 * Poprzednie progi (wypełnienie 1020, próg skalowania 1050) zostawiały
 * odpowiednio 17 mm i zaledwie 9 mm luzu — biuro dostawało wydruk na dwóch
 * stronach z uciętym polem na podpis. Ten luz zjada wszystko, czego nie widać
 * w pomiarze na ekranie:
 *   • okno druku WebView2 (Tauri) ma domyślnie WŁĄCZONE nagłówki i stopki,
 *     a Chromium powiększa wtedy marginesy, żeby zrobić na nie miejsce,
 *   • sterowniki drukarek wymuszają własny nieзадrukowywalny margines,
 *   • Windows ma prawdziwy Arial, a maszyna deweloperska tylko zamiennik —
 *     inne metryki to inne zawijanie wierszy i inna wysokość.
 * Pomiar na ekranie nie widzi żadnej z tych rzeczy, więc zamiast dopychać
 * arkusz pod krawędź zostawiamy ~9 % kartki wolnego. Kosztuje to odrobinę
 * mniej „wypełniony" wygląd tabeli i jest to cena, którą świadomie płacimy.
 */

/** Zadrukowana część A4 (297 mm − 2×5 mm marginesu) przy 96 dpi. Zmierzone. */
export const A4_PRINTABLE_PX = 1085
/** Docelowe wypełnienie arkusza — ~259 mm, czyli 28 mm zapasu. */
export const A4_FILL_PX = 980
/** Powyżej tej wysokości skalujemy dokument w dół — ~265 mm, 22 mm zapasu. */
export const A4_MAX_PX = 1000
/** Maksymalna liczba wierszy tabeli (pozycje + puste dopełniające). */
export const MAX_ROWS = 15
/** Poniżej tego nie schodzimy — dokument musi zostać czytelny. */
export const MIN_SCALE = 0.55
/** Najwyższe dopuszczalne podwyższenie pojedynczego wiersza. */
export const MAX_ROW_EXTRA = 40

export interface FitState {
  /** Rozłożony naddatek wysokości na wiersz (px). */
  rowExtra: number
  /** Skala całego arkusza (1 = bez skalowania). */
  scale: number
  /** Wysokość obudowy przy skalowaniu — null, gdy scale === 1. */
  scaledH: number | null
}

/** Ile wierszy „ciała" tabeli ma dokument o `n` pozycjach. */
export const bodyRowsFor = (n: number): number => (n <= MAX_ROWS ? MAX_ROWS : n)

/**
 * Prawdziwa, nieskalowana wysokość arkusza — z pomiaru zdejmujemy to,
 * co sami dołożyliśmy w poprzednim przebiegu (skalę albo naddatek wierszy).
 */
export function baseHeight(measured: number, state: FitState, bodyRows: number): number {
  return state.scale !== 1
    ? measured / state.scale
    : measured - state.rowExtra * bodyRows
}

/**
 * Docelowy stan dopasowania dla arkusza o naturalnej wysokości `h0`.
 * Czysta funkcja — bez DOM, bez Reacta, więc da się ją przetestować.
 */
export function fitFor(h0: number, bodyRows: number): FitState {
  if (h0 > A4_MAX_PX) {
    const scale = Math.max(MIN_SCALE, A4_MAX_PX / h0)
    return { rowExtra: 0, scale, scaledH: Math.ceil(h0 * scale) }
  }
  const rowExtra = bodyRows > 0
    ? Math.max(0, Math.min(MAX_ROW_EXTRA, (A4_FILL_PX - h0) / bodyRows))
    : 0
  return { rowExtra, scale: 1, scaledH: null }
}

/** Czy nowy stan różni się od bieżącego na tyle, żeby warto było przerysować. */
export function fitChanged(a: FitState, b: FitState): boolean {
  return Math.abs(a.rowExtra - b.rowExtra) > 0.5 || Math.abs(a.scale - b.scale) > 0.004
}
