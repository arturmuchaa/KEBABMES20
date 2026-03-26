import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDeboningEntries } from '@/api/index'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtKg } from '@/lib/utils'

export function HaccpPage() {
  const today = new Date().toISOString().substring(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10)
  const [dateFrom, setDateFrom] = useState(weekAgo)
  const [dateTo, setDateTo] = useState(today)

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['deboning-entries'],
    queryFn: fetchDeboningEntries,
  })

  const filtered = (entries as any[]).filter((e: any) => {
    const d = (e.date || e.created_at || '').substring(0, 10)
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
  })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Raport HACCP</h2>
        <span className="text-xs text-slate-500 italic">Dane do eksportu do arkusza HACCP</span>
      </div>

      {/* Date filters */}
      <div className="flex items-center gap-3 bg-mes-surface border border-mes-border rounded-xl p-3">
        <span className="text-xs text-slate-400">Od:</span>
        <input
          type="date"
          className="bg-mes-elevated border border-mes-border rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <span className="text-xs text-slate-400">Do:</span>
        <input
          type="date"
          className="bg-mes-elevated border border-mes-border rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
        <span className="ml-auto text-xs text-slate-500">{filtered.length} rekordów</span>
      </div>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Data', 'Nr partii surowca', 'Pracownik', 'Kg wsad', 'Kg mięsa', 'Kg kości', 'Wydajność %', 'Uwagi'].map(h => (
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
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Brak danych w wybranym zakresie</td></tr>
            ) : filtered.map((e: any) => {
              const yieldPct = e.yield_pct ?? (
                e.kg_input && e.kg_meat
                  ? ((Number(e.kg_meat) / Number(e.kg_input)) * 100).toFixed(1)
                  : '—'
              )
              return (
                <tr key={e.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-slate-400">{fmtDate(e.date || e.created_at)}</td>
                  <td className="px-4 py-3 text-slate-200 font-mono text-xs">{e.raw_batch_no || e.raw_batch_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{e.worker_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtKg(e.kg_input ?? e.kg_wsad)}</td>
                  <td className="px-4 py-3 text-slate-200">{fmtKg(e.kg_meat ?? e.kg_mieso)}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtKg(e.kg_bones ?? e.kg_kosci)}</td>
                  <td className="px-4 py-3 text-slate-200 font-mono">{typeof yieldPct === 'number' ? `${yieldPct}%` : yieldPct}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{e.notes || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
