import type { ReactNode } from 'react'
import { CheckCircle2, CircleDashed, AlertCircle, Factory } from 'lucide-react'
import type { OrderLine } from '@/lib/mockApi'
import { kgNumber } from './orderPlanning'

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

export function ProductionProgress({ line, compact = false }: { line: OrderLine; compact?: boolean }) {
  const p = line.production
  const state = !p ? 'unknown' : p.reportedQty >= line.qty && line.qty > 0 ? 'complete' : p.reportedQty > 0 ? 'partial' : 'none'
  const Icon = state === 'complete' ? CheckCircle2 : state === 'partial' ? Factory : state === 'unknown' ? AlertCircle : CircleDashed
  const pct = p && line.qty > 0 ? Math.min(100, p.reportedQty / line.qty * 100) : 0
  return <div className={`order-production ${state}${compact ? ' compact' : ''}`}>
    <span className="order-production-label"><Icon size={13} aria-hidden="true" />GOTOWE <span>{({ complete: 'Ukończone', partial: 'W trakcie', none: 'Brak raportów', unknown: 'Brak danych' })[state]}</span></span>
    <strong>{p ? kgNumber.format(p.reportedQty) : '—'} <span>/ {kgNumber.format(line.qty)} <small>szt.</small></span></strong>
    {p && <div className="order-progress-track" role="progressbar" aria-label={`Produkcja ${line.recipeName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(pct.toFixed(1))}><span style={{ width: `${pct}%` }} /></div>}
    {!compact && <small>{p ? 'Zgłoszone w powiązanych planach MES' : 'Brak wiarygodnego powiązania z raportem MES'}</small>}
    {p && p.reportedQty > line.qty && <small>Nadwyżka: {p.reportedQty - line.qty} szt.</small>}
  </div>
}
