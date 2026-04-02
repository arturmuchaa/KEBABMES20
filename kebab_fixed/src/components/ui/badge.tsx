import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { getExpiryStatus, getExpiryUi, deriveRawBatchStatus } from '@/lib/utils'

// ─── shadcn Badge (CVA) ───────────────────────────────────────
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:     "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:   "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline:     "text-foreground",
        success:     "border-transparent bg-green-100 text-green-700 hover:bg-green-200",
        warning:     "border-transparent bg-amber-100 text-amber-700 hover:bg-amber-200",
        danger:      "border-transparent bg-red-100 text-red-700 hover:bg-red-200",
        info:        "border-transparent bg-blue-100 text-blue-700 hover:bg-blue-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

// ─── Custom mini-tag (used internally by ExpiryBadge / StatusBadge) ──────────
export type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple' | 'orange'

const V: Record<BadgeVariant, string> = {
  blue:   'bg-blue-100 text-blue-700',
  green:  'bg-green-100 text-green-700',
  amber:  'bg-amber-100 text-amber-700',
  red:    'bg-red-100 text-red-700',
  gray:   'bg-gray-100 text-gray-600',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
}

interface MiniTagProps { variant?: BadgeVariant; children: React.ReactNode; dot?: boolean; className?: string }

function MiniTag({ variant = 'gray', children, dot, className }: MiniTagProps) {
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

// ─── ExpiryBadge ─────────────────────────────────────────────
export function ExpiryBadge({ dateStr, compact }: { dateStr: string; compact?: boolean }) {
  const { level, daysLeft } = getExpiryStatus(dateStr)
  const { label } = getExpiryUi(level, daysLeft)
  const variant: BadgeVariant =
    level === 'EXPIRED' || level === 'CRITICAL' ? 'red'
    : level === 'WARNING' ? 'amber'
    : 'green'
  const text = compact ? label : daysLeft < 0 ? 'Wygasła' : `${label}`
  return <MiniTag variant={variant}>{text}</MiniTag>
}

// ─── StatusBadge ─────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  active:          { label: 'OK',        variant: 'green' },
  low_expiry:      { label: 'LOW',       variant: 'amber' },
  expired:         { label: 'CRITICAL',  variant: 'red'   },
  used:            { label: 'USED',      variant: 'gray'  },
  cancelled:       { label: 'CANCELLED', variant: 'gray'  },
  AVAILABLE:       { label: 'OK',        variant: 'green' },
  PARTIALLY_USED:  { label: 'LOW',       variant: 'amber' },
  DEPLETED:        { label: 'USED',      variant: 'gray'  },
  QUARANTINE:      { label: 'CRITICAL',  variant: 'red'   },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? { label: status, variant: 'gray' as BadgeVariant }
  return <MiniTag variant={s.variant}>{s.label}</MiniTag>
}

// ─── computeDisplayStatus ────────────────────────────────────
export function computeDisplayStatus(expiryDate: string, kgAvailable: number): string {
  return deriveRawBatchStatus(expiryDate, kgAvailable)
}
