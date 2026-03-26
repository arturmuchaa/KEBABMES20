import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { fetchMixingOrders } from '@/api'
import { SkeletonTable } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/badge'
import { fmtKg, fmtDate } from '@/lib/utils'

const STATUSES = ['', 'pending', 'in_progress', 'done', 'cancelled']
const STATUS_LABELS: Record<string, string> = {
  '': 'Wszystkie', pending: 'Oczekujące', in_progress: 'W trakcie',
  done: 'Zakończone', cancelled: 'Anulowane',
}

export function MixingPlanPage() {
  const [status, setStatus] = useState('')
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['mixing-orders', status],
    queryFn: () => fetchMixingOrders(status),
    refetchInterval: 15_000,
  })

  return (
    <div className="space-y-4 max-w-6xl animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <Layers size={16} className="text-mes-accent" />
        <h1 className="text-base font-semibold text-slate-200">Planowanie masowania</h1>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              status === s
                ? 'bg-mes-accent border-mes-accent text-white'
                : 'bg-mes-surface border-mes-border text-slate-400 hover:border-slate-500'
            }`}>
            {STATUS_LABELS[s]}
            {s === '' && orders.length > 0 && <span className="ml-1.5 text-slate-500">({orders.length})</span>}
          </button>
        ))}
      </div>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        {isLoading ? <SkeletonTable rows={6} /> : orders.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">Brak zleceń masowania</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mes-border text-slate-500 text-xs">
                {['Nr zlecenia', 'Masownica', 'Receptura', 'Kg mięsa', 'Kg wyrobione', 'Status', 'Data'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-mes-border/50">
              {orders.map((o: any) => (
                <tr key={o.id} className="hover:bg-mes-elevated/40 transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold text-mes-accent-l">{o.order_no || o.orderNo}</td>
                  <td className="px-4 py-3 text-slate-300">M-{o.machine_id || o.machineId}</td>
                  <td className="px-4 py-3 text-slate-300">{o.recipe_name || o.recipeName || '—'}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{fmtKg(o.meat_kg || o.meatKg)}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-emerald-400">{o.kg_actual ? fmtKg(o.kg_actual) : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-slate-400">{fmtDate(o.created_at || o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
