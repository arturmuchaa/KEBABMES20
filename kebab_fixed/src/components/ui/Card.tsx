import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect } from 'react'

// ── Card ───────────────────────────────────────────────────────
export function Card({ children, className, noPad }: {
  children: React.ReactNode; className?: string; noPad?: boolean
}) {
  return (
    <div className={cn(
      'bg-surface border border-surface-4 rounded-xl shadow-card',
      !noPad && 'p-4', className
    )}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-3 pb-3 border-b border-surface-4">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ── KPI card — colored accent bar, dark ────────────────────────
export function KpiCard({ label, value, unit, sub, accent = 'blue', className }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; accent?: string; className?: string
}) {
  const bar: Record<string, string> = {
    blue:  'bg-brand',
    green: 'bg-success',
    amber: 'bg-warn',
    red:   'bg-danger',
  }
  return (
    <div className={cn('bg-surface border border-surface-4 rounded-xl shadow-card p-4 flex items-stretch gap-0', className)}>
      <div className={cn('w-0.5 flex-shrink-0 mr-3.5 self-stretch rounded-full', bar[accent] ?? 'bg-brand')} />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-1">{label}</div>
        <div className="text-2xl font-bold text-ink leading-none tabular-nums">
          {value}
          {unit && <span className="text-sm font-medium text-ink-3 ml-1.5">{unit}</span>}
        </div>
        {sub && <div className="mt-1.5 text-[11px] text-ink-3">{sub}</div>}
      </div>
    </div>
  )
}

// ── Progress Bar ───────────────────────────────────────────────
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value))
  const color = pct >= 80 ? 'bg-success' : pct >= 40 ? 'bg-brand' : 'bg-warn'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-1 bg-surface-4 rounded-full overflow-hidden">
        <div className={cn('h-full transition-all rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-ink-4 w-7 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────
export function Modal({ open, onClose, title, subtitle, children, size = 'md', preventClose = false }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string
  children: React.ReactNode; size?: 'sm'|'md'|'lg'|'xl'; preventClose?: boolean
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget && !preventClose) onClose() }}
    >
      <div className={cn('bg-surface border border-surface-4 shadow-modal rounded-xl w-full max-h-[90vh] overflow-y-auto animate-slide-up scrollbar-thin', W)}>
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-surface-4">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          {!preventClose && (
            <button onClick={onClose} className="p-1 text-ink-4 hover:text-ink hover:bg-surface-3 rounded transition-colors ml-4">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
      </div>
    </div>
  )
}

// ── Toast (legacy — use sonner toast() instead for new code) ───
export function Toast({ message, type = 'info', visible }: {
  message: string; type?: 'success'|'error'|'info'; visible: boolean
}) {
  const bg = type === 'success' ? 'bg-success' : type === 'error' ? 'bg-danger' : 'bg-surface'
  return (
    <div className={cn(
      'fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 text-white text-[13px] font-medium shadow-modal rounded-xl border border-surface-4 transition-all duration-200',
      bg, visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
    )}>
      {message}
    </div>
  )
}

// ── Spinner ────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div className="animate-spin border-2 border-surface-4 border-t-brand rounded-full"
      style={{ width: size, height: size }} />
  )
}

// ── Skeleton ───────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-skeleton rounded-lg bg-surface-4/60', className)} />
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-surface border border-surface-4 rounded-xl p-4 space-y-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-0 divide-y divide-surface-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cn('h-4 rounded', j === 0 ? 'w-20' : j === cols - 1 ? 'w-16 ml-auto' : 'flex-1')} />
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
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {icon && <div className="text-ink-5 mb-3 opacity-30">{icon}</div>}
      <h3 className="text-[13px] font-medium text-ink-3 mb-1">{title}</h3>
      {message && <p className="text-xs text-ink-4 mb-4 max-w-xs">{message}</p>}
      {action}
    </div>
  )
}
