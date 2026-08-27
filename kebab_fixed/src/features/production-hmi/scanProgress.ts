/**
 * Próg skanu pozycji planu — granica między „liczbą na ekranie" a magazynem.
 *
 * Sztuki wpisane przez operatora to jeszcze deklaracja: wolno je dodać i odjąć,
 * także po zamknięciu pozycji, bo pomyłka wychodzi zwykle na końcu. Skan jest
 * momentem, w którym sztuka fizycznie wchodzi na magazyn wyrobu gotowego
 * (`finished_units` → `book_scanned_unit`) — od tej chwili nie ma czego cofać
 * na HMI, zostaje przepisanie pracy komu innemu (`move-pieces`).
 *
 * Skan jednej sztuki NIE zamraża całej pozycji: nadwyżkę wpisaną przez pomyłkę
 * trzeba dać się skasować. Blokujemy dokładnie tyle, ile fizycznie zeszło.
 */

export interface LineScan {
  /** Ile sztuk pozycji w ogóle wygenerowano (biuro drukujące etykiety). */
  total: number
  /** Ile z nich zeskanowano na hali. */
  scanned: number
}

export type ScanMap = Record<string, LineScan>

/** Tyle z pozycji planu, ile potrzeba do liczenia progu. */
export interface ScanLine {
  id: string
  qty: number
  qtyDone: number
}

const PUSTY: LineScan = { total: 0, scanned: 0 }

export function scanOf(map: ScanMap | undefined | null, lineId: string): LineScan {
  const s = map?.[lineId]
  if (!s) return PUSTY
  return { total: Number(s.total ?? 0), scanned: Number(s.scanned ?? 0) }
}

/** Ile sztuk wolno jeszcze odjąć z pozycji: wpisane minus zeskanowane. */
export function removablePieces(line: ScanLine, map: ScanMap | undefined | null): number {
  const done = Number(line?.qtyDone ?? 0)
  return Math.max(0, done - scanOf(map, String(line?.id ?? '')).scanned)
}

/** Pozycja POTWIERDZONA — cała zeskanowana, nie tylko policzona. */
export function isConfirmed(line: ScanLine, map: ScanMap | undefined | null): boolean {
  const qty = Number(line?.qty ?? 0)
  const { scanned } = scanOf(map, String(line?.id ?? ''))
  return qty > 0 && scanned >= qty
}

export type LineScanState = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CONFIRMED'

/** Stan pozycji na liście planu — z potwierdzeniem skanem na szczycie. */
export function lineScanState(line: ScanLine, map: ScanMap | undefined | null): LineScanState {
  if (isConfirmed(line, map)) return 'CONFIRMED'
  const qty = Number(line?.qty ?? 0)
  const done = Number(line?.qtyDone ?? 0)
  if (done >= qty) return 'DONE'
  if (done > 0) return 'IN_PROGRESS'
  return 'PLANNED'
}
