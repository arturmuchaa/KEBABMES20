/**
 * Wspólny język wizualny kalkulatora zapotrzebowania na surowiec.
 * Każdy rodzaj surowca ma stały akcent kolorystyczny, żeby ćwiartka, mięso z/s
 * i filet były rozpoznawalne na pierwszy rzut oka we wszystkich widokach.
 */
import { fmtKg } from '@/lib/utils'

export const CWIARTKA = 'mat-cwiartka'

type Accent = { dot: string; text: string; soft: string }

const ACCENTS: Record<string, Accent> = {
  'mat-cwiartka':      { dot: 'bg-amber-500',   text: 'text-amber-700',   soft: 'bg-amber-50' },
  'mat-mieso-zs':      { dot: 'bg-rose-500',    text: 'text-rose-700',    soft: 'bg-rose-50' },
  'mat-filet-kurczak': { dot: 'bg-sky-500',     text: 'text-sky-700',     soft: 'bg-sky-50' },
  'mat-mieso-indyk':   { dot: 'bg-violet-500',  text: 'text-violet-700',  soft: 'bg-violet-50' },
}
const FALLBACK: Accent = { dot: 'bg-slate-400', text: 'text-slate-700', soft: 'bg-slate-50' }

export const accentOf = (rawTypeId: string): Accent => ACCENTS[rawTypeId] ?? FALLBACK

/** Liczba kg w spójnym formacie: pogrubiona wartość + wyciszona jednostka. */
export function Kg({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`}>
      <span className="font-bold">{fmtKg(value, 0)}</span>
      <span className="ml-0.5 text-[0.85em] font-normal text-muted-foreground">kg</span>
    </span>
  )
}

/** Kolorowy znacznik rodzaju surowca. */
export const Dot = ({ rawTypeId }: { rawTypeId: string }) => (
  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${accentOf(rawTypeId).dot}`} />
)
