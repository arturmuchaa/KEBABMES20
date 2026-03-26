import { useQuery } from '@tanstack/react-query'
import {
  Package, Beef, FlaskConical, AlertTriangle,
  TrendingUp, Activity,
} from 'lucide-react'
import { fetchDashboard, fetchRawBatches } from '@/api'
import { KpiCard } from '@/components/ui/card'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { ExpiryBadge } from '@/components/ui/badge'
import { fmtKg, fmtDate } from '@/lib/utils'

export function DashboardPage() {
  const { data: stats, isLoading: loadStats } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  fetchDashboard,
    refetchInterval: 30_000,
  })

  const { data: batches = [], isLoading: loadBatches } = useQuery({
    queryKey: ['raw-batches-all'],
    queryFn:  fetchRawBatches,
    refetchInterval: 30_000,
  })

  // FEFO — sort by expiry, show critical first
  const fefo = [...batches]
    .filter(b => b.status === 'active' && b.kg_available > 0)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
    .slice(0, 8)

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* ── Section: KPIs ─────────────────────────────────── */}
      <section>
        <SectionTitle icon={<Activity size={14} />} label="Stan systemu" />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loadStats ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KpiCard
                label="Partie surowca"
                value={stats?.rawBatchesCount ?? 0}
                sub={fmtKg(stats?.rawBatchesKg)}
                icon={<Package size={18} />}
                accent="blue"
              />
              <KpiCard
                label="Mięso dostępne"
                value={fmtKg(stats?.meatStockKg)}
                sub="po rozbiorze"
                icon={<Beef size={18} />}
                accent="green"
              />
              <KpiCard
                label="Masowanie aktywne"
                value={stats?.activeMixingOrders ?? 0}
                sub="zleceń w toku"
                icon={<FlaskConical size={18} />}
                accent="cyan"
              />
              <KpiCard
                label="Krytyczne FEFO"
                value={stats?.criticalFefoCount ?? 0}
                sub="partie do zużycia"
                icon={<AlertTriangle size={18} />}
                accent={stats?.criticalFefoCount ? 'red' : 'green'}
              />
            </>
          )}
        </div>
      </section>

      {/* ── Section: FEFO table ────────────────────────────── */}
      <section>
        <SectionTitle icon={<TrendingUp size={14} />} label="Kolejka FEFO — partie surowca" />
        {loadBatches ? (
          <SkeletonTable rows={5} />
        ) : (
          <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
            {fefo.length === 0 ? (
              <EmptyState message="Brak aktywnych partii surowca" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mes-border text-slate-500 text-xs">
                    <Th>Nr partii</Th>
                    <Th>Dostawca</Th>
                    <Th>Ubój</Th>
                    <Th right>Dostępne</Th>
                    <Th>Ważność</Th>
                    <Th>Status FEFO</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mes-border/50">
                  {fefo.map(b => (
                    <tr key={b.id} className="hover:bg-mes-elevated/40 transition-colors">
                      <Td>
                        <span className="font-mono text-mes-accent-l font-semibold">
                          {b.internal_batch_no}
                        </span>
                      </Td>
                      <Td>{b.supplier_name}</Td>
                      <Td>{fmtDate(b.slaughter_date)}</Td>
                      <Td right className="font-mono tabular-nums">{fmtKg(b.kg_available)}</Td>
                      <Td>{fmtDate(b.expiry_date)}</Td>
                      <Td><ExpiryBadge expiryDate={b.expiry_date} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-mes-accent-l">{icon}</span>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</h2>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-left font-medium ${right ? 'text-right' : ''}`}>
      {children}
    </th>
  )
}

function Td({ children, right, className }: {
  children?: React.ReactNode
  right?: boolean
  className?: string
}) {
  return (
    <td className={`px-4 py-3 text-slate-200 ${right ? 'text-right' : ''} ${className ?? ''}`}>
      {children ?? '—'}
    </td>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-slate-500 text-sm">{message}</div>
  )
}
