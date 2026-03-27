import { cn } from '@/lib/utils'
import { getExpiryStatus, getExpiryUi, deriveRawBatchStatus } from '@/lib/utils'

export type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple' | 'orange'

// Dark-bg badge variants — semi-transparent tinted fills
const V: Record<BadgeVariant, string> = {
  blue:   'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/25',
  green:  'bg-green-500/15 text-green-400 ring-1 ring-green-500/25',
  amber:  'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25',
  red:    'bg-red-500/15 text-red-400 ring-1 ring-red-500/25',
  gray:   'bg-surface-4 text-ink-3 ring-1 ring-surface-5',
  purple: 'bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/25',
  orange: 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/25',
}

interface BadgeProps { variant?: BadgeVariant; children: React.ReactNode; dot?: boolean; className?: string }

export function Badge({ variant = 'gray', children, dot, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold',
      V[variant], className
    )}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0 animate-pulse-dot" />}
      {children}
    </span>
  )
}

// ─── ExpiryBadge — FEFO status daty ──────────────────────────
export function ExpiryBadge({ dateStr, compact }: { dateStr: string; compact?: boolean }) {
  const { level, daysLeft } = getExpiryStatus(dateStr)
  const { label } = getExpiryUi(level, daysLeft)
  const variant: BadgeVariant =
    level === 'EXPIRED' || level === 'CRITICAL' ? 'red'
    : level === 'WARNING' ? 'amber'
    : 'green'
  const text = compact ? label : daysLeft < 0 ? 'Wygasła' : `${label}`
  return <Badge variant={variant}>{text}</Badge>
}

// ─── StatusBadge — status partii ─────────────────────────────
const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  active:     { label: 'OK',          variant: 'green' },
  low_expiry: { label: 'LOW',         variant: 'amber' },
  expired:    { label: 'CRITICAL',    variant: 'red'   },
  used:       { label: 'USED',        variant: 'gray'  },
  cancelled:  { label: 'CANCELLED',   variant: 'gray'  },
  // legacy
  AVAILABLE:      { label: 'OK',        variant: 'green' },
  PARTIALLY_USED: { label: 'LOW',       variant: 'amber' },
  DEPLETED:       { label: 'USED',      variant: 'gray'  },
  QUARANTINE:     { label: 'CRITICAL',  variant: 'red'   },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? { label: status, variant: 'gray' as BadgeVariant }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

// computeDisplayStatus — spójność z resztą kodu
export function computeDisplayStatus(expiryDate: string, kgAvailable: number): string {
  return deriveRawBatchStatus(expiryDate, kgAvailable)
}
