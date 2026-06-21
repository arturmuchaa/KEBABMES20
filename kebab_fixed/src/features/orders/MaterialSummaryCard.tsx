import { useEffect, useState } from 'react'
import { Boxes, AlertTriangle } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { materialRequirementsApi, type RequirementsSummary, type RawRequirementTotal } from '@/lib/api'

export function MaterialSummaryCard() {
  const [data, setData] = useState<RequirementsSummary | null>(null)
  useEffect(() => {
    materialRequirementsApi.summary()
      .then(setData)
      .catch(err => { console.error('podsumowanie zapotrzebowania:', err); setData(null) })
  }, [])
  if (!data) return null
  const shortages = data.netShortage.filter(s => s.kgNetShortage > 0)

  return (
    <div className="rounded-xl border border-surface-3 bg-white p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-2">
        <Boxes size={14} /> Surowiec do realizacji wszystkich zamówień
        <span className="ml-auto font-normal normal-case text-muted-foreground">wydajność rozbioru {fmtPct(data.yieldPct, 0)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCol title="Zapotrzebowanie (całość)" rows={data.total} />
        <SummaryCol title="Pozostało do zrobienia" rows={data.remaining} />
        <div>
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Niedobór netto vs magazyn</div>
          {shortages.length === 0 ? (
            <div className="text-xs text-emerald-700">Magazyn pokrywa zapotrzebowanie ✓</div>
          ) : (
            shortages.map(s => (
              <div key={s.rawTypeId} className="flex items-center gap-1.5 text-xs tabular-nums">
                <AlertTriangle size={12} className="text-red-600 shrink-0" />
                <span className="text-muted-foreground">{s.rawName}:</span>
                <span className="font-bold text-red-700">{fmtKg(s.kgNetShortage, 0)} kg</span>
                <span className="text-[10px] text-muted-foreground">(jest {fmtKg(s.kgAvailable, 0)})</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCol({ title, rows }: { title: string; rows: RawRequirementTotal[] }) {
  const nonZero = rows.filter(r => r.kgRaw > 0)
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{title}</div>
      {nonZero.length === 0 ? (
        <div className="text-xs text-muted-foreground">—</div>
      ) : (
        nonZero.map(r => (
          <div key={r.rawTypeId} className="flex justify-between text-xs tabular-nums">
            <span className="text-muted-foreground">{r.rawName}</span>
            <span className="font-bold text-ink">{fmtKg(r.kgRaw, 0)} kg</span>
          </div>
        ))
      )}
    </div>
  )
}
