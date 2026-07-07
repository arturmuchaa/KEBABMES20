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

// ─── StatusBadge (KANONICZNY system statusów całej aplikacji) ─────────────
// Jedno źródło prawdy dla statusów zleceń, produkcji, dokumentów i magazynu.
// Miękkie tony (50/200) + ikona = spójny, dopracowany wygląd wszędzie.
import {
  CheckCircle2, Clock3, CircleDashed, XCircle, FileEdit, FileCheck2, Send,
  type LucideIcon,
} from 'lucide-react'

type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue'
type StatusIcon = LucideIcon

const TONE: Record<StatusTone, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red:   'bg-rose-50 text-rose-600 border-rose-200',
  gray:  'bg-slate-100 text-slate-600 border-slate-200',
  blue:  'bg-blue-50 text-blue-700 border-blue-200',
}

const STATUS_META: Record<string, { label: string; tone: StatusTone; Icon?: StatusIcon }> = {
  // — magazyn / partie (etykiety PL, krótkie dla gęstych tabel) —
  active:          { label: 'DOSTĘPNA',  tone: 'green' },
  low_expiry:      { label: 'KR. TERMIN', tone: 'amber' },
  expired:         { label: 'PRZETERM.', tone: 'red'   },
  used:            { label: 'ZUŻYTA',    tone: 'gray'  },
  AVAILABLE:       { label: 'DOSTĘPNA',  tone: 'green' },
  PARTIALLY_USED:  { label: 'CZĘŚCIOWO', tone: 'amber' },
  DEPLETED:        { label: 'ZUŻYTA',    tone: 'gray'  },
  QUARANTINE:      { label: 'KWARANTANNA', tone: 'red' },
  // — zlecenia masowania / linie produkcji (PL + ikona) —
  planned:      { label: 'Zaplanowane', tone: 'gray',  Icon: CircleDashed },
  in_progress:  { label: 'W toku',      tone: 'amber', Icon: Clock3 },
  done:         { label: 'Zakończone',  tone: 'green', Icon: CheckCircle2 },
  cancelled:    { label: 'Anulowane',   tone: 'red',   Icon: XCircle },
  PLANNED:      { label: 'Zaplanowane', tone: 'gray',  Icon: CircleDashed },
  IN_PROGRESS:  { label: 'W toku',      tone: 'amber', Icon: Clock3 },
  DONE:         { label: 'Zakończone',  tone: 'green', Icon: CheckCircle2 },
  // — dokumenty (HDI / WZ / CMR) —
  draft:        { label: 'Szkic',       tone: 'gray',  Icon: FileEdit },
  issued:       { label: 'Wystawiony',  tone: 'blue',  Icon: FileCheck2 },
  sent:         { label: 'Wysłany',     tone: 'blue',  Icon: Send },
  confirmed:    { label: 'Zatwierdzony',tone: 'green', Icon: CheckCircle2 },
}

// Użycie:
//   <StatusBadge status="done" />                 — auto label+ton+ikona z mapy
//   <StatusBadge tone="green" label="Zrealizowane" />  — domena z własną etykietą
export function StatusBadge({ status, tone, label, icon: IconOverride, className }: {
  status?: string
  tone?: StatusTone
  label?: string
  icon?: StatusIcon
  className?: string
}) {
  const meta = status ? STATUS_META[status] : undefined
  const t = tone ?? meta?.tone ?? 'gray'
  const Icon = IconOverride ?? meta?.Icon
  const text = label ?? meta?.label ?? status ?? '—'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap',
      TONE[t], className,
    )}>
      {Icon && <Icon size={11} />}
      {text}
    </span>
  )
}

// Tony statusów dla domen z własnymi etykietami (dokumenty, zamówienia).
export const STATUS_TONE = TONE
export type { StatusTone }

// ─── computeDisplayStatus ────────────────────────────────────
export function computeDisplayStatus(expiryDate: string, kgAvailable: number): string {
  return deriveRawBatchStatus(expiryDate, kgAvailable)
}
