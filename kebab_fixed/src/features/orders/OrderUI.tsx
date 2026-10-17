import type { ReactNode } from 'react'
import { CheckCircle2, CircleDashed, AlertCircle, PackageCheck } from 'lucide-react'
import type { OrderLine } from '@/lib/mockApi'
import { kgNumber, lineProgress } from './orderPlanning'

export function OrderSection({ title, description, action, children, className = '' }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={`order-panel ${className}`}>
    <header className="order-section-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>
    {children}
  </section>
}

export function OrderMetric({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'violet' }) {
  return <div className={`order-metric order-tone-${tone}`}><p>{label}</p><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
}

export function OrderProgress({ line, compact = false }: { line: OrderLine; compact?: boolean }) {
  const p = lineProgress(line)
  const state = !p ? 'unknown' : p.readyQty >= line.qty && line.qty > 0 ? 'complete' : p.readyQty > 0 ? 'partial' : 'none'
  const Icon = state === 'complete' ? CheckCircle2 : state === 'partial' ? PackageCheck : state === 'unknown' ? AlertCircle : CircleDashed
  return <div className={`order-production ${state}${compact ? ' compact' : ''}`}>
    <div className="order-progress-heading"><span className="order-production-label"><Icon size={13} aria-hidden="true" />GOTOWE</span>
      <strong>{p ? kgNumber.format(p.readyQty) : '—'} <span>/ {kgNumber.format(line.qty)} <small>szt.</small></span></strong></div>
    {p && <div className="order-progress-track" role="progressbar" aria-label={`Postęp magazynowy ${line.recipeName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(p.percent.toFixed(1))}
      aria-valuetext={`${p.readyQty} z ${line.qty} szt.; magazyn ${p.stockQty}, wydano ${p.deliveredQty}`}><span style={{ width: `${p.percent}%` }} /></div>}
    <small className="order-progress-source">{p ? `Magazyn: ${kgNumber.format(p.stockQty)} · Wydano: ${kgNumber.format(p.deliveredQty)} szt.` : 'Brak danych magazynowych'}</small>
  </div>
}
