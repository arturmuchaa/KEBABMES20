/**
 * Bramka wagi przypraw.
 *
 * Odczyt musi zgadzać się z recepturą w tolerancji 0,05 kg i dopiero wtedy
 * panel puszcza dalej — automatycznie, bez dotyku. Waga sprawdza operatora,
 * bo pomyłki w przyprawach nie widać już po zamknięciu pokrywy masownicy.
 */
import { TOL_SPICE_KG } from './machines'

export interface RecipeIngredient {
  ingredientName: string
  qtyPer100kg: number
  unit: string
}

export interface SpiceItem {
  seq: number
  name: string
  unit: string
  qty: number
}

export function spiceVerdict(target: number, reading: number): 'low' | 'ok' | 'over' {
  const diff = Math.round((reading - target) * 1000) / 1000
  if (diff > TOL_SPICE_KG) return 'over'
  if (diff < -TOL_SPICE_KG) return 'low'
  return 'ok'
}

/** Składniki do odważenia na dany wsad, w kolejności receptury (`seq`).
 *
 *  Woda odpada: nie idzie przez wagę, dozuje ją DW-1C przy maszynie — a do
 *  pojemnika i tak nikt by jej nie nalał z wyprzedzeniem. */
export function scaleIngredients(recipe: RecipeIngredient[], kgBatch: number): SpiceItem[] {
  return recipe
    .filter(i => i.unit !== 'L')
    .map((i, seq) => ({
      seq,
      name: i.ingredientName,
      unit: i.unit,
      qty: Math.round((i.qtyPer100kg * kgBatch) / 100 * 1000) / 1000,
    }))
}

/** Litry wody na wskazany wsad — zadawane dozownikiem przy maszynie. */
export function waterOf(recipe: RecipeIngredient[], kgBatch: number): number {
  const woda = recipe.filter(i => i.unit === 'L')
    .reduce((s, i) => s + (i.qtyPer100kg * kgBatch) / 100, 0)
  return Math.round(woda * 10) / 10
}
