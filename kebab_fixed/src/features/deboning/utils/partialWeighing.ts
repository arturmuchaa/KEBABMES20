/**
 * partialWeighing.ts — decyzja po ZAPISZ w trybie domykania pobrania.
 *
 * Wariant „jeden przycisk + pytanie z %" (decyzja użytkownika 2026-07-18):
 * łączny % (zważone porcje + bieżąca) / pobrane >= 63 → domknij od razu;
 * poniżej → dialog „część czy całość?". 63 = dolna granica normy uzysku
 * 63–68% z hali. Świadome ryzyko: część o % w normie (200/300) domknie się
 * bez pytania — ratunkiem korekta z biura (POST /deboning/entries/{id}/correct).
 */
export const PARTIAL_ASK_BELOW_PCT = 63

export type TakeSaveDecision = 'block' | 'ask' | 'complete'

export function decideTakeSave(weighedKg: number, portionKg: number, takenKg: number): TakeSaveDecision {
  if (takenKg <= 0 || portionKg <= 0) return 'block'
  if (weighedKg + portionKg > takenKg) return 'block'
  const pct = ((weighedKg + portionKg) / takenKg) * 100
  return pct >= PARTIAL_ASK_BELOW_PCT ? 'complete' : 'ask'
}
