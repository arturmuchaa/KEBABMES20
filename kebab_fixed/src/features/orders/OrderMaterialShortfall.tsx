import { useEffect, useState } from 'react'
import { Boxes, CheckCircle2 } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements } from '@/lib/api'
import { CWIARTKA, Dot, Kg } from './material-ui'

/** Surowiec potrzebny na NIEWYKONANĄ część zamówienia (qty - qty_done).
 *  Renderowany w rozwinięciu wiersza zamówienia; pobiera dane przy montażu. */
export function OrderMaterialShortfall({ orderId }: { orderId: string }) {
  const [data, setData] = useState<MaterialRequirements | null>(null)
  useEffect(() => {
    let alive = true
    materialRequirementsApi.forOrder(orderId, 'remaining')
      .then(d => { if (alive) setData(d) })
      .catch(err => { console.error('zapotrzebowanie zamówienia:', err); if (alive) setData(null) })
    return () => { alive = false }
  }, [orderId])

  if (!data) return null
  const rows = data.totalsByRaw.filter(t => t.kgRaw > 0)
  if (rows.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs font-medium text-emerald-700">
        <CheckCircle2 size={13} /> Surowiec na resztę: nic nie brakuje — całość zaraportowana
      </div>
    )
  }

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/50">
      <div className="flex items-center gap-1.5 border-b border-amber-200/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">
        <Boxes size={12} /> Brakujący surowiec na resztę zamówienia
      </div>
      <ul className="divide-y divide-amber-200/50">
        {rows.map(t => (
          <li key={t.rawTypeId} className="flex items-baseline gap-2 px-3 py-1.5 text-xs">
            <Dot rawTypeId={t.rawTypeId} />
            <span className="text-ink-2">{t.rawName}</span>
            {t.rawTypeId === CWIARTKA && t.kgMeat > 0 && (
              <span className="text-[10px] text-amber-700/80 tabular-nums">· mięso z/s {fmtKg(t.kgMeat, 0)} kg</span>
            )}
            <span className="ml-auto text-amber-900"><Kg value={t.kgRaw} /></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
