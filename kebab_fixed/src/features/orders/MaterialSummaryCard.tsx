import { useEffect, useState } from 'react'
import { Boxes, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { materialRequirementsApi, type RequirementsSummary, type RawRequirementTotal, type NetShortageRow } from '@/lib/api'
import { CWIARTKA, accentOf, Dot, Kg } from './material-ui'

export function MaterialSummaryCard() {
  const [data, setData] = useState<RequirementsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    materialRequirementsApi.summary()
      .then(d => { if (alive) setData(d) })
      .catch(err => { console.error('podsumowanie zapotrzebowania:', err); if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <SummarySkeleton />
  if (!data) return null
  const shortages = data.netShortage.filter(s => s.kgNetShortage > 0)
  const covered = shortages.length === 0

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-white shadow-sm">
      {/* Nagłówek */}
      <header className="flex items-center gap-2.5 border-b border-surface-2 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink/5 text-ink-2">
          <Boxes size={15} />
        </span>
        <h2 className="text-[13px] font-bold tracking-tight text-ink">Surowiec do realizacji zamówień</h2>
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-ink-2">
          wydajność rozbioru {fmtPct(data.yieldPct, 0)}
        </span>
      </header>

      {/* HERO: do dokupienia / rozbioru (akcja) */}
      <div className={`px-4 py-3 ${covered ? 'bg-emerald-50/50' : 'bg-rose-50/50'}`}>
        <div className="mb-2 flex items-center gap-1.5">
          {covered
            ? <CheckCircle2 size={13} className="text-emerald-600" />
            : <AlertTriangle size={13} className="text-rose-600" />}
          <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${covered ? 'text-emerald-700' : 'text-rose-700'}`}>
            Do dokupienia / rozbioru
          </span>
          <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">· netto vs magazyn</span>
        </div>
        {covered ? (
          <p className="text-sm font-semibold text-emerald-700">Magazyn i produkcja pokrywają całe zapotrzebowanie.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shortages.map(s => <ShortageTile key={s.rawTypeId} s={s} />)}
          </div>
        )}
      </div>

      {/* Kontekst: całość + pozostało */}
      <div className="grid gap-px bg-surface-2 sm:grid-cols-2">
        <ContextCol title="Zapotrzebowanie (całość)" rows={data.total} />
        <ContextCol title="Pozostało do zrobienia" rows={data.remaining} />
      </div>
    </section>
  )
}

/** Kafelek niedoboru — liczba jako bohater + kontekst pod spodem. */
function ShortageTile({ s }: { s: NetShortageRow }) {
  const a = accentOf(s.rawTypeId)
  return (
    <div className="rounded-lg border border-rose-200/70 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Dot rawTypeId={s.rawTypeId} />
        <span className="truncate text-[11px] font-medium text-ink-2">{s.rawName}</span>
      </div>
      <div className="mt-0.5 text-lg leading-tight text-rose-700">
        <Kg value={s.kgNetShortage} />
      </div>
      <div className="mt-0.5 space-y-0.5 text-[10px] leading-tight text-muted-foreground tabular-nums">
        {s.rawTypeId === CWIARTKA && s.kgMeat > 0 && (
          <div>z tego mięso z/s: <span className="font-semibold text-rose-600/90">{fmtKg(s.kgMeat, 0)} kg</span></div>
        )}
        <div>w magazynie: {fmtKg(s.kgAvailable, 0)} kg</div>
      </div>
      <span className={`mt-1 block h-0.5 w-8 rounded-full ${a.dot} opacity-60`} />
    </div>
  )
}

/** Kolumna kontekstowa (całość / pozostało) — gęsta lista materiałów. */
function ContextCol({ title, rows }: { title: string; rows: RawRequirementTotal[] }) {
  const nonZero = rows.filter(r => r.kgRaw > 0)
  return (
    <div className="bg-white px-4 py-2.5">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{title}</div>
      {nonZero.length === 0 ? (
        <div className="text-xs text-muted-foreground">—</div>
      ) : (
        <ul className="space-y-1">
          {nonZero.map(r => (
            <li key={r.rawTypeId} className="flex items-baseline gap-2 text-xs leading-relaxed">
              <Dot rawTypeId={r.rawTypeId} />
              <span className="text-ink-2">{r.rawName}</span>
              {r.rawTypeId === CWIARTKA && r.kgMeat > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">· mięso z/s {fmtKg(r.kgMeat, 0)} kg</span>
              )}
              <span className="ml-auto text-ink"><Kg value={r.kgRaw} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SummarySkeleton() {
  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-surface-2 px-4 py-2.5">
        <span className="h-7 w-7 rounded-lg bg-surface-2" />
        <span className="h-3.5 w-56 rounded bg-surface-2" />
      </div>
      <div className="space-y-2 px-4 py-3">
        <span className="block h-2.5 w-32 rounded bg-surface-2" />
        <div className="grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-lg bg-surface-2/70" />)}
        </div>
      </div>
    </section>
  )
}
