/**
 * weighing.ts — czysta matematyka ważenia automatycznego (HMI rozbiór v10).
 *
 * Wózek z pojemnikami E2 wjeżdża na wagę najazdową; netto mięsa =
 * brutto − tara wózka − n × tara E2. Pasmo 15–25 kg mięsa na pojemnik to
 * kontrola wiarygodności (najczęstszy błąd operatora: źle policzone E2) —
 * ostrzeżenie, nie blokada.
 */

export const E2_TARE_KG = 2.0
/** Cztery fizyczne typy wózków na hali — tary potwierdzone przez użytkownika. */
export const CART_TARES_KG: readonly number[] = [5.5, 6.0, 6.5, 7.0]
export const KG_PER_E2_MIN = 15
export const KG_PER_E2_MAX = 25

export interface WeighingInput {
  gross: number
  cartTareKg: number | null
  e2Count: number
}

export interface WeighingResult {
  tareE2Kg: number
  tareTotalKg: number
  netKg: number
  kgPerContainer: number
  plausible: boolean
  /** true = jest sensowne netto do zapisania (tara wybrana i brutto > tara) */
  ready: boolean
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function computeWeighing({ gross, cartTareKg, e2Count }: WeighingInput): WeighingResult {
  const taraSet = cartTareKg != null && e2Count > 0
  const tareE2Kg = round1(e2Count * E2_TARE_KG)
  const tareTotalKg = taraSet ? round1((cartTareKg as number) + tareE2Kg) : 0
  const netKg = taraSet && gross > tareTotalKg ? round1(gross - tareTotalKg) : 0
  const kgPerContainer = netKg > 0 && e2Count > 0 ? netKg / e2Count : 0
  const plausible = kgPerContainer >= KG_PER_E2_MIN && kgPerContainer <= KG_PER_E2_MAX
  return { tareE2Kg, tareTotalKg, netKg, kgPerContainer, plausible, ready: netKg > 0 }
}
