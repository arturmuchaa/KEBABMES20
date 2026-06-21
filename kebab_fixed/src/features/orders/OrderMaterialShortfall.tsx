import { useEffect, useState } from 'react'
import { Boxes, CheckCircle2 } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements } from '@/lib/api'
import { CWIARTKA, accentOf, Dot } from './material-ui'

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
    <div className="mb-3 overflow-hidden rounded-xl border border-amber-300/70 bg-white shadow-sm">
      <header className="flex items-center gap-1.5 border-b border-amber-100 bg-amber-50/60 px-3 py-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/15 text-amber-700">
          <Boxes size={12} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">Brakujący surowiec na resztę zamówienia</span>
      </header>
      <ul className="divide-y divide-surface-2">
        {rows.map(t => {
          const a = accentOf(t.rawTypeId)
          return (
            <li key={t.rawTypeId} className="relative flex items-center gap-2 py-1.5 pl-3.5 pr-3">
              <span className={`absolute inset-y-1 left-0 w-1 rounded-full ${a.dot}`} aria-hidden />
              <Dot rawTypeId={t.rawTypeId} />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-ink">{t.rawName}</div>
                {t.rawTypeId === CWIARTKA && t.kgMeat > 0 && (
                  <div className="text-[10px] leading-tight text-muted-foreground tabular-nums">z tego mięso z/s: {fmtKg(t.kgMeat, 0)} kg</div>
                )}
              </div>
              <div className="ml-auto text-base font-black tabular-nums text-ink">
                {fmtKg(t.kgRaw, 0)}<span className="ml-0.5 text-[11px] font-semibold text-muted-foreground">kg</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
