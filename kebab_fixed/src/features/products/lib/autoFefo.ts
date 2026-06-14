// src/features/products/lib/autoFefo.ts
/**
 * Dystrybucja partii mięsa wg FEFO po wierszach planu w kolejności.
 * Wiersz 1 dostaje najwcześniej wygasające mięso; kolejne wiersze biorą
 * to, co zostało. Czysta funkcja — wejście/wyjście, bez efektów ubocznych.
 */
export interface AvailLot {
  id: string
  kgFree: number       // dostępne - zarezerwowane (poza tym planem)
  expiryDate: string   // ISO; sortowanie rosnąco = FEFO
}

export interface PlanNeed {
  rowKey: string       // stabilny klucz wiersza (id zlecenia lub 'new-N')
  kg: number           // ile mięsa potrzebuje wiersz
}

export interface LotAlloc {
  meatLotId: string
  kgPlanned: number
}

export function autoFefoDistribute(
  rows: PlanNeed[],
  lots: AvailLot[],
): Record<string, LotAlloc[]> {
  const pool = [...lots]
    .filter(l => l.kgFree > 0.001)
    .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : 1))
    .map(l => ({ ...l }))   // kopia: mutujemy kgFree lokalnie

  const out: Record<string, LotAlloc[]> = {}
  for (const row of rows) {
    let remaining = row.kg
    const allocs: LotAlloc[] = []
    for (const lot of pool) {
      if (remaining <= 0.001) break
      if (lot.kgFree <= 0.001) continue
      const take = Math.min(lot.kgFree, remaining)
      allocs.push({ meatLotId: lot.id, kgPlanned: Math.round(take * 100) / 100 })
      lot.kgFree -= take
      remaining -= take
    }
    out[row.rowKey] = allocs
  }
  return out
}
