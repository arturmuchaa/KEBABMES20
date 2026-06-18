/**
 * Dodruk pojedynczej etykiety sztuki (awaria druku QR).
 * Czyste helpery wspólne dla LabelPrintPage (filtr) i UnitReprintModal (status).
 */

/** Podzbiór sztuk po idach. Pusta lista idów = brak filtra (wszystkie). */
export function filterUnitsByIds<T extends { id: string }>(units: T[], ids: string[]): T[] {
  if (!ids || ids.length === 0) return units
  const set = new Set(ids)
  return units.filter(u => set.has(u.id))
}

/** Czy sztuka została zeskanowana w produkcji (planned = jeszcze nie). */
export function isScanned(status: string): boolean {
  return status === 'produced' || status === 'packed' || status === 'shipped'
}
