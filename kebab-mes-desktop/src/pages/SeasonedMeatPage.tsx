import { useQuery } from '@tanstack/react-query'
import { fetchSeasonedMeat } from '@/api/index'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtKg } from '@/lib/utils'

export function SeasonedMeatPage() {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['seasoned-meat'],
    queryFn: fetchSeasonedMeat,
  })

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-200">Mięso przyprawione</h2>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Nr partii', 'Receptura', 'Data produkcji', 'Kg dostępne', 'Data ważności', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : (batches as any[]).length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Brak partii mięsa przyprawionego</td></tr>
            ) : (batches as any[]).map((b: any) => (
              <tr key={b.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-200 font-medium font-mono">{b.batch_no}</td>
                <td className="px-4 py-3 text-slate-400">{b.recipe_name || b.recipe_id}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(b.created_at)}</td>
                <td className="px-4 py-3 text-slate-200">{fmtKg(b.kg_available)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(b.expiry_date)}</td>
                <td className="px-4 py-3">
                  <Badge variant={b.status === 'AVAILABLE' ? 'green' : b.status === 'USED' ? 'default' : 'amber'}>
                    {b.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
