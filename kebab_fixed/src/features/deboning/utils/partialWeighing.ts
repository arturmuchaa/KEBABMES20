/**
 * partialWeighing.ts — decyzja po ZAPISZ w trybie domykania pobrania.
 *
 * Wariant „jeden przycisk + pytanie z %" (decyzja użytkownika 2026-07-18,
 * próg obniżony do 62 dnia 2026-07-24): łączny % (zważone porcje + bieżąca)
 * / pobrane >= 62 → domknij od razu; poniżej → dialog „część czy całość?".
 * 62 = tuż pod dolną granicą normy uzysku 63–68% z hali. Świadome ryzyko:
 * część o % w normie (200/300) domknie się bez pytania — ratunkiem korekta
 * z biura (POST /deboning/entries/{id}/correct).
 */
export const PARTIAL_ASK_BELOW_PCT = 62

export type TakeSaveDecision = 'block' | 'ask' | 'complete'

export function decideTakeSave(weighedKg: number, portionKg: number, takenKg: number): TakeSaveDecision {
  if (takenKg <= 0 || portionKg <= 0) return 'block'
  if (weighedKg + portionKg > takenKg) return 'block'
  const pct = ((weighedKg + portionKg) / takenKg) * 100
  return pct >= PARTIAL_ASK_BELOW_PCT ? 'complete' : 'ask'
}
