import type { DeboningEntry } from './types'

export type SettlementKind = 'meat' | 'backs' | 'bones'
export type SettlementStage = SettlementKind | 'balance' | 'done'
export const SETTLEMENT_LABEL: Record<SettlementKind, string> = {
  meat: 'Mięso', backs: 'Grzbiety', bones: 'Kości',
}
export const SETTLEMENT_STAGES: SettlementStage[] = ['meat', 'backs', 'bones', 'balance', 'done']

export interface SettlementMeasurement {
  requestId: string
  kind: SettlementKind
  kgNet: number
  kgGross?: number | null
  tareCartKg?: number | null
  tareE2Kg?: number | null
  e2Count?: number | null
  weighMode: 'auto' | 'manual'
  reason: string
}
export type SettlementInitial = Omit<SettlementMeasurement, 'requestId' | 'kind' | 'reason'>
export interface SettlementWeighing extends Omit<SettlementMeasurement, 'requestId'> {
  id: string
  weighedAt: string
}
export interface TakeSettlement extends DeboningEntry {
  mode: 'worker' | 'legacy'
  stage: SettlementStage
  meatKg: number
  backsKg: number
  bonesKg: number
  totalKg: number
  differenceKg: number
  balancePct: number
  /** Allowed excess / shortfall of the whole take (hall 2026-11-06: +1.5 % / −0.5 %). */
  tolerancePlusPct?: number
  toleranceMinusPct?: number
  /** Tolerance on the side of the difference (excess → plus, shortfall → minus). */
  tolerancePct: number
  toleranceKg: number
  minKg: number
  maxKg: number
  withinTolerance: boolean
  weighings: SettlementWeighing[]
}

/** Persist the operation BEFORE sending it. An uncertain write is retried with
 * the SAME id and body, including after a kiosk restart. Never guess success. */
export const settlementPendingKey = (id: string) => `mes:take-settlement:pending:${id}`
export interface PendingSettlementWrite {
  measurement: SettlementMeasurement
  correctingId?: string
}

/** "+1,5% / −0,5%" — older servers send one symmetric tolerance ("±1%"). */
export function toleranceLabel(s: Pick<TakeSettlement, 'tolerancePct' | 'tolerancePlusPct' | 'toleranceMinusPct'>) {
  const pct = (n: number) => `${String(n).replace('.', ',')}%`
  return s.tolerancePlusPct != null && s.toleranceMinusPct != null
    ? `+${pct(s.tolerancePlusPct)} / −${pct(s.toleranceMinusPct)}` : `±${pct(s.tolerancePct)}`
}
