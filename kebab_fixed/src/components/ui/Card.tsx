import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect } from 'react'

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, className, noPad }: {
  children: React.ReactNode; className?: string; noPad?: boolean
}) {
  return (
    <div className={cn(
      'bg-white border border-slate-200 rounded-xl shadow-card',
      !noPad && 'p-5', className
    )}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-100">
      <div>
        <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ── Page Header ────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-[20px] font-bold text-slate-900 leading-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ── Table wrapper — consistent clean table design ─────────────
export function DataTable({ header, children, empty }: {
  header: React.ReactNode
  children: React.ReactNode
  empty?: boolean
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-card">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        {header}
      </div>
      {empty ? children : (
        <div className="overflow-x-auto">
          {children}
        </div>
      )}
    </div>
  )
}

// ── KPI card — SS2 clean design ────────────────────────────────
const KPI_ICON_CLS: Record<string, string> = {
  blue:  'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red:   'bg-red-50 text-red-600',
}

export function KpiCard({ label, value, unit, sub, accent = 'blue', icon, className }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode
  accent?: string; icon?: React.ReactNode; className?: string
}) {
  const iconCls = KPI_ICON_CLS[accent] ?? KPI_ICON_CLS.blue
  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl shadow-card p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">{label}</p>
          <div className="text-[28px] font-bold text-slate-900 leading-none tabular-nums">
            {value}
            {unit && <span className="text-[15px] font-medium text-slate-400 ml-2">{unit}</span>}
          </div>
          {sub && <div className="mt-2 text-[11px] text-slate-400">{sub}</div>}
        </div>
        {icon && (
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', iconCls)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Progress Bar ───────────────────────────────────────────────
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value))
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-blue-500' : 'bg-amber-500'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn('h-full transition-all rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-slate-400 w-7 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────
export function Modal({ open, onClose, title, subtitle, children, size = 'md', preventClose = false }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string
  children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; preventClose?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !preventClose) onClose() }
    if (open) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, preventClose])

  if (!open) return null
  const W = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget && !preventClose) onClose() }}
    >
      <div className={cn(
        'bg-white border border-slate-200 shadow-modal rounded-xl w-full max-h-[90vh] overflow-y-auto animate-slide-up scrollbar-thin',
        W
      )}>
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {!preventClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors ml-4"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="px-5 py-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

// ── Toast (legacy — use sonner toast() for new code) ───────────
export function Toast({ message, type = 'info', visible }: {
  message: string; type?: 'success' | 'error' | 'info'; visible: boolean
}) {
  const style =
    type === 'success' ? 'bg-emerald-600 text-white' :
    type === 'error'   ? 'bg-red-600 text-white'  :
    'bg-slate-900 text-white'
  return (
    <div className={cn(
      'fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 text-[13px] font-medium',
      'shadow-modal rounded-xl border border-white/10 transition-all duration-200',
      style,
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
    )}>
      {message}
    </div>
  )
}

// ── Spinner ────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin border-2 border-slate-200 border-t-slate-900 rounded-full"
      style={{ width: size, height: size }}
    />
  )
}

// ── Skeleton ────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-skeleton rounded-lg bg-slate-100', className)} />
}

export function SkeletonCard() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-3.5 flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cn('h-4', j === 0 ? 'w-20' : j === cols - 1 ? 'w-16 ml-auto' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────
export function EmptyState({ icon, title, message, action }: {
  icon?: React.ReactNode; title: string; message?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-slate-300 mb-3">{icon}</div>}
      <h3 className="text-[13px] font-semibold text-slate-500 mb-1">{title}</h3>
      {message && <p className="text-[12px] text-slate-400 mb-4 max-w-xs">{message}</p>}
      {action}
    </div>
  )
}
