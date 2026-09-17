/**
 * Stałe masowni potwierdzone przez halę (2026-08-27).
 */

/**
 * Masownice hali: `cap` to wsad STANDARDOWY, `max` to granica, powyżej której
 * maszyna już nie miesza.
 *
 * Na ekranie pokazujemy wyłącznie `cap`. Wypisany zapas zrobiłby z siebie
 * normę — operator widzi 200 i 600, a o granicy dowiaduje się dopiero wtedy,
 * gdy w nią uderzy, bo wtedy musi wiedzieć, ile zdjąć.
 */
export const MACHINES: { id: 1 | 2 | 3; cap: number; max: number }[] = [
  { id: 1, cap: 200, max: 250 },
  { id: 2, cap: 200, max: 250 },
  { id: 3, cap: 600, max: 700 },
]

export const maszyna = (id: number) => MACHINES.find(m => m.id === id) ?? null

/** O ile wolno przekroczyć dany wsad nominalny — `max` minus standard tej
 *  maszyny. Używane przy ważeniu przypraw, gdzie maszyny jeszcze nie ma. */
export function zapasNadNominalem(cap: number): number {
  const m = MACHINES.find(x => x.cap === cap)
  return m ? m.max - m.cap : 0
}

/** Minuty masowania — tyle trzyma blokada maszyny w MES. */
export const T_MIX_MIN = 50

/** Tolerancja wagi przypraw — działka wagi masowni. */
export const TOL_SPICE_KG = 0.05

/** Czy wsad wejdzie do TEJ masownicy. Ponad `max` blokujemy — przepełniona
 *  masownica nie miesza równo, a operator zauważa to dopiero po 50 minutach. */
export function fitsMachine(kg: number, machineId: number): boolean {
  const m = maszyna(machineId)
  return m ? kg <= m.max + 1e-9 : false
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
