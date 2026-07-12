/**
 * mixingSplit.ts — podział wyrobu masowania na partie źródłowe przy potwierdzaniu
 * bez HMI. Czyste funkcje (wejście/wyjście), testowalne bez UI.
 *
 * Zasada: operator robi pełne wsady z jednej partii, a niewypełnione resztki obu
 * partii łączy w JEDEN ostatni wsad → jedna partia mieszana „PP". Domyślna resztka
 * partii = kg mod 200 (600 to wielokrotność 200, więc układ wsadów nie zmienia
 * resztki). Partia mieszana powstaje tylko gdy ≥2 partie mają resztkę > 0.
 */
const LOAD = 200            // moduł wsadu (najmniejsza masownica)
const MAX_MIXED = 640       // największa masownica + zapas — próg ostrzeżenia
const EPS = 0.001

const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface SplitLotInput { meatLotId: string; lotNo: string; kgPlanned: number }
export interface SplitEntry { meatLotId: string; lotNo: string; kg: number }
export interface MixingSplit { pure: SplitEntry[]; mixed: SplitEntry[] }
export interface FinishBatch {
  kg: number
  lotAllocations: { meatLotId: string; kg: number }[]
}

/** Domyślna propozycja: resztka = kg mod 200; mieszana tylko gdy ≥2 partie z resztką. */
export function proposeMixingSplit(lots: SplitLotInput[]): MixingSplit {
  const rem: Record<string, number> = {}
  for (const l of lots) rem[l.meatLotId] = r3(l.kgPlanned - Math.floor(l.kgPlanned / LOAD) * LOAD)
  const withRem = lots.filter(l => rem[l.meatLotId] > EPS)
  const mixedByLot: Record<string, number> = {}
  if (withRem.length >= 2) for (const l of withRem) mixedByLot[l.meatLotId] = rem[l.meatLotId]
  return buildSplit(lots, mixedByLot)
}

/** Buduje split z jawnie podanych kg mieszanych per partia (reszta = czysta). */
export function buildSplit(
  lots: SplitLotInput[], mixedByLot: Record<string, number>,
): MixingSplit {
  const mixed: SplitEntry[] = []
  const pure: SplitEntry[] = []
  for (const l of lots) {
    const m = r3(mixedByLot[l.meatLotId] || 0)
    if (m > EPS) mixed.push({ meatLotId: l.meatLotId, lotNo: l.lotNo, kg: m })
    const p = r3(l.kgPlanned - m)
    if (p > EPS) pure.push({ meatLotId: l.meatLotId, lotNo: l.lotNo, kg: p })
  }
  return { pure, mixed }
}

export function validateMixingSplit(
  split: MixingSplit, lots: SplitLotInput[], meatKg: number,
): { ok: boolean; error?: string; warning?: string } {
  const mixedByLot: Record<string, number> = {}
  for (const m of split.mixed) mixedByLot[m.meatLotId] = m.kg
  for (const l of lots) {
    const m = mixedByLot[l.meatLotId] || 0
    if (m < -EPS) return { ok: false, error: `Ujemne kg mieszane dla partii ${l.lotNo}.` }
    if (m > l.kgPlanned + 0.5)
      return { ok: false, error: `Partia ${l.lotNo}: mieszane ${m} kg > dostępne ${l.kgPlanned} kg.` }
  }
  if (split.mixed.length === 1)
    return { ok: false, error: 'Partia mieszana musi zawierać co najmniej 2 partie surowca (albo wyzeruj mieszane).' }
  const total = [...split.pure, ...split.mixed].reduce((s, e) => s + e.kg, 0)
  if (Math.abs(total - meatKg) > 0.5)
    return { ok: false, error: `Suma podziału (${r3(total)} kg) ≠ mięso zlecenia (${meatKg} kg).` }
  const mixedTotal = split.mixed.reduce((s, e) => s + e.kg, 0)
  if (mixedTotal > MAX_MIXED)
    return { ok: true, warning: `Partia mieszana ${r3(mixedTotal)} kg > ${MAX_MIXED} kg — to więcej niż jeden wsad.` }
  return { ok: true }
}

/** Sekwencja sesji dla finishSession: czyste najpierw, mieszana OSTATNIA (domyka zlecenie). */
export function splitToBatches(split: MixingSplit): FinishBatch[] {
  const batches: FinishBatch[] = split.pure.map(p => ({
    kg: p.kg, lotAllocations: [{ meatLotId: p.meatLotId, kg: p.kg }],
  }))
  if (split.mixed.length > 0) {
    batches.push({
      kg: r3(split.mixed.reduce((s, e) => s + e.kg, 0)),
      lotAllocations: split.mixed.map(m => ({ meatLotId: m.meatLotId, kg: m.kg })),
    })
  }
  return batches
}
