import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchClientOrders, updateClientOrderStatus } from '@/api/index'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate } from '@/lib/utils'

type StatusFilter = 'all' | 'new' | 'in_progress' | 'done' | 'cancelled'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'new', label: 'Nowe' },
  { key: 'in_progress', label: 'W realizacji' },
  { key: 'done', label: 'Zrealizowane' },
  { key: 'cancelled', label: 'Anulowane' },
]

function statusVariant(status: string): 'blue' | 'amber' | 'green' | 'default' | 'red' {
  switch (status) {
    case 'new': return 'blue'
    case 'in_progress': return 'amber'
    case 'done': return 'green'
    case 'cancelled': return 'red'
    default: return 'default'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'new': return 'Nowe'
    case 'in_progress': return 'W realizacji'
    case 'done': return 'Zrealizowane'
    case 'cancelled': return 'Anulowane'
    default: return status
  }
}

export function ClientOrdersPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['client-orders'],
    queryFn: fetchClientOrders,
  })

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateClientOrderStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-orders'] })
      toast.success('Status zaktualizowany')
    },
    onError: () => toast.error('Błąd aktualizacji statusu'),
  })

  const filtered = filter === 'all' ? orders : orders.filter((o: any) => o.status === filter)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Zamówienia klientów</h2>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-mes-elevated rounded-lg p-1 w-fit">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === tab.key
                ? 'bg-mes-accent text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Nr zamówienia', 'Klient', 'Data', 'Status', 'Akcje'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Brak zamówień</td></tr>
            ) : filtered.map((o: any) => (
              <>
                <tr
                  key={o.id}
                  className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors cursor-pointer"
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                >
                  <td className="px-4 py-3 text-slate-200 font-medium font-mono">{o.order_no || o.id}</td>
                  <td className="px-4 py-3 text-slate-400">{o.client_name || o.client_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtDate(o.order_date || o.created_at)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(o.status)}>{statusLabel(o.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      {o.status === 'new' && (
                        <button
                          className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                          onClick={() => updateStatus({ id: o.id, status: 'in_progress' })}
                        >Realizuj</button>
                      )}
                      {o.status === 'in_progress' && (
                        <button
                          className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                          onClick={() => updateStatus({ id: o.id, status: 'done' })}
                        >Zakończ</button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === o.id && (
                  <tr key={`${o.id}-expanded`} className="border-b border-mes-border/50 bg-mes-elevated/30">
                    <td colSpan={5} className="px-6 py-3">
                      <div className="text-xs text-slate-400 space-y-1">
                        <div><span className="text-slate-300 font-medium">Produkty:</span> {JSON.stringify(o.items || o.products || [])}</div>
                        {o.notes && <div><span className="text-slate-300 font-medium">Uwagi:</span> {o.notes}</div>}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
