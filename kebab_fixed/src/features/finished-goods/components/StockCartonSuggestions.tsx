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
            className="flex items-center gap-3 rounded-md border border-emerald-200 bg-white px-3 py-2"
          >
            <span className="font-mono text-sm font-black text-emerald-900">
              Karton {formatCartonNo(s.cartonNo) || '—'}
            </span>
            <span className="text-xs text-slate-600">
              {s.productTypeName || s.recipeName} · {s.qty}× {s.kgPerUnit} kg
              {s.packagingName ? ` · ${s.packagingName}` : ''}
            </span>
            <button
              onClick={() => assign(s)}
              disabled={busyId === s.cartonId}
              className="ml-auto inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
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
