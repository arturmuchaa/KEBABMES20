import { useQuery } from '@tanstack/react-query'
import { fetchDeboningEntries } from '@/api/index'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtKg, fmtPct } from '@/lib/utils'

export function DeboningPage() {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['deboning-entries'],
    queryFn: fetchDeboningEntries,
  })

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-200">Raporty rozbioru</h2>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Data', 'Nr partii surowca', 'Pracownik', 'Kg wsad', 'Kg mięsa', 'Kg kości', 'Kg grzbietów', 'Wydajność %'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : (entries as any[]).length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Brak raportów rozbioru</td></tr>
            ) : (entries as any[]).map((e: any) => {
              const yield_pct = e.yield_pct ?? (
                e.kg_input && e.kg_meat
                  ? (Number(e.kg_meat) / Number(e.kg_input)) * 100
                  : null
              )
              return (
                <tr key={e.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-slate-400">{fmtDate(e.date || e.created_at)}</td>
                  <td className="px-4 py-3 text-slate-200 font-mono text-xs">{e.raw_batch_no || e.raw_batch_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{e.worker_name || e.worker_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtKg(e.kg_input ?? e.kg_wsad)}</td>
                  <td className="px-4 py-3 text-slate-200">{fmtKg(e.kg_meat ?? e.kg_mieso)}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtKg(e.kg_bones ?? e.kg_kosci)}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtKg(e.kg_backs ?? e.kg_grzbiety)}</td>
                  <td className="px-4 py-3 text-slate-200 font-mono">{fmtPct(yield_pct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
