/**
 * Rezerwacje mięsa należące do EDYTOWANEGO planu.
 *
 * `kg_free` z backendu = `kg_available - kg_reserved`, więc po zapisaniu planu
 * jego własne rezerwacje wychodzą z puli wolnego mięsa. Przy ponownym otwarciu
 * planu do edycji formularz widziałby zero wolnych kg i blokował zapis
 * („brakuje X kg mięsa") — mimo że backend w `update_plan` NAJPIERW zwalnia
 * rezerwacje tego planu (`_restore_reservations`), a dopiero potem waliduje.
 *
 * Front musi liczyć tak samo jak backend: oddać do puli to, co i tak zostanie
 * zwolnione. Zwalniane są WYŁĄCZNIE pozycje edytowalne (`qtyDone === 0`) —
 * pozycje rozpoczęte są zamrożone i backend trzyma ich rezerwacje nietknięte
 * (`skip_line_ids=produced_ids`), więc ich kg do puli NIE wracają.
 *
 * Lustro backendowego `_allocation_kg_per_batch`: klucze wewnątrz
 * `batchAllocation` to surowy JSONB (snake_case), a kg sztuk mieszanych (PM)
 * siedzą w kubełku `parts`.
 */

export interface PlanLineAllocLite {
  qtyDone?:         number
  batchAllocation?: Record<string, any> | null
}

export interface SeasonedBatchLite {
  id:           string
  kgFree?:      number
  kgAvailable?: number
}

/** Suma kg per `batch_id` trzymana przez edytowalne pozycje planu. */
export function ownReservedByBatch(
  lines: PlanLineAllocLite[] | undefined | null,
): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (bid: unknown, kg: unknown) => {
    const kgNum = Number(kg ?? 0)
    if (typeof bid !== 'string' || !bid || !(kgNum > 0)) return
    out[bid] = (out[bid] ?? 0) + kgNum
  }

  for (const line of lines ?? []) {
    // Pozycja rozpoczęta = zamrożona; backend nie zwalnia jej rezerwacji.
    if (Number(line?.qtyDone ?? 0) > 0) continue
    const ba = line?.batchAllocation
    if (!ba || typeof ba !== 'object') continue

    for (const alloc of Object.values(ba)) {
      if (!alloc || typeof alloc !== 'object') continue
      const parts = (alloc as any).parts
      if (parts && typeof parts === 'object') {
        for (const p of Object.values(parts as Record<string, any>)) {
          if (p && typeof p === 'object') add(p.batch_id, p.kg)
        }
      } else {
        add((alloc as any).batch_id, (alloc as any).kg)
      }
    }
  }
  return out
}

/**
 * Partie przyprawionego z `kgFree` powiększonym o rezerwacje edytowanego planu.
 * Sufit to `kgAvailable` — rezerwacja nie tworzy mięsa, tylko je blokuje.
 * Bez `lines` (tworzenie nowego planu) zwraca wejście bez zmian.
 */
export function withOwnReservations<T extends SeasonedBatchLite>(
  seasoned: T[] | undefined | null,
  lines: PlanLineAllocLite[] | undefined | null,
): T[] {
  const list = seasoned ?? []
  const own = ownReservedByBatch(lines)
  if (Object.keys(own).length === 0) return list

  return list.map(s => {
    const back = own[s.id] ?? 0
    if (back <= 0) return s
    const free = Number(s.kgFree ?? s.kgAvailable ?? 0)
    const cap  = Number(s.kgAvailable ?? s.kgFree ?? 0)
    return { ...s, kgFree: Math.min(free + back, cap) }
  })
}
