import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

// ─── Formatowanie ─────────────────────────────────────────────
export const fmtKg = (n: number | string, d = 2): string => {
  const num = Number(n)
  const fixed = num.toFixed(d)
  if (num >= 10000) {
    const [int, dec] = fixed.split('.')
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
    return dec !== undefined ? `${grouped},${dec}` : grouped
  }
  return fixed.replace('.', ',')
}
export const fmtPct    = (n: number | string, d = 2) => Number(n).toFixed(d).replace('.', ',') + '%'
export const fmtDate   = (d?: string) => d ? d.slice(0, 10) : '—'
export const fmtDatePl = (d?: string) => { if (!d) return '—'; const [y,m,day] = d.slice(0,10).split('-'); return `${day}.${m}.${y}` }
export const fmtPln    = (n: number | string) => Number(n).toLocaleString('pl-PL', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' zł'
export const todayIso  = () => new Date().toISOString().slice(0, 10)

// ─── Kalkulacje rozbioru ──────────────────────────────────────
export interface DeboningCalc { kgRemainder: number; kgBones: number; kgBacks: number; yieldPct: number }
const BONES_RATIO = 0.6
const BACKS_RATIO = 0.4
export function calcDeboning(kgTaken: number, kgMeat: number): DeboningCalc {
  const kgRemainder = kgTaken - kgMeat
  return {
    kgRemainder,
    kgBones:  kgRemainder * BONES_RATIO,
    kgBacks:  kgRemainder * BACKS_RATIO,
    yieldPct: kgTaken > 0 ? (kgMeat / kgTaken) * 100 : 0,
  }
}

// ─── Re-eksport z fefo.ts (jedyne źródło prawdy o logice FEFO) ──
export {
  sortFefo, getExpiryStatus, checkUsability,
  deriveRawBatchStatus, isUsableForProduction,
} from './utils/fefo'
export type {
  FefoSortable, ExpiryLevel, ExpiryStatus,
  UsabilityResult, UnusableReason, RawBatchDerivedStatus,
} from './utils/fefo'

// ─── ExpiryUi — mapping ExpiryLevel → klasy CSS ──────────────
import type { ExpiryLevel } from './utils/fefo'

export interface ExpiryUiMeta {
  label:     string
  textCls:   string
  bgCls:     string
  borderCls: string
}

export function getExpiryUi(level: ExpiryLevel, daysLeft: number): ExpiryUiMeta {
  switch (level) {
    case 'EXPIRED':  return { label: 'Wygasła',
      textCls: 'text-red-400', bgCls: 'bg-red-500/10', borderCls: 'border-red-500/30' }
    case 'CRITICAL': return { label: daysLeft === 0 ? 'Wygasa dziś' : 'Jutro',
      textCls: 'text-red-400', bgCls: 'bg-red-500/10', borderCls: 'border-red-500/30' }
    case 'WARNING':  return { label: `Za ${daysLeft} dni`,
      textCls: 'text-amber-400', bgCls: 'bg-amber-500/10', borderCls: 'border-amber-500/30' }
    case 'OK':       return { label: `${daysLeft}d`,
      textCls: 'text-green-400', bgCls: 'bg-green-500/10', borderCls: 'border-green-500/30' }
  }
}
