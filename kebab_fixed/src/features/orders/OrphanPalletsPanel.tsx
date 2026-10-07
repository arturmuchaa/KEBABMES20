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

export function OrphanPalletsPanel({ refreshKey }: { refreshKey?: unknown }) {
  const { data } = useApi<OrphanPallet[]>(() => palletsApi.orphans(), [refreshKey])
  if (!data || data.length === 0) return null
  return (
    <div role="region" aria-label="Palety czekające na zamówienie"
         className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
        <Layers size={15} /> Palety czekające na zamówienie ({data.length})
      </div>
      <p className="mt-0.5 text-xs text-amber-900/80">
        Pochodzą z usuniętych lub zmienionych zamówień. Przypną się same do zamówienia tego odbiorcy,
        gdy będzie miało pozycję z tym samym towarem i wolną ilość — stara kartka zadziała wtedy na skanerze.
      </p>
      <ul className="mt-2 space-y-1">
        {data.map(p => (
          <li key={p.id} className="text-xs text-slate-700">
            <span className="font-mono font-bold text-slate-900">
              {p.sourceOrderNo || 'usunięte zamówienie'} · P{p.palletNo}
            </span>
            {p.cartonNo != null && <span className="text-slate-500"> · karton {formatCartonNo(p.cartonNo)}</span>}
            {' — '}{p.clientName || '—'}{': '}
            {p.items.map(it => `${it.qty}× ${it.kgPerUnit} kg ${it.productTypeName || it.recipeName}${it.packagingName ? ` · ${it.packagingName}` : ''}`).join(', ')}
            {p.reason && <span className="text-slate-500"> ({p.reason})</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
