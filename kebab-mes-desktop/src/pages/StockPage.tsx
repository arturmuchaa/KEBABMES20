import { useQuery } from '@tanstack/react-query'
import { Package, Beef, BarChart3 } from 'lucide-react'
import { fetchRawBatches, fetchMeatStock } from '@/api'
import { KpiCard } from '@/components/ui/card'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { ExpiryBadge } from '@/components/ui/badge'
import { fmtKg, fmtDate } from '@/lib/utils'

export function StockPage() {
  const { data: rawBatches = [], isLoading: loadRaw } = useQuery({
    queryKey: ['raw-batches'],
    queryFn: fetchRawBatches,
    refetchInterval: 30_000,
  })

  const { data: meatStock = [], isLoading: loadMeat } = useQuery({
    queryKey: ['meat-stock'],
    queryFn: fetchMeatStock,
    refetchInterval: 30_000,
  })

  const activeBatches = rawBatches.filter(b => b.status === 'active')
  const totalRawKg    = activeBatches.reduce((s, b) => s + b.kg_available, 0)
  const totalMeatKg   = meatStock.reduce((s, m) => s + m.kg_available, 0)

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* KPIs */}
      <section>
        <SectionTitle icon={<BarChart3 size={14} />} label="Stany magazynowe" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {loadRaw || loadMeat ? (
            Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KpiCard
                label="Partie surowca aktywne"
                value={activeBatches.length}
                sub={fmtKg(totalRawKg)}
                icon={<Package size={18} />}
                accent="blue"
              />
              <KpiCard
                label="Mięso po rozbiorze"
                value={meatStock.length}
                sub={fmtKg(totalMeatKg) + ' łącznie'}
                icon={<Beef size={18} />}
                accent="green"
              />
              <KpiCard
                label="Partie przeterminowane"
                value={rawBatches.filter(b => b.status === 'expired').length}
                sub="do utylizacji"
                icon={<Package size={18} />}
                accent={rawBatches.some(b => b.status === 'expired') ? 'red' : 'green'}
              />
            </>
          )}
        </div>
      </section>

      {/* Raw Batches */}
      <section>
        <SectionTitle icon={<Package size={14} />} label="Partie surowca" />
        {loadRaw ? (
          <SkeletonTable rows={6} />
        ) : (
          <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
            {activeBatches.length === 0 ? (
              <EmptyState message="Brak aktywnych partii surowca" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mes-border text-slate-500 text-xs">
                    <Th>Nr partii</Th>
                    <Th>Dostawca</Th>
                    <Th>Ubój</Th>
                    <Th>Przyjęcie</Th>
                    <Th right>Kg przyjęte</Th>
                    <Th right>Kg dostępne</Th>
                    <Th>Ważność</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mes-border/50">
                  {activeBatches
                    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
                    .map(b => (
                      <tr key={b.id} className="hover:bg-mes-elevated/40 transition-colors">
                        <Td>
                          <span className="font-mono text-mes-accent-l font-semibold">
                            {b.internal_batch_no}
                          </span>
                        </Td>
                        <Td>{b.supplier_name}</Td>
                        <Td>{fmtDate(b.slaughter_date)}</Td>
                        <Td>{fmtDate(b.received_at)}</Td>
                        <Td right className="font-mono tabular-nums">{fmtKg(b.kg_received)}</Td>
                        <Td right className="font-mono tabular-nums font-semibold text-emerald-400">
                          {fmtKg(b.kg_available)}
                        </Td>
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

      {/* Meat Stock */}
      <section>
        <SectionTitle icon={<Beef size={14} />} label="Mięso po rozbiorze" />
        {loadMeat ? (
          <SkeletonTable rows={4} />
        ) : (
          <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
            {meatStock.length === 0 ? (
              <EmptyState message="Brak mięsa po rozbiorze" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mes-border text-slate-500 text-xs">
                    <Th>ID</Th>
                    <Th>Część</Th>
                    <Th>Źródłowa partia</Th>
                    <Th>Data rozbioru</Th>
                    <Th right>Kg dostępne</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mes-border/50">
                  {meatStock.map(m => (
                    <tr key={m.id} className="hover:bg-mes-elevated/40 transition-colors">
                      <Td>
                        <span className="font-mono text-xs text-slate-400">{m.id.slice(0, 8)}…</span>
                      </Td>
                      <Td>{m.cut_type || '—'}</Td>
                      <Td>
                        <span className="font-mono text-mes-accent-l text-xs">
                          {m.source_batch_id?.slice(0, 10)}…
                        </span>
                      </Td>
                      <Td>{fmtDate(m.created_at)}</Td>
                      <Td right className="font-mono tabular-nums font-semibold text-emerald-400">
                        {fmtKg(m.kg_available)}
                      </Td>
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
