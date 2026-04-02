import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect } from 'react'

// ── Spinner ────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div className="animate-spin border-2 border-surface-4 border-t-brand"
      style={{ width: size, height: size, borderRadius: '50%' }} />
  )
}

// ── Toast ──────────────────────────────────────────────────────
export function Toast({ message, type = 'info', visible }: {
  message: string; type?: 'success'|'error'|'info'; visible: boolean
}) {
  const bg = type === 'success' ? 'bg-green-700' : type === 'error' ? 'bg-red-700' : 'bg-gray-800'
  return (
    <div className={cn(
      'fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 text-white text-[13px] font-medium shadow-md transition-all duration-200',
      bg, visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
    )}>
      {message}
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────
export function EmptyState({ icon, title, message, action }: {
  icon?: React.ReactNode; title: string; message?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-ink-5 mb-3 opacity-40">{icon}</div>}
      <h3 className="text-[13px] font-medium text-ink-3 mb-1">{title}</h3>
      {message && <p className="text-xs text-ink-4 mb-4 max-w-xs">{message}</p>}
      {action}
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget && !preventClose) onClose() }}
    >
      <div className={cn('bg-white shadow-modal w-full max-h-[90vh] overflow-y-auto animate-slide-up', W)}>
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-surface-4">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          {!preventClose && (
            <button onClick={onClose} className="p-1 text-ink-4 hover:text-ink ml-4">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
      </div>
    </div>
  )
}

// ── KpiCard ────────────────────────────────────────────────────
export function KpiCard({ label, value, unit, sub, accent = 'blue', className }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; accent?: string; className?: string
}) {
  const bar: Record<string, string> = {
    blue: 'bg-brand', green: 'bg-success', amber: 'bg-warn', red: 'bg-danger',
  }
  return (
    <div className={cn('bg-white border border-surface-4 shadow-card p-3 flex items-stretch gap-0', className)}>
      <div className={cn('w-0.5 flex-shrink-0 mr-3 self-stretch', bar[accent] ?? 'bg-brand')} />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">{label}</div>
        <div className="text-xl font-bold text-ink leading-none tabular-nums">
          {value}
          {unit && <span className="text-xs font-medium text-ink-3 ml-1">{unit}</span>}
        </div>
        {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
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
      <div className="flex-1 h-1 bg-surface-3 overflow-hidden">
        <div className={cn('h-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-ink-4 w-7 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}
