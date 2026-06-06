import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, PackageOpen, Scissors, Soup, Beef, Factory, AlertTriangle } from 'lucide-react'
import { traceabilityApi } from '@/lib/apiClient'
import { useApi } from '@/hooks/useApi'
import { fmtKg } from '@/lib/utils'

interface FlowStep {
  icon: JSX.Element
  color: string
  stage: string
  items: { partia: string; details: string[] }[]
}

function kgLine(kg: number): string | null {
  return kg > 0 ? `${fmtKg(kg, 1)} kg` : null
}

export function MobilePrzeplywPartiiPage() {
  const [params] = useSearchParams()
  const batch = params.get('batch') || ''
  const res = useApi(() => (batch ? traceabilityApi.backward(batch) : Promise.resolve(null)), [batch])
  const data: any = res.data || {}

  const suppliers: any[] = data.suppliers ?? []
  const supplierName = (rb: any) =>
    suppliers.find((s: any) => s.id === rb.supplier_id)?.display_name
    || suppliers.find((s: any) => s.id === rb.supplier_id)?.name
    || rb.supplier_name || ''

  const steps: FlowStep[] = [
    {
      icon: <PackageOpen size={18} />, color: 'text-blue-700', stage: 'Przyjęcie',
      items: (data.rawBatches ?? []).map((rb: any) => ({
        partia: rb.internal_batch_no || (rb.id ? String(rb.id).slice(0, 8) : '—'),
        details: [supplierName(rb), kgLine(Number(rb.kg_received ?? rb.kg ?? 0)) || ''].filter(Boolean),
      })),
    },
    {
      icon: <Scissors size={18} />, color: 'text-green-700', stage: 'Rozbiór',
      items: (data.deboning ?? []).map((d: any) => ({
        partia: d.rawBatchNo || d.raw_batch_no || d.meatLotNo || d.meat_lot_no || (d.id ? String(d.id).slice(0, 8) : '—'),
        details: [kgLine(Number(d.kgMeat ?? d.kg_meat ?? 0)) || '', d.sessionNo || d.session_no || ''].filter(Boolean),
      })),
    },
    {
      icon: <Soup size={18} />, color: 'text-purple-700', stage: 'Masowanie',
      items: (data.mixingOrders ?? []).map((mo: any) => ({
        // Partia płynąca przez masowanie = numer(y) wsadu (np. 326), NIE numer zlecenia.
        partia: (mo.batch_nos?.length ? mo.batch_nos.join(', ') : '')
          || (mo.id ? String(mo.id).slice(0, 8) : '—'),
        details: [mo.recipe_name || '', mo.order_no ? `zlec. ${mo.order_no}` : ''].filter(Boolean),
      })),
    },
    {
      icon: <Beef size={18} />, color: 'text-amber-700', stage: 'Mięso przyprawione',
      items: (data.seasonedBatches ?? []).map((sm: any) => ({
        partia: sm.batch_no || (sm.id ? String(sm.id).slice(0, 8) : '—'),
        details: [kgLine(Number(sm.kg_produced ?? 0)) || ''].filter(Boolean),
      })),
    },
    {
      icon: <Factory size={18} />, color: 'text-red-700', stage: 'Produkcja / wyrób',
      items: (data.finishedGoods ?? []).map((fg: any) => ({
        partia: fg.batch_no || (fg.id ? String(fg.id).slice(0, 8) : '—'),
        details: [],
      })),
    },
  ]

  const hasAny = steps.some(s => s.items.length > 0)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-slate-700 px-4 py-3 text-white shadow-sm">
        <Link to="/mobile/sztuka" className="flex items-center gap-1 text-sm font-semibold text-slate-100 hover:text-white">
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="text-sm font-bold uppercase tracking-wider">Przepływ partii</div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          Partia: <span className="font-mono font-bold">{batch || '—'}</span>
        </div>

        {res.loading && <div className="py-6 text-center text-sm text-slate-500">Ładowanie pochodzenia…</div>}

        {!res.loading && (!batch || !hasAny) && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle size={18} className="shrink-0" />
            {batch ? `Brak danych pochodzenia dla partii ${batch}.` : 'Brak partii.'}
          </div>
        )}

        {!res.loading && hasAny && (
          <div className="flex flex-col gap-0">
            {steps.filter(s => s.items.length > 0).map((s, idx, arr) => (
              <div key={s.stage} className="relative">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-current bg-white ${s.color}`}>{s.icon}</div>
                    {idx < arr.length - 1 && <div className="w-0.5 flex-1 bg-slate-300" />}
                  </div>
                  <div className="mb-3 flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className={`text-[11px] font-bold uppercase tracking-wide ${s.color}`}>{s.stage}</div>
                    {s.items.map((it, i) => (
                      <div key={i} className="mt-1 border-b border-slate-100 pb-1 last:border-0">
                        <div className="text-lg font-black tabular-nums leading-tight">{it.partia}</div>
                        {it.details.length > 0 && (
                          <div className="text-xs text-slate-500">{it.details.join(' · ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
