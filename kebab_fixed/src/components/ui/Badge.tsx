import { cn } from '@/lib/utils'
import { getExpiryStatus, getExpiryUi, deriveRawBatchStatus } from '@/lib/utils'

export type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple' | 'orange'

// Light-mode badge variants — colored fills with matching text
const V: Record<BadgeVariant, string> = {
  blue:   'bg-blue-50   text-blue-700   ring-1 ring-blue-200',
  green:  'bg-green-50  text-green-700  ring-1 ring-green-200',
  amber:  'bg-amber-50  text-amber-700  ring-1 ring-amber-200',
  red:    'bg-red-50    text-red-700    ring-1 ring-red-200',
  gray:   'bg-slate-100 text-slate-600  ring-1 ring-slate-200',
  purple: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  orange: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
}

interface BadgeProps { variant?: BadgeVariant; children: React.ReactNode; dot?: boolean; className?: string }

export function Badge({ variant = 'gray', children, dot, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold',
      V[variant], className
    )}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />}
      {children}
    </span>
  )
}

// ─── ExpiryBadge — FEFO ───────────────────────────────────────
export function ExpiryBadge({ dateStr, compact }: { dateStr: string; compact?: boolean }) {
  const { level, daysLeft } = getExpiryStatus(dateStr)
  const { label } = getExpiryUi(level, daysLeft)
  const variant: BadgeVariant =
    level === 'EXPIRED' || level === 'CRITICAL' ? 'red'
    : level === 'WARNING' ? 'amber'
    : 'green'
  const text = compact ? label : daysLeft < 0 ? 'Wygasła' : label
  return <Badge variant={variant}>{text}</Badge>
}

// ─── StatusBadge ──────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  active:         { label: 'OK',          variant: 'green'  },
  low_expiry:     { label: 'LOW',         variant: 'amber'  },
  expired:        { label: 'CRITICAL',    variant: 'red'    },
  used:           { label: 'USED',        variant: 'gray'   },
  cancelled:      { label: 'CANCELLED',   variant: 'gray'   },
  AVAILABLE:      { label: 'OK',          variant: 'green'  },
  PARTIALLY_USED: { label: 'LOW',         variant: 'amber'  },
  DEPLETED:       { label: 'USED',        variant: 'gray'   },
  QUARANTINE:     { label: 'CRITICAL',    variant: 'red'    },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? { label: status, variant: 'gray' as BadgeVariant }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function computeDisplayStatus(expiryDate: string, kgAvailable: number): string {
  return deriveRawBatchStatus(expiryDate, kgAvailable)
}
