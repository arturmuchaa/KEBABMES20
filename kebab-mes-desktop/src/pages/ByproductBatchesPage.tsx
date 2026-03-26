import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchByproducts, fetchByproductsSummary } from '@/api/index'
import { KpiCard } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtKg } from '@/lib/utils'
import { Bone } from 'lucide-react'

type Filter = 'all' | 'bones' | 'backs'

const FILTER_TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'bones', label: 'Kości' },
  { key: 'backs', label: 'Grzbiety' },
]

export function ByproductBatchesPage() {
  const [filter, setFilter] = useState<Filter>('all')

  const { data: byproducts = [], isLoading } = useQuery({
    queryKey: ['byproducts'],
    queryFn: fetchByproducts,
  })

  const { data: summary = [] } = useQuery({
    queryKey: ['byproducts-summary'],
    queryFn: fetchByproductsSummary,
  })

  const allItems = byproducts as any[]
  const filtered = filter === 'all'
    ? allItems
    : allItems.filter((b: any) => {
        if (filter === 'bones') return (b.type || '').toLowerCase().includes('kość') || (b.type || '').toLowerCase().includes('bone')
        if (filter === 'backs') return (b.type || '').toLowerCase().includes('grz') || (b.type || '').toLowerCase().includes('back')
        return true
      })

  const bonesKg = allItems.filter((b: any) => (b.type || '').toLowerCase().includes('kość') || (b.type || '').toLowerCase().includes('bone'))
    .reduce((s: number, b: any) => s + Number(b.weight ?? b.kg ?? 0), 0)

  const backsKg = allItems.filter((b: any) => (b.type || '').toLowerCase().includes('grz') || (b.type || '').toLowerCase().includes('back'))
    .reduce((s: number, b: any) => s + Number(b.weight ?? b.kg ?? 0), 0)

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-200">Produkty uboczne</h2>

      <div className="grid grid-cols-2 gap-4">
        <KpiCard label="Kości łącznie" value={fmtKg(bonesKg)} icon={<Bone size={16} />} accent="amber" />
        <KpiCard label="Grzbiety łącznie" value={fmtKg(backsKg)} icon={<Bone size={16} />} accent="cyan" />
      </div>

      <div className="flex gap-1 bg-mes-elevated rounded-lg p-1 w-fit">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === tab.key ? 'bg-mes-accent text-white' : 'text-slate-400 hover:text-slate-200'
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
              {['ID', 'Typ', 'Waga', 'Data', 'Nr rozbioru', 'Uwagi'].map(h => (
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
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Brak produktów ubocznych</td></tr>
            ) : filtered.map((b: any) => (
              <tr key={b.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-400 font-mono text-xs">{b.id}</td>
                <td className="px-4 py-3 text-slate-200">{b.type || '—'}</td>
                <td className="px-4 py-3 text-slate-200">{fmtKg(b.weight ?? b.kg)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(b.date || b.created_at)}</td>
                <td className="px-4 py-3 text-slate-400 font-mono text-xs">{b.deboning_entry_id || b.deboning_id || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{b.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(summary as any[]).length > 0 && (
        <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-mes-elevated border-b border-mes-border">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Podsumowanie dzienne</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mes-border/50">
                {['Data', 'Typ', 'Łączna waga'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(summary as any[]).map((s: any, i: number) => (
                <tr key={i} className="border-b border-mes-border/50 hover:bg-mes-elevated/50">
                  <td className="px-4 py-2.5 text-slate-400">{fmtDate(s.date)}</td>
                  <td className="px-4 py-2.5 text-slate-400">{s.type}</td>
                  <td className="px-4 py-2.5 text-slate-200">{fmtKg(s.total_weight ?? s.total_kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
