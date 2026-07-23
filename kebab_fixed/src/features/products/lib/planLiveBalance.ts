/**
 * Żywe saldo mięsa przy planowaniu dnia masowania.
 *
 * `kg_free` z backendu = `kg_available - kg_reserved`, więc rezerwacje JUŻ
 * ZAPISANEGO planu tego dnia są odjęte od puli. Edytor dnia musi liczyć jak
 * backend przy zapisie (save_day_plan: zwolnij stare loty → zarezerwuj nowe):
 * pula dnia = kg_free + własne rezerwacje wczytanego planu. Bez tego panel
 * boczny odejmował kg wierszy DRUGI raz, a picker nie schodził na żywo wcale.
 *
 * Lustro wzorca `production-plan/planOwnReservations` dla planu masowania.
 */

export interface DraftLotLite {
  meatLotId: string
  kgPlanned: number
}

export interface DraftRowLite {
  lots: DraftLotLite[]
}

/** Suma kg per partia trzymana przez wiersze planu (szkic albo stan z serwera). */
export function reservedByLot(rows: DraftRowLite[] | undefined | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows ?? []) {
    for (const l of row.lots ?? []) {
      const kg = Number(l.kgPlanned || 0)
      if (!l.meatLotId || !(kg > 0)) continue
      out.set(l.meatLotId, (out.get(l.meatLotId) ?? 0) + kg)
    }
  }
  return out
}

/**
 * Pula „do rozplanowania" per partia = kg_free (API) + rezerwacje wczytanego
 * planu tego dnia. Partie bez puli (zarezerwowane w całości pod INNE dni)
 * odpadają — nie są do dyspozycji tego planu.
 */
export function withDayPool<T extends { id: string; kgAvailable: number }>(
  lots: T[],
  savedByLot: Map<string, number>,
): T[] {
  return lots
    .map(l => ({ ...l, kgAvailable: Math.max(0, l.kgAvailable) + (savedByLot.get(l.id) ?? 0) }))
    .filter(l => l.kgAvailable > 0.001)
}

/** Wolne NA ŻYWO per partia = pula dnia − bieżący szkic (wszystkie wiersze). */
export function liveFreeByLot(
  poolLots: { id: string; kgAvailable: number }[],
  draftByLot: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of poolLots) out.set(l.id, l.kgAvailable - (draftByLot.get(l.id) ?? 0))
  return out
}
