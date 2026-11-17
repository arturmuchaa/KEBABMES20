/**
 * planShortfalls — strażnik braków mięsa przed zapisem planu.
 *
 * Powód istnienia: plan zapisany z niedoborem dostaje numer PP-… i częściowo
 * rezerwuje magazyn, a hala i tak nie ma z czego produkować. To lustro
 * backendowego `_check_plan_shortfalls`, liczone PRZED wysłaniem — żeby
 * odmowa przyszła z konkretem, a nie jako 400 z serwera.
 *
 * Dwie ścieżki, bo dwa rodzaje receptur:
 *  • zwykła — sprawdzamy, czy z ZAZNACZONYCH partii wychodzi tyle sztuk,
 *    ile pozycja zamawia (całe sztuki z jednej partii — patrz
 *    planMeatAllocation);
 *  • komponentowa (95/5) — ta sama alokacja sprawdza udział każdego składnika.
 *
 * Zero importów z React/UI — testowane w node.
 */
import { num, type PlanLine } from './planLineModel'
import type { PlanAllocation } from './planMeatAllocation'
import { lineComponents, type CompositionCatalog } from './planComponents'

export interface RecipeComponentLite {
  materialTypeId: string
  materialName:   string
  pct:            number
}

interface RecipeLite {
  id:          string
  name?:       string
  components?: RecipeComponentLite[]
}

export interface SeasonedForCheck {
  materialTypeId?: string
  kgFree?:         number
  kgAvailable?:    number
}

/**
 * Lista braków gotowa do pokazania planiście. Pusta = plan da się zapisać.
 *
 * `toProduction` zaostrza regułę: szkic wolno zostawić bez przydzielonych
 * partii (planista dokończy jutro), ale wysłanie na halę bez nich nie ma sensu.
 */
export function planShortfalls(
  lines: PlanLine[],
  _seasoned: SeasonedForCheck[],
  recipes: RecipeLite[],
  alloc: PlanAllocation,
  toProduction: boolean,
  catalog?: CompositionCatalog,
): string[] {
  const out: string[] = []

  lines.forEach((l, idx) => {
    const qty  = num(l.qty)
    const kgPu = num(l.kgPerUnit)
    if (!l.recipeId || qty <= 0 || kgPu <= 0 || num(l.qtyDone) > 0) return

    const receptura = recipes.find(r => r.id === l.recipeId)
    const nazwa = receptura?.name ?? l.recipeId
    const comps = lineComponents(l, catalog ?? { recipes })

    const ids = l.seasonedBatchIds.length > 0
      ? l.seasonedBatchIds
      : (l.seasonedBatchId ? [l.seasonedBatchId] : [])
    if (ids.length === 0) {
      if (toProduction) out.push(`„${nazwa}": brak przydzielonych partii mięsa`)
      return
    }

    const la = alloc.lines[idx]
    if (la && !la.ok) {
      const composition = comps.length
        ? `skład ${comps.map(c => `${c.materialName || c.materialTypeId} ${c.pct}%`).join(' / ')} — ` : ''
      out.push(
        `„${nazwa}": ${composition}z zaznaczonych partii wychodzi ${la.pieces} z ${la.qty} szt — `
        + `brakuje ${la.missingPieces} szt (${la.missingKg.toFixed(0)} kg). `
        + 'Dołóż kolejną partię.',
      )
    }
  })

  return out
}
