import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import CountAnimation from './CountAnimation'

// ── Trend badge ────────────────────────────────────────────────
interface TrendProps {
  value: number   // positive = up, negative = down, 0 = neutral
  label?: string
}

export function TrendBadge({ value, label }: TrendProps) {
  const up   = value > 0
  const down = value < 0
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md',
      up   && 'text-emerald-700 bg-emerald-50',
      down && 'text-red-600 bg-red-50',
      !up && !down && 'text-slate-500 bg-slate-100',
    )}>
      {up   && <TrendingUp  size={10} />}
      {down && <TrendingDown size={10} />}
      {!up && !down && <Minus size={10} />}
      {up ? '+' : ''}{value.toFixed(1)}%
      {label && <span className="font-normal text-[10px] opacity-70">{label}</span>}
    </span>
  )
}

// ── Icon accent colours ────────────────────────────────────────
const ICON_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    ring: 'ring-blue-100' },
  green:   { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100' },
  red:     { bg: 'bg-red-50',     text: 'text-red-600',     ring: 'ring-red-100' },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600',  ring: 'ring-violet-100' },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     ring: 'ring-sky-100' },
}

// ── StatCard ───────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: number | string
  unit?: string
  sub?: React.ReactNode
  accent?: keyof typeof ICON_STYLES
  icon?: React.ReactNode
  trend?: number
  trendLabel?: string
  animate?: boolean
  className?: string
  footer?: React.ReactNode
}

export function StatCard({
  label,
  value,
  unit,
  sub,
  accent = 'blue',
  icon,
  trend,
  trendLabel,
  animate: doAnimate = true,
  className,
  footer,
}: StatCardProps) {
  const { bg, text, ring } = ICON_STYLES[accent] ?? ICON_STYLES.blue
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0
  const isNumeric = typeof value === 'number' || (!isNaN(numericValue) && value !== '')

  return (
    <div className={cn(
      'group relative bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm',
      'hover:shadow-md hover:border-slate-300/60 transition-all duration-200',
      className,
    )}>
      {/* Top row: label + icon */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-widest text-slate-400 leading-tight">
          {label}
        </p>
        {icon && (
          <div className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
            'ring-1 transition-all duration-200',
            bg, text, ring,
            'group-hover:scale-105',
          )}>
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex items-end gap-2 mb-1.5">
        <div className="text-[30px] font-bold text-slate-900 leading-none tabular-nums">
          {isNumeric && doAnimate
            ? <CountAnimation number={numericValue} />
            : <span>{typeof value === 'number' ? value.toLocaleString('pl-PL') : value}</span>
          }
        </div>
        {unit && (
          <span className="text-[14px] font-medium text-slate-400 mb-0.5 leading-none">{unit}</span>
        )}
      </div>

      {/* Sub text + trend */}
      <div className="flex items-center gap-2 flex-wrap min-h-[18px]">
        {sub && (
          <span className="text-[11.5px] text-slate-400">{sub}</span>
        )}
        {trend !== undefined && (
          <TrendBadge value={trend} label={trendLabel} />
        )}
      </div>

      {/* Optional footer */}
      {footer && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          {footer}
        </div>
      )}
    </div>
  )
}

// ── Skeleton for StatCard ──────────────────────────────────────
export function StatCardSkeleton() {
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between">
        <div className="h-3 w-24 bg-slate-100 rounded-full animate-skeleton" />
        <div className="w-9 h-9 bg-slate-100 rounded-xl animate-skeleton" />
      </div>
      <div className="h-8 w-32 bg-slate-100 rounded-lg animate-skeleton" />
      <div className="h-3 w-20 bg-slate-100 rounded-full animate-skeleton" />
    </div>
  )
}
