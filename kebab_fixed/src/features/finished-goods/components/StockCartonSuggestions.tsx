/**
 * Panel „Pasujące kartony z magazynu" na widoku zamówienia.
 * Pokazuje kartony magazynowe zgodne ze specyfikacją zamówienia (klient +
 * receptura + rodzaj + tuleja + waga) i pozwala biuru przypisać je jednym klikiem.
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, type StockCartonSuggestion } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { PackageCheck, Loader2 } from 'lucide-react'

export function StockCartonSuggestions({ orderId }: { orderId: string }) {
  const { data, loading, refetch } = useApi(
    () => clientOrdersApi.stockCartonSuggestions(orderId), [orderId],
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const suggestions: StockCartonSuggestion[] = data ?? []
  if (loading || suggestions.length === 0) return null

  async function assign(s: StockCartonSuggestion) {
    setBusyId(s.cartonId); setError(null)
    try {
      await clientOrdersApi.assignStockCarton(orderId, s.cartonId)
      await refetch()
    } catch (e: any) {
      setError(e?.message || 'Nie udało się przypisać kartonu')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
        <PackageCheck size={14} /> Pasujące kartony z magazynu ({suggestions.length})
      </div>
      {error && <div className="mb-2 text-sm font-semibold text-red-600">{error}</div>}
      <ul className="space-y-1.5">
        {suggestions.map(s => (
          <li
            key={s.cartonId}
            className="flex items-start gap-3 rounded-md border border-emerald-200 bg-white px-3 py-2"
          >
            <span className="mt-0.5 shrink-0 font-mono text-sm font-black text-emerald-900">
              Karton {formatCartonNo(s.cartonNo) || '—'}
            </span>
            <div className="min-w-0 flex-1 text-xs text-slate-600">
              {s.lines.length === 0 ? (
                <span>{s.qty} szt</span>
              ) : s.lines.length === 1 ? (
                <span>
                  {s.lines[0].productTypeName || s.lines[0].recipeName} · {s.lines[0].packedQty}× {s.lines[0].kgPerUnit} kg
                  {s.lines[0].packagingName ? ` · ${s.lines[0].packagingName}` : ''}
                </span>
              ) : (
                <ul className="space-y-0.5">
                  {s.lines.map((l, i) => (
                    <li key={i} className="tabular-nums">
                      <span className="font-semibold text-slate-700">{l.packedQty}× {l.kgPerUnit} kg</span>
                      {' · '}{l.productTypeName || l.recipeName}{l.packagingName ? ` · ${l.packagingName}` : ''}
                    </li>
                  ))}
                  <li className="text-[11px] font-semibold text-emerald-700">Razem {s.qty} szt · {s.lines.length} pozycje</li>
                </ul>
              )}
            </div>
            <button
              onClick={() => assign(s)}
              disabled={busyId === s.cartonId}
              className="ml-auto mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyId === s.cartonId ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />}
              Przypisz
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
