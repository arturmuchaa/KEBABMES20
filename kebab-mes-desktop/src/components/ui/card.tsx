import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-mes-border bg-mes-surface shadow-mes-sm',
        className
      )}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 pb-3', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-sm font-semibold text-slate-200 leading-none', className)} {...props} />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-slate-500', className)} {...props} />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-5 pt-0 gap-3', className)} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

// ── Stat / KPI card ───────────────────────────────────────────
interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  accent?: 'blue' | 'green' | 'amber' | 'red' | 'cyan'
  className?: string
}

const accentMap = {
  blue:  { bg: 'bg-blue-500/10',  text: 'text-blue-400',  ring: 'ring-blue-500/20' },
  green: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20' },
  red:   { bg: 'bg-red-500/10',   text: 'text-red-400',   ring: 'ring-red-500/20' },
  cyan:  { bg: 'bg-cyan-500/10',  text: 'text-cyan-400',  ring: 'ring-cyan-500/20' },
}

export function KpiCard({ label, value, sub, icon, accent = 'blue', className }: KpiCardProps) {
  const a = accentMap[accent]
  return (
    <Card className={cn('p-5 flex items-start gap-4 animate-fade-in', className)}>
      {icon && (
        <div className={cn('p-2.5 rounded-lg ring-1', a.bg, a.ring)}>
          <span className={cn('text-lg', a.text)}>{icon}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
        <p className={cn('text-2xl font-bold mt-0.5', a.text)}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </Card>
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
