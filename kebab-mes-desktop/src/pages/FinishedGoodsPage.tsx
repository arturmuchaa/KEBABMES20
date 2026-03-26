import { useQuery } from '@tanstack/react-query'
import { fetchFinishedGoods } from '@/api/index'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtKg } from '@/lib/utils'

export function FinishedGoodsPage() {
  const { data: goods = [], isLoading } = useQuery({
    queryKey: ['finished-goods'],
    queryFn: fetchFinishedGoods,
  })

  // Group by production date
  const byDay = (goods as any[]).reduce((acc: Record<string, any[]>, g: any) => {
    const day = fmtDate(g.production_date || g.created_at)
    if (!acc[day]) acc[day] = []
    acc[day].push(g)
    return acc
  }, {})

  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a))

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-200">Wyrób gotowy</h2>

      {isLoading ? (
        <div className="bg-mes-surface border border-mes-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : (goods as any[]).length === 0 ? (
        <div className="bg-mes-surface border border-mes-border rounded-xl p-8 text-center text-slate-500 text-sm">
          Brak wyrobu gotowego
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(day => (
            <div key={day} className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-mes-elevated border-b border-mes-border">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{day}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mes-border/50">
                    {['Nr partii', 'Produkt', 'Receptura', 'Tuleja', 'Klient', 'Ilość', 'Kg'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byDay[day].map((g: any) => (
                    <tr key={g.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-200 font-mono text-xs">{g.batch_no || g.id}</td>
                      <td className="px-4 py-2.5 text-slate-400">{g.product_name || g.product_type_name || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{g.recipe_name || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{g.packaging_name || g.sleeve_id || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{g.client_name || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{g.qty || g.quantity || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-200">{fmtKg(g.kg_total ?? g.kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
