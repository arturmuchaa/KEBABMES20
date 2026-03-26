import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'border-mes-border bg-mes-elevated text-slate-300',
        blue:        'border-blue-500/30 bg-blue-500/10 text-blue-400',
        green:       'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        amber:       'border-amber-500/30 bg-amber-500/10 text-amber-400',
        red:         'border-red-500/30 bg-red-500/10 text-red-400',
        cyan:        'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
        outline:     'border-mes-border bg-transparent text-slate-400',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

// ── Status-aware badge ────────────────────────────────────────
type StatusType = 'AVAILABLE' | 'RESERVED' | 'IN_PROCESS' | 'USED' | 'active' | 'cancelled' | 'done' | 'planned' | 'in_progress' | 'open' | 'closed' | 'approved'

const statusMap: Record<StatusType, { label: string; variant: BadgeProps['variant'] }> = {
  AVAILABLE:   { label: 'Dostępny',     variant: 'green' },
  RESERVED:    { label: 'Zarezerwowany',variant: 'amber' },
  IN_PROCESS:  { label: 'W trakcie',    variant: 'cyan'  },
  USED:        { label: 'Zużyty',       variant: 'default' },
  active:      { label: 'Aktywny',      variant: 'green' },
  cancelled:   { label: 'Anulowany',    variant: 'red'   },
  done:        { label: 'Gotowe',       variant: 'green' },
  planned:     { label: 'Planowane',    variant: 'blue'  },
  in_progress: { label: 'W trakcie',    variant: 'cyan'  },
  open:        { label: 'Otwarta',      variant: 'green' },
  closed:      { label: 'Zamknięta',    variant: 'amber' },
  approved:    { label: 'Zatwierdzona', variant: 'blue'  },
}

export function StatusBadge({ status }: { status: string }) {
  const s = statusMap[status as StatusType]
  if (!s) return <Badge variant="default">{status}</Badge>
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function ExpiryBadge({ expiryDate }: { expiryDate: string }) {
  const days = Math.floor((new Date(expiryDate).getTime() - Date.now()) / 86_400_000)
  if (days < 0)  return <Badge variant="red">PRZETERMINOWANE ({days}d)</Badge>
  if (days <= 1) return <Badge variant="red">KRYTYCZNE ({days}d)</Badge>
  if (days <= 3) return <Badge variant="amber">OSTRZEŻENIE ({days}d)</Badge>
  return <Badge variant="green">{days}d</Badge>
}

export { Badge, badgeVariants }
