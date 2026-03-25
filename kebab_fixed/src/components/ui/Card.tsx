import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect } from 'react'

// ── Card ───────────────────────────────────────────────────────
export function Card({ children, className, noPad }: {
  children: React.ReactNode; className?: string; noPad?: boolean
}) {
  return (
    <div className={cn(
      'bg-white border border-surface-4 shadow-card rounded-lg',
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
    <div className="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-surface-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-4 mt-0.5 font-normal">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ── KPI kompaktowe ─────────────────────────────────────────────
export function KpiCard({ label, value, unit, sub, accent = 'blue', className }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; accent?: string; className?: string
}) {
  const bar: Record<string, string> = {
    blue: 'bg-brand', green: 'bg-success', amber: 'bg-warn', red: 'bg-danger',
  }
  return (
    <div className={cn('bg-white border border-surface-4 shadow-card rounded-lg p-4 flex items-stretch gap-0', className)}>
      <div className={cn('w-1 flex-shrink-0 mr-3.5 self-stretch rounded-full', bar[accent] ?? 'bg-brand')} />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">{label}</div>
        <div className="text-2xl font-bold text-ink leading-none tabular-nums">
          {value}
          {unit && <span className="text-sm font-medium text-ink-4 ml-1.5">{unit}</span>}
        </div>
        {sub && <div className="mt-1 text-xs text-ink-4">{sub}</div>}
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
      <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className={cn('h-full transition-all rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-ink-4 w-8 text-right">{pct.toFixed(0)}%</span>
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget && !preventClose) onClose() }}
    >
      <div className={cn('bg-white shadow-modal rounded-xl w-full max-h-[90vh] overflow-y-auto animate-slide-up', W)}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-surface-3">
          <div>
            <h3 className="text-md font-semibold text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-ink-4 mt-0.5">{subtitle}</p>}
          </div>
          {!preventClose && (
            <button onClick={onClose} className="p-1.5 rounded-md text-ink-4 hover:text-ink hover:bg-surface-3 transition-colors ml-4">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

// ── Toast ──────────────────────────────────────────────────────
export function Toast({ message, type = 'info', visible }: {
  message: string; type?: 'success'|'error'|'info'; visible: boolean
}) {
  const styles = {
    success: 'bg-success text-white',
    error:   'bg-danger text-white',
    info:    'bg-ink text-white',
  }
  return (
    <div className={cn(
      'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-2.5 text-sm font-medium shadow-md rounded-lg transition-all duration-200',
      styles[type], visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
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

// ── Empty State ────────────────────────────────────────────────
export function EmptyState({ icon, title, message, action }: {
  icon?: React.ReactNode; title: string; message?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {icon && <div className="text-ink-5 mb-4 opacity-30">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink-3 mb-1">{title}</h3>
      {message && <p className="text-xs text-ink-4 mb-5 max-w-xs leading-relaxed">{message}</p>}
      {action}
    </div>
  )
}
