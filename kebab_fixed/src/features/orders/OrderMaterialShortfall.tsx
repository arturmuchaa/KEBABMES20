import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements } from '@/lib/api'

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
      <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
        Surowiec na resztę: nic nie brakuje — całość zaraportowana ✓
      </div>
    )
  }

  return (
    <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
        <Boxes size={12} /> Brakujący surowiec na resztę zamówienia
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
        {rows.map(t => (
          <span key={t.rawTypeId}>
            <span className="text-muted-foreground">{t.rawName}:</span>{' '}
            <span className="font-bold text-amber-900">{fmtKg(t.kgRaw, 0)} kg</span>
          </span>
        ))}
      </div>
    </div>
  )
}
