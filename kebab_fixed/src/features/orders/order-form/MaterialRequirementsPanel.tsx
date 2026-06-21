import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements, type PreviewItem } from '@/lib/api'
import { CWIARTKA, Dot, Kg } from '../material-ui'

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
    <div className="overflow-hidden rounded-lg border border-amber-300/80 bg-amber-50/50">
      <div className="flex items-center gap-1.5 border-b border-amber-200/70 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">
        <Boxes size={12} /> Potrzebny surowiec
        <span className="ml-auto font-normal normal-case tracking-normal text-amber-700/80 tabular-nums">wydajność {fmtPct(data.yieldPct, 0)}</span>
      </div>
      <ul className="divide-y divide-amber-200/50">
        {data.totalsByRaw.map(t => (
          <li key={t.rawTypeId} className="flex items-baseline gap-2 px-2.5 py-1.5 text-xs">
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
