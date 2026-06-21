import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { materialRequirementsApi, type MaterialRequirements, type PreviewItem } from '@/lib/api'
import { CWIARTKA, accentOf, Dot } from '../material-ui'

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
    <div className="overflow-hidden rounded-xl border border-amber-300/70 bg-white shadow-sm">
      <header className="flex items-center gap-1.5 border-b border-amber-100 bg-amber-50/60 px-3 py-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/15 text-amber-700">
          <Boxes size={12} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">Potrzebny surowiec</span>
        <span className="ml-auto text-[10px] tabular-nums text-amber-700/70">wydajność {fmtPct(data.yieldPct, 0)}</span>
      </header>
      <ul className="divide-y divide-surface-2">
        {data.totalsByRaw.map(t => {
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
