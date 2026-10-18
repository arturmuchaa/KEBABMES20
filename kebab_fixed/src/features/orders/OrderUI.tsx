import type { ReactNode } from 'react'
import type { OrderLine } from '@/lib/mockApi'
import { kgNumber, kgText, lineProgress, percentNumber, type progressTotals } from './orderPlanning'

export function OrderSection({ title, description, action, children, className = '' }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={`order-panel ${className}`}>
    <header className="order-section-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>
    {children}
  </section>
}

export function OrderMetric({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return <div className="order-metric" role="group" aria-label={label}><p>{label}</p><strong>{value}</strong>{children}{hint && <small>{hint}</small>}</div>
}

export function OrderKpis({ progress: p, orderedKg, label, hint }: {
  progress: ReturnType<typeof progressTotals>; orderedKg: number; label: string; hint: string
}) {
  const pieces = (n: number | null) => n === null ? 'Brak danych' : `${kgNumber.format(n)} szt.`
  return <div className="order-metrics" role="group" aria-label={label}>
    <OrderMetric label="Zamówiono" value={kgText(orderedKg)} hint={`${pieces(p.orderedQty)} · ${hint}`} />
    <OrderMetric label="W magazynie" value={kgText(p.stockKg)} hint={`${pieces(p.stockQty)} · gotowe do wydania`} />
    <OrderMetric label="Wydano" value={kgText(p.deliveredKg)} hint={`${pieces(p.deliveredQty)} · poza magazynem`} />
    <OrderMetric label="Brak wyrobu" value={kgText(p.remainingKg)} hint={`${pieces(p.remainingQty)} · do przygotowania`} />
    <OrderMetric label="Pokrycie zamówień" value={p.percent === null ? '—' : `${percentNumber.format(p.percent)}%`} hint="Magazyn + wydania, nie stan">
      {p.percent !== null && <div className="order-kpi-progress" role="progressbar" aria-label={`Pokrycie — ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(p.percent.toFixed(1))}><span style={{ width: `${p.percent}%` }} /></div>}
    </OrderMetric>
  </div>
}

export function OrderProgress({ line, compact = false }: { line: OrderLine; compact?: boolean }) {
  const p = lineProgress(line)
  const state = !p ? 'unknown' : p.coveredQty >= line.qty && line.qty > 0 ? 'complete' : p.coveredQty > 0 ? 'partial' : 'none'
  return <div className={`order-production ${state}${compact ? ' compact' : ''}`}>
    <div className="order-stock-delivery">
      <span className="order-stock-value">Magazyn <strong>{p ? kgNumber.format(p.stockQty) : '—'} szt.</strong></span>
      <span className="order-delivered-value">Wydano <strong>{p ? kgNumber.format(p.deliveredQty) : '—'} szt.</strong></span>
    </div>
    {p && <div className="order-progress-track" role="progressbar" aria-label={`Pokrycie ${line.recipeName} — magazyn i wydania`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(p.percent.toFixed(1))}
      aria-valuetext={`${p.coveredQty} z ${line.qty} szt.; magazyn ${p.stockQty}, wydano ${p.deliveredQty}`}><span style={{ width: `${p.percent}%` }} /></div>}
    <small className="order-progress-source">{p ? `Pokrycie ${kgNumber.format(p.coveredQty)} / ${kgNumber.format(line.qty)} szt. · ${percentNumber.format(p.percent)}%` : 'Brak danych magazynowych'}</small>
  </div>
}
