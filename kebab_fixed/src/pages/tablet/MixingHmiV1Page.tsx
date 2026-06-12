/**
 * HMI v1 — masowanie pod panel nierdzewny 21" (landscape), paleta
 * „Porcelana" jak rozbiór v8: biel techniczna + stalowa szarość + atrament.
 *
 * Układ: lewa szyna = PLAN DNIA (cały plan biura w kolejności 1→n,
 * statusy, postęp kg) — operator widzi wszystko i może zaplanować pracę.
 * Biuro edytuje plan w ciągu dnia → szyna odświeża się sama i pokazuje
 * baner „PLAN ZMIENIONY”. Prawa strona = przebieg pracy (maszyna →
 * mięso → składniki → koniec) — logika 1:1 z dotychczasowego ekranu.
 */
import { useEffect, useRef, useState, memo, type CSSProperties } from 'react'
import { mixingOrdersApi } from '@/lib/apiClient'
import { fmtKg } from '@/lib/utils'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { MixingTabletPage } from '@/pages/tablet/MixingTabletPage'

const VARS: CSSProperties = {
  ['--app' as string]:   '#EDF0F4',
  ['--panel' as string]: '#FFFFFF',
  ['--bd' as string]:    '#CDD5DE',
  ['--ink' as string]:   '#101820',
  ['--mut' as string]:   '#71808F',
  ['--grn' as string]:   '#15803D',
  ['--amb' as string]:   '#B45309',
  ['--red' as string]:   '#C0271E',
}

const Clock = memo(function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="font-mono text-2xl font-black tabular-nums" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
})

interface PlanItem {
  id: string; orderNo: string; recipeName: string
  meatKg: number; kgDone: number; status: string; daySeq: number
}

const ITEM_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  planned:     { label: 'W KOLEJCE',   color: 'var(--mut)', bg: 'var(--panel)' },
  confirmed:   { label: 'W KOLEJCE',   color: 'var(--mut)', bg: 'var(--panel)' },
  in_progress: { label: 'W MASOWNICY', color: 'var(--amb)', bg: '#FDF3E7' },
  done:        { label: 'GOTOWE',      color: 'var(--grn)', bg: '#EBF7EF' },
}

function PlanRail() {
  const [items, setItems] = useState<PlanItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [changed, setChanged] = useState(false)
  const revRef = useRef<string>('')

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const r = await mixingOrdersApi.dayPlan()
        if (cancelled) return
        const next = (r.items ?? []).map((o: any) => ({
          id: o.id, orderNo: o.orderNo, recipeName: o.recipeName,
          meatKg: o.meatKg, kgDone: o.kgDone, status: o.status, daySeq: o.daySeq,
        }))
        // Biuro zmieniło plan → baner (pierwsze załadowanie nie liczy się)
        if (revRef.current && r.rev !== revRef.current) {
          setChanged(true)
          setTimeout(() => setChanged(false), 30000)
        }
        revRef.current = r.rev
        setItems(next)
        setLoaded(true)
      } catch { setLoaded(true) }
    }
    poll()
    const t = setInterval(poll, 10000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const totalKg = items.reduce((s, i) => s + i.meatKg, 0)
  const doneKg  = items.reduce((s, i) => s + Math.min(i.kgDone, i.meatKg), 0)
  // Następna pozycja do roboty = pierwsza nie-gotowa
  const nextIdx = items.findIndex(i => i.status !== 'done')

  return (
    <aside className="w-[340px] flex-shrink-0 flex flex-col min-h-0 border-r-[3px]"
      style={{ borderColor: 'var(--bd)', background: 'var(--app)' }}>
      {/* Nagłówek szyny */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays size={18} style={{ color: 'var(--ink)' }} />
          <span className="text-[15px] font-black uppercase tracking-[.18em]" style={{ color: 'var(--ink)' }}>
            Plan dnia
          </span>
        </div>
        {loaded && items.length > 0 && (
          <div className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--mut)' }}>
            {fmtKg(doneKg, 0)} / {fmtKg(totalKg, 0)} kg · {items.filter(i => i.status === 'done').length}/{items.length} zleceń
          </div>
        )}
      </div>

      {/* Baner zmiany planu */}
      {changed && (
        <div className="mx-3 mb-2 rounded-xl border-[3px] px-3 py-2.5 flex items-center gap-2 flex-shrink-0 animate-pulse"
          style={{ borderColor: 'var(--amb)', background: '#FDF3E7', color: 'var(--amb)' }}>
          <RefreshCw size={18} />
          <span className="text-[14px] font-black uppercase leading-tight">Plan zmieniony przez biuro</span>
        </div>
      )}

      {/* Kolejka */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2">
        {!loaded ? (
          <div className="text-center py-8 text-[14px] font-bold" style={{ color: 'var(--mut)' }}>Wczytuję…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border-[3px] border-dashed px-4 py-8 text-center text-[14px] font-bold"
            style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
            Brak planu na dziś.<br/>Biuro ułoży plan w „Planowanie masowania”.
          </div>
        ) : items.map((it, i) => {
          const st = ITEM_STATUS[it.status] ?? ITEM_STATUS.planned
          const isNext = i === nextIdx && it.status !== 'in_progress'
          const pct = it.meatKg > 0 ? Math.min(100, (it.kgDone / it.meatKg) * 100) : 0
          return (
            <div key={it.id}
              className="rounded-xl border-[3px] px-3 py-2.5"
              style={{
                borderColor: it.status === 'in_progress' ? 'var(--amb)'
                  : isNext ? 'var(--ink)' : 'var(--bd)',
                background: st.bg,
              }}>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full border-[3px] flex items-center justify-center text-[15px] font-black flex-shrink-0"
                  style={it.status === 'done'
                    ? { background: 'var(--grn)', borderColor: 'var(--grn)', color: '#fff' }
                    : { borderColor: st.color, color: st.color, background: 'var(--panel)' }}>
                  {it.status === 'done' ? '✓' : (it.daySeq || i + 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-black truncate" style={{ color: 'var(--ink)' }}>
                    {it.recipeName}
                  </div>
                  <div className="text-[11px] font-bold" style={{ color: st.color }}>
                    {st.label}{isNext ? ' · NASTĘPNE' : ''}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[17px] font-black tabular-nums" style={{ color: 'var(--ink)' }}>
                    {fmtKg(it.meatKg, 0)}
                  </div>
                  <div className="text-[10px] font-bold" style={{ color: 'var(--mut)' }}>kg</div>
                </div>
              </div>
              {it.kgDone > 0 && it.status !== 'done' && (
                <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bd)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--amb)' }}/>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export function MixingHmiV1Page() {
  return (
    <div className="h-screen flex flex-col overflow-hidden select-none" style={{ ...VARS, background: 'var(--app)' }}>
      {/* Nagłówek */}
      <header className="h-14 flex items-center gap-4 px-5 border-b-[3px] flex-shrink-0"
        style={{ borderColor: 'var(--bd)', background: 'var(--panel)' }}>
        <span className="text-[17px] font-black uppercase tracking-[.22em]" style={{ color: 'var(--ink)' }}>
          Masowanie
        </span>
        <span className="text-[12px] font-bold" style={{ color: 'var(--mut)' }}>
          {new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: '2-digit' })}
        </span>
        <div className="flex-1" />
        <Clock />
      </header>

      {/* Trzon: plan dnia | praca */}
      <div className="flex-1 min-h-0 flex">
        <PlanRail />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <MixingTabletPage />
        </main>
      </div>
    </div>
  )
}
