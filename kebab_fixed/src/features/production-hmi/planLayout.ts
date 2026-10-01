/**
 * Układ listy planu: ile kolumn i jak wysoki wiersz, żeby CAŁY plan stał na
 * ekranie bez przewijania.
 *
 * Hala planuje 1–30 pozycji dziennie. Mały plan dostaje jedną kolumnę dużych
 * wierszy (czytelne z dwóch metrów), duży — dwie uporządkowane kolumny (1–15
 * po lewej, 16–30 po prawej), zamiast trzydziestu mikroskopijnych wierszy
 * jeden pod drugim. Wiersz nie rośnie w nieskończoność: jedna pozycja na
 * pustym ekranie ma wyglądać jak wiersz listy, nie jak billboard.
 *
 * Gdy nawet dwie kolumny nie mieszczą się w minimalnej wysokości (plan > 30
 * na małym ekranie, okno spoza zakresu HMI), układ JAWNIE przechodzi na
 * przewijanie — nigdy nie ucinamy pozycji ani nie chowamy ich za krawędzią.
 */

export type Density = 'L' | 'M' | 'S'

export interface PlanLayout {
  cols: 1 | 2
  rows: number
  /** Wysokość wiersza w px (bez odstępu). */
  rowH: number
  density: Density
  /** `true` — plan nie mieści się; lista przewija się i mówi to wprost. */
  scroll: boolean
}

export const ROW_MAX = 92
/** Jedna kolumna, dopóki wiersz ma przynajmniej tyle — potem dwie. */
export const ROW_ONE_COL_MIN = 48
/** Poniżej tej wysokości wiersz przestaje być celem dotykowym (wiersz ma
 *  ~400 px szerokości, więc 30 px wysokości to wciąż duży cel dla palca). */
export const ROW_MIN = 30
export const ROW_GAP = 4

const gestosc = (h: number): Density => (h >= 64 ? 'L' : h >= 48 ? 'M' : 'S')

/**
 * @param n       liczba pozycji planu
 * @param height  wysokość obszaru listy w px; `null` — jeszcze nie zmierzona
 *                (pierwszy render, jsdom) — wtedy układ zachowawczy.
 */
export function planLayout(n: number, height: number | null): PlanLayout {
  const count = Math.max(0, Math.floor(n))
  if (count === 0) return { cols: 1, rows: 0, rowH: ROW_MAX, density: 'L', scroll: false }

  const wiersz = (rows: number) =>
    height == null ? null : Math.floor((height - ROW_GAP * (rows - 1)) / rows)

  if (height == null) {
    const cols = count <= 12 ? 1 : 2
    const rows = Math.ceil(count / cols)
    return { cols, rows, rowH: 56, density: 'M', scroll: false }
  }

  const jedna = wiersz(count)!
  if (jedna >= ROW_ONE_COL_MIN || count <= 3) {
    const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, jedna))
    return { cols: 1, rows: count, rowH, density: gestosc(rowH), scroll: jedna < ROW_MIN }
  }

  const rows = Math.ceil(count / 2)
  const dwie = wiersz(rows)!
  if (dwie >= ROW_MIN) {
    const rowH = Math.min(ROW_MAX, dwie)
    return { cols: 2, rows, rowH, density: gestosc(rowH), scroll: false }
  }
  return { cols: 2, rows, rowH: ROW_MIN + 6, density: 'S', scroll: true }
}
