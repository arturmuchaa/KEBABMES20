/**
 * Stałe masowni potwierdzone przez halę (2026-08-27).
 */

export const MACHINES: { id: 1 | 2 | 3; cap: number }[] = [
  { id: 1, cap: 200 },
  { id: 2, cap: 200 },
  { id: 3, cap: 600 },
]

/** Minuty masowania — tyle trzyma blokada maszyny w MES. */
export const T_MIX_MIN = 50

/** Ile kg system po cichu przepuści ponad nominalny wsad.
 *  NIGDY nie pokazywane na ekranie: zdarza się wrzucić 630 kg do trójki, ale
 *  wypisanie „max 660" zrobiłoby z zapasu normę. Operator widzi 200 i 600. */
export const OVER_KG = 60

/** Tolerancja wagi przypraw — działka wagi masowni. */
export const TOL_SPICE_KG = 0.05

export function fitsMachine(kg: number, cap: number): boolean {
  return kg <= cap + OVER_KG + 1e-9
}

/** Okno dozownika DW-1C: dokładność ±3% wg producenta, węższe okno zgłaszałoby
 *  błąd, którego urządzenie i tak nie potrafi uniknąć. Minimum 0,5 L, bo
 *  działka bywa 0,1 albo 1 L. */
export function waterWindow(targetL: number): { min: number; max: number } {
  const tol = Math.max(0.5, Math.round(targetL * 0.03 * 10) / 10)
  return { min: Math.round((targetL - tol) * 10) / 10, max: Math.round((targetL + tol) * 10) / 10 }
}

/** Tożsamość partii przyprawionej: jeden wsad surowca → partia nosi jego numer
 *  (511 zostaje 511), dwa i więcej → wspólny PP{n}. Tak liczy backend
 *  (`seasoned_batch_no_from_raw`) — tu liczymy TO SAMO tylko po to, żeby
 *  pokazać numer operatorowi przed startem. */
export function batchNoFromLots(lotNos: string[], ppSeq: number): { no: string; mixed: boolean } {
  const rozne = [...new Set(lotNos.filter(Boolean))]
  if (rozne.length === 0) return { no: '', mixed: false }
  if (rozne.length === 1) return { no: rozne[0], mixed: false }
  return { no: `PP${ppSeq + 1}`, mixed: true }
}
