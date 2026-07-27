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

/** Pasmo normy uzysku, względem którego operator rozlicza POBRANIE (nie to samo
 * co progi kolorów wydajności dnia na HMI). Steruje wyłącznie paskiem postępu:
 * ile jeszcze mięsa „powinno" wyjść z tej ćwiartki. Próg pytania „część czy
 * całość?" zostaje osobno na PARTIAL_ASK_BELOW_PCT — obniżenie/podniesienie
 * normy nie może przypadkiem zmienić logiki domykania pobrania. */
export const YIELD_NORM_PCT = { lo: 64, hi: 68 } as const

export interface TakeProgress {
  /** Pobranie, względem którego liczy się cały pasek [kg]. */
  takenKg: number
  /** Zapisane wcześniej porcje [kg]. */
  weighedKg: number
  /** Porcja aktualnie na wadze, jeszcze niezapisana [kg]. */
  portionKg: number
  /** Razem = zapisane + bieżąca porcja [kg]. */
  totalKg: number
  /** Razem jako % pobrania. */
  pct: number
  /** Same zapisane porcje jako % pobrania (ciemna część paska). */
  weighedPct: number
  normLoKg: number
  normHiKg: number
  /** Ile kg brakuje do DOLNEJ granicy normy (0 gdy już w paśmie/powyżej). */
  missingToNormKg: number
  /** To samo w punktach procentowych. */
  missingToNormPct: number
  status: 'below' | 'norm' | 'above'
}

/** Postęp ważenia dzielonego jednego pobrania — operator waży mięso porcjami
 * (wózek po wózku) i między porcjami traci rachubę, ile już zważył i ile
 * jeszcze „powinno" wyjść. Liczy sumę narastającą razem z porcją stojącą na
 * wadze, żeby pasek reagował JESZCZE PRZED zapisem. */
export function takeProgress(
  weighedKg: number, portionKg: number, takenKg: number,
): TakeProgress | null {
  if (!(takenKg > 0)) return null
  const weighed = Math.max(0, weighedKg || 0)
  const portion = Math.max(0, portionKg || 0)
  const total = weighed + portion
  const normLoKg = round1(takenKg * YIELD_NORM_PCT.lo / 100)
  const normHiKg = round1(takenKg * YIELD_NORM_PCT.hi / 100)
  const pct = (total / takenKg) * 100
  return {
    takenKg,
    weighedKg: weighed,
    portionKg: portion,
    totalKg: round1(total),
    pct,
    weighedPct: (weighed / takenKg) * 100,
    normLoKg,
    normHiKg,
    missingToNormKg: Math.max(0, round1(normLoKg - total)),
    missingToNormPct: Math.max(0, YIELD_NORM_PCT.lo - pct),
    status: pct < YIELD_NORM_PCT.lo ? 'below' : pct > YIELD_NORM_PCT.hi ? 'above' : 'norm',
  }
}

function round1(kg: number): number {
  return Math.round(kg * 10) / 10
}

export type TakeSaveDecision = 'block' | 'ask' | 'complete'

export function decideTakeSave(weighedKg: number, portionKg: number, takenKg: number): TakeSaveDecision {
  if (takenKg <= 0 || portionKg <= 0) return 'block'
  if (weighedKg + portionKg > takenKg) return 'block'
  const pct = ((weighedKg + portionKg) / takenKg) * 100
  return pct >= PARTIAL_ASK_BELOW_PCT ? 'complete' : 'ask'
}
