/**
 * Palety czekające na zamówienie — z zamówień usuniętych, anulowanych albo
 * zmienionych tak, że paleta przestała do nich pasować.
 *
 * Paleta przypina się SAMA do otwartego zamówienia tego samego odbiorcy, gdy
 * cała jej zawartość pasuje (receptura, rodzaj, tuleja, waga) i mieści się
 * w wolnej ilości. Stara kartka działa wtedy na skanerze bez przeklejania.
 * Panel jest po to, żeby biuro wiedziało, czego brakuje w zamówieniu.
 * Nic nie pokazuje, gdy poczekalnia jest pusta.
 */
import { useApi } from '@/hooks/useApi'
import { palletsApi, type OrphanPallet } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { Layers } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { kgText } from './orderPlanning'

export function OrphanPalletsPanel({ refreshKey }: { refreshKey?: unknown }) {
  const { data, error, refetch, loading } = useApi<OrphanPallet[]>(() => palletsApi.orphans(), [refreshKey])
  if (loading && !data) return <p role="status" className="text-xs text-slate-600">Sprawdzanie palet oczekujących…</p>
  if (error) return <p role="alert" className="order-info order-warning">Nie udało się sprawdzić palet oczekujących. <button className="underline" onClick={() => void refetch()}>Ponów</button></p>
  if (!Array.isArray(data) || data.length === 0) return null
  return (
    <div role="region" aria-label="Palety czekające na zamówienie"
         className="order-panel border-l-4 border-l-amber-500">
      <details>
      <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-semibold text-amber-900">
        <Layers size={15} aria-hidden="true" /> Palety czekające na zamówienie ({data.length})<span className="ml-auto text-xs font-normal text-slate-600">Pokaż rozpis</span>
      </summary>
      <p className="px-5 pb-4 text-xs text-slate-600 max-w-5xl">
        Pochodzą z usuniętych lub zmienionych zamówień. Przypną się same do zamówienia tego odbiorcy,
        gdy będzie miało pozycję z tym samym towarem i wolną ilość — stara kartka zadziała wtedy na skanerze.
      </p>
      <ul className="grid gap-3 px-5 pb-4 lg:grid-cols-2">
        {data.map(p => (
          <li key={p.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-sm text-slate-900">
              {p.sourceOrderNo || 'usunięte zamówienie'} · P{p.palletNo}
            </span><StatusBadge tone="amber" label="Oczekuje na zamówienie" /></div>
            {p.cartonNo != null && <span className="text-slate-500"> · karton {formatCartonNo(p.cartonNo)}</span>}
            <p className="font-semibold">{p.clientName || 'Brak klienta'}</p>
            <ul className="my-2 space-y-1">{(p.items ?? []).map((it, i) => <li key={i}><b>{it.qty} × {kgText(it.kgPerUnit)}</b> · {it.recipeName} · {it.productTypeName}{it.packagingName ? ` · ${it.packagingName}` : ''}</li>)}</ul>
            <p className="border-t border-slate-200 pt-2 font-semibold">Łącznie: {kgText((p.items ?? []).reduce((s, it) => s + it.qty * it.kgPerUnit, 0))}</p>
            {p.reason && <p className="mt-2 text-amber-800">{p.reason}</p>}
          </li>
        ))}
      </ul>
      </details>
    </div>
  )
}
