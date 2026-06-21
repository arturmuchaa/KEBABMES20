import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements, type PreviewItem } from '@/lib/api'

export function MaterialRequirementsPanel({ items }: { items: PreviewItem[] }) {
  const [data, setData] = useState<MaterialRequirements | null>(null)
  const valid = items.filter(i => i.qty > 0 && i.kgPerUnit > 0)
  const key = JSON.stringify(valid)

  useEffect(() => {
    if (valid.length === 0) { setData(null); return }
    let alive = true
    const t = setTimeout(() => {
      materialRequirementsApi.preview(valid)
        .then(d => { if (alive) setData(d) })
        .catch(err => { console.error('preview zapotrzebowania:', err); if (alive) setData(null) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || data.totalsByRaw.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
        <Boxes size={13} /> Potrzebny surowiec
        <span className="ml-auto font-normal normal-case text-amber-700">wydajność {fmtPct(data.yieldPct, 0)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {data.totalsByRaw.map(t => (
          <span key={t.rawTypeId} className="tabular-nums">
            <span className="text-muted-foreground">{t.rawName}:</span>{' '}
            <span className="font-bold text-amber-900">{fmtKg(t.kgRaw, 0)} kg</span>
            {t.rawTypeId === 'mat-cwiartka' && t.kgMeat > 0 && (
              <span className="text-[10px] text-amber-700"> (mięso z/s: {fmtKg(t.kgMeat, 0)} kg)</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
