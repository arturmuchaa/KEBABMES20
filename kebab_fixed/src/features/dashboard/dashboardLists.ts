/**
 * dashboardLists.ts — dobór pozycji na główny pulpit biura.
 *
 * Pulpit ma pokazywać STAN ZAKŁADU, nie archiwum. Trzy reguły wyjęte tu
 * z `DashboardPage`, żeby dało się je przetestować bez montowania strony:
 *
 *  1. Karta „Rozbiór" pokazuje wyłącznie surowiec, który NA rozbiór idzie.
 *     Dostawy mięsa z/s, fileta czy indyka trafiają wprost do `meat_stock`,
 *     więc ich partia surowca ma `kg_available = 0` od pierwszej sekundy —
 *     na liście wyglądały jak zakończony rozbiór z zerowym uzyskiem
 *     („501 SZUMERA 3020 → 0 kg", „497 ROSSO 311 → 0 kg").
 *  2. Zakończonych partii pokazujemy kilka ostatnich, nie całą historię.
 *  3. Mięso z/s po rozbiorze układa się od najkrótszego terminu (FEFO) —
 *     pulpit ma mówić „to zużyj najpierw", a nie „tego jest najwięcej".
 */

/** Ile ostatnich zakończonych partii pokazuje karta „Rozbiór". */
export const FINISHED_BATCHES_LIMIT = 5

export interface MaterialTypeFlag {
  readonly id: string
  readonly requiresDeboning?: boolean
}

export interface DashboardBatch {
  readonly materialTypeId?: string
  readonly internalBatchSeq?: number
}

/**
 * Czy partia surowca idzie na rozbiór.
 *
 * Nieznany rodzaj = ćwiartka. Słownik rodzajów dojeżdża osobnym żądaniem i
 * partie sprzed wprowadzenia kolumny nie mają `materialTypeId` — domyślne
 * `false` gasiłoby całą kartę na czas ładowania i chowało stare partie.
 */
export function batchRequiresDeboning(
  batch: DashboardBatch,
  materialTypes: readonly MaterialTypeFlag[],
): boolean {
  const id = batch.materialTypeId ?? ''
  if (!id) return true
  const type = materialTypes.find(t => t.id === id)
  if (!type) return true
  return type.requiresDeboning !== false
}

export function filterDeboningBatches<T extends DashboardBatch>(
  batches: readonly T[],
  materialTypes: readonly MaterialTypeFlag[],
): T[] {
  return batches.filter(b => batchRequiresDeboning(b, materialTypes))
}

/**
 * Ostatnie zakończone partie — najnowsze pierwsze, przycięte do `limit`.
 * Bieżących (aktywnych) partii nie przycinamy nigdzie: te są stanem magazynu.
 */
export function lastFinishedBatches<T extends DashboardBatch>(
  finished: readonly T[],
  limit: number = FINISHED_BATCHES_LIMIT,
): T[] {
  return [...finished]
    .sort((a, b) => (b.internalBatchSeq ?? 0) - (a.internalBatchSeq ?? 0))
    .slice(0, Math.max(0, limit))
}

export interface MeatGroup {
  readonly rawBatchNo: string
  readonly kg: number
  readonly earliestExpiry: string
}

/**
 * Mięso z/s od najkrótszej daty ważności. Partie bez terminu idą na koniec —
 * brak daty nie może udawać najpilniejszej. Remis rozstrzyga większa masa.
 */
export function sortMeatGroupsByExpiry<T extends MeatGroup>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) => {
    const ea = a.earliestExpiry || ''
    const eb = b.earliestExpiry || ''
    if (ea !== eb) {
      if (!ea) return 1
      if (!eb) return -1
      return ea < eb ? -1 : 1
    }
    return b.kg - a.kg
  })
}
