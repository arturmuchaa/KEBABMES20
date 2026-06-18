/**
 * Podsumowanie lokalizacji sztuk danej partii — dla biura.
 * „Gdzie jest kebab": ile sztuk w produkcji / mroźni szokowej / kartonie+składowej / wydanych.
 */
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi } from '@/lib/api'
import { MapPin } from 'lucide-react'

function Chip({ n, label, cls }: { n: number; label: string; cls: string }) {
  if (n <= 0) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <span className="tabular-nums">{n}×</span> {label}
    </span>
  )
}

export function BatchLocationSummary({ batchNo }: { batchNo: string }) {
  const { data, loading } = useApi(
    () => (batchNo ? finishedUnitsApi.locationSummary(batchNo) : Promise.resolve(null)),
    [batchNo],
  )
  if (loading) return <div className="text-[11px] text-muted-foreground">Ładowanie lokalizacji…</div>
  if (!data) return null
  const cartons = (data.cartons ?? []).join(', ')
  const total = data.planned + data.produced + data.packed + data.shipped
  if (total === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <MapPin size={12} /> Lokalizacja
      </span>
      <Chip n={data.planned}  label="w produkcji"      cls="bg-slate-100 text-slate-700" />
      <Chip n={data.produced} label="mroźnia szokowa"  cls="bg-blue-100 text-blue-700" />
      <Chip
        n={data.packed}
        label={cartons ? `karton ${cartons} · składowa` : 'mroźnia składowa'}
        cls="bg-emerald-100 text-emerald-700"
      />
      <Chip n={data.shipped}  label="wydane"            cls="bg-violet-100 text-violet-700" />
    </div>
  )
}
