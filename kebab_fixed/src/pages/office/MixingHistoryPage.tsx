/**
 * MixingHistoryPage — Historia masowania.
 *
 * Przegląd zleceń masowania pogrupowanych po dniach: co zmasowano, ile kg,
 * z jakiej partii mięsa, na jakich masownicach i jaka partia przyprawionego
 * powstała. Czysty odczyt z mixingOrdersApi.list() (bez nowego backendu).
 *
 * Filtry: status (domyślnie Zakończone), data (wybór dnia), szukaj (produkt/
 * partia/nr). Dni domyślnie ZWINIĘTE — rozwijane klikiem w nagłówek dnia.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { mixingOrdersApi } from '@/lib/apiClient'
import { fmtKg, cn } from '@/lib/utils'
import {
  Layers, Search, Beef, ArrowRight, Cog, ChevronDown,
  CalendarDays, CheckCircle2, Clock3, XCircle, CircleDashed, Package,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Status → wygląd ────────────────────────────────────────────────────
const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  done:        { label: 'Zakończone',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={12} /> },
  in_progress: { label: 'W toku',      cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: <Clock3 size={12} /> },
  planned:     { label: 'Zaplanowane', cls: 'bg-slate-100 text-slate-600 border-slate-200',      icon: <CircleDashed size={12} /> },
  cancelled:   { label: 'Anulowane',   cls: 'bg-rose-50 text-rose-600 border-rose-200',          icon: <XCircle size={12} /> },
}

// Filtr statusu: domyślnie tylko zakończone.
type StatusFilter = 'done' | 'all' | 'cancelled'
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'done', label: 'Zakończone' },
  { key: 'all', label: 'Wszystkie' },
  { key: 'cancelled', label: 'Anulowane' },
]

const DOW = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
const MON = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']

function dayKey(o: any): string { return String(o.createdAt || '').slice(0, 10) }
function prettyDay(iso: string): { weekday: string; rest: string } {
  if (!iso) return { weekday: '', rest: '' }
  const d = new Date(iso + 'T00:00:00')
  return { weekday: DOW[d.getDay()], rest: `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
}
function uniq<T>(xs: T[]): T[] { return Array.from(new Set(xs)) }

// ─── Segmentowany filtr statusu ─────────────────────────────────────────
function SegFilter({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-3 border border-surface-4">
      {STATUS_TABS.map(t => (
        <button key={t.key} type="button" aria-pressed={value === t.key} onClick={() => onChange(t.key)}
          className={cn('h-7 px-3 rounded-md text-[12px] font-semibold transition-colors cursor-pointer',
            value === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Karta zlecenia ─────────────────────────────────────────────────────
function OrderCard({ o }: { o: any }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[o.status] ?? STATUS.planned
  const meatKg = Number(o.meatKg || 0)
  const kgDone = Number(o.kgDone || 0)
  const pct = meatKg > 0 ? Math.min(100, (kgDone / meatKg) * 100) : 0

  const sessions: any[] = o.sessions || []
  const lots: any[] = o.meatLots || []
  const machines = uniq(sessions.map(s => s.machineId).filter(Boolean)).sort()
  const rawBatches = uniq(lots.map(l => l.rawBatchNo).filter(Boolean))
  const outBatches = uniq(sessions.map(s => s.batchNo).filter(Boolean))
  const kgOutput = sessions.reduce((s, x) => s + Number(x.kgOutput || 0), 0)

  return (
    <div className="rounded-xl border border-surface-4 bg-white overflow-hidden transition-shadow hover:shadow-md">
      <button
        onClick={() => sessions.length > 0 && setOpen(v => !v)}
        className={cn('w-full text-left px-4 py-3.5 flex items-start gap-4', sessions.length > 0 && 'cursor-pointer')}
      >
        <div className="mt-0.5 shrink-0 w-9 h-9 rounded-lg bg-brand-light border border-brand-border flex items-center justify-center">
          <Beef size={17} className="text-brand" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-ink leading-tight">{o.recipeName || 'Bez receptury'}</span>
            <Badge variant="outline" className={cn('text-[10px] gap-1 font-semibold', st.cls)}>
              {st.icon}{st.label}
            </Badge>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-3">{o.orderNo}</div>

          <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[12px]">
            {rawBatches.length > 0 && (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <Package size={12} className="text-ink-4" />
                {rawBatches.map((b, i) => (
                  <span key={i} className="font-mono font-semibold text-ink-2">{b}{i < rawBatches.length - 1 ? ',' : ''}</span>
                ))}
              </span>
            )}
            {rawBatches.length > 0 && outBatches.length > 0 && <ArrowRight size={13} className="text-ink-5" />}
            {outBatches.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono font-semibold text-emerald-700">
                partia {b}
              </span>
            ))}
            {machines.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 border border-surface-4 px-2 py-0.5 text-ink-3">
                <Cog size={11} /> {machines.map(m => `M${m}`).join(' · ')}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 w-36 text-right">
          <div className="text-[19px] font-extrabold text-ink tabular-nums leading-none">
            {fmtKg(kgDone, 0)}<span className="text-[12px] font-semibold text-ink-4"> / {fmtKg(meatKg, 0)} kg</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-4 overflow-hidden">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-ink-3">
            uzysk <span className="font-semibold text-ink-2 tabular-nums">{fmtKg(kgOutput, 0)} kg</span>
            {sessions.length > 0 && (
              <ChevronDown size={13} className={cn('inline ml-1 transition-transform text-ink-4', open && 'rotate-180')} />
            )}
          </div>
        </div>
      </button>

      {open && sessions.length > 0 && (
        <div className="border-t border-surface-3 bg-surface-2 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-ink-4 font-bold mb-2">Wsady ({sessions.length})</div>
          <div className="grid gap-1.5">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-[12px] rounded-lg bg-white border border-surface-4 px-3 py-2">
                <span className="inline-flex items-center gap-1 font-semibold text-ink-2 w-16">
                  <Cog size={12} className="text-ink-4" /> Masown. {s.machineId}
                </span>
                <span className="text-ink-3 tabular-nums">{fmtKg(s.kgMeat, 0)} kg mięsa</span>
                <ArrowRight size={12} className="text-ink-5" />
                <span className="font-semibold text-ink-2 tabular-nums">{fmtKg(s.kgOutput, 0)} kg uzysku</span>
                {s.batchNo && <span className="ml-auto font-mono text-[11px] text-emerald-700">partia {s.batchNo}</span>}
                <span className="text-[11px] text-ink-4 w-12 text-right tabular-nums">{String(s.completedAt || '').slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Strona ─────────────────────────────────────────────────────────────
export function MixingHistoryPage() {
  const { data, loading } = useApi<any[]>(() => mixingOrdersApi.list())
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('done')
  const [date, setDate] = useState('')           // '' = wszystkie dni
  const [openDays, setOpenDays] = useState<Set<string>>(new Set())  // domyślnie wszystkie zwinięte

  const toggleDay = (k: string) => setOpenDays(prev => {
    const next = new Set(prev)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })

  const days = useMemo(() => {
    const orders = (data || []).filter(o => {
      if (status === 'done' && o.status !== 'done') return false
      if (status === 'cancelled' && o.status !== 'cancelled') return false
      if (date && dayKey(o) !== date) return false
      if (q.trim()) {
        const hay = `${o.recipeName} ${o.orderNo} ${(o.meatLots || []).map((l: any) => l.rawBatchNo).join(' ')} ${(o.sessions || []).map((s: any) => s.batchNo).join(' ')}`.toLowerCase()
        if (!hay.includes(q.trim().toLowerCase())) return false
      }
      return true
    })
    const groups = new Map<string, any[]>()
    for (const o of orders) {
      const k = dayKey(o)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(o)
    }
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, os]) => ({
        key: k,
        ...prettyDay(k),
        orders: os.sort((a, b) => (a.daySeq || 999) - (b.daySeq || 999) || (a.createdAt < b.createdAt ? 1 : -1)),
        kgDone: os.reduce((s, o) => s + Number(o.kgDone || 0), 0),
        kgOutput: os.reduce((s, o) => s + (o.sessions || []).reduce((ss: number, x: any) => ss + Number(x.kgOutput || 0), 0), 0),
      }))
  }, [data, q, status, date])

  // Gdy aktywne szukanie/data — rozwiń automatycznie (łatwiej znaleźć wynik).
  const forceOpen = Boolean(q.trim() || date)

  return (
    <div className="min-h-full bg-surface-2">
      {/* Nagłówek + filtry */}
      <div className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur border-b border-surface-4 px-6 py-4">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
                <Layers size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-ink leading-tight">Historia masowania</h1>
                <p className="text-[12px] text-ink-3">Zlecenia masowania per dzień — produkt, kg, partia mięsa i uzysku</p>
              </div>
            </div>
            <div className="relative w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <Input value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj w historii masowania" placeholder="Szukaj: produkt, partia, nr…" className="pl-9 h-9 bg-white" />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <SegFilter value={status} onChange={setStatus} />
            <div className="flex items-center gap-1.5">
              <CalendarDays size={14} className="text-ink-4" />
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Filtruj po dacie" className="h-7 w-40 bg-white text-[12px]" />
              {date && (
                <button onClick={() => setDate('')} className="text-[12px] text-ink-3 hover:text-ink underline">wyczyść</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : days.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center mb-3">
              <Layers size={26} className="text-ink-4" />
            </div>
            <div className="text-lg font-bold text-ink-2">Brak wyników</div>
            <div className="text-[13px] text-ink-4 mt-1">Zmień filtr statusu, datę lub wyszukiwanie.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {days.map(d => {
              const isOpen = forceOpen || openDays.has(d.key)
              return (
                <section key={d.key} className="rounded-xl border border-surface-4 bg-white overflow-hidden">
                  <button onClick={() => toggleDay(d.key)} aria-expanded={isOpen}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors cursor-pointer">
                    <ChevronDown size={16} className={cn('text-ink-4 transition-transform', isOpen && 'rotate-180')} />
                    <CalendarDays size={16} className="text-brand" />
                    <span className="text-[15px] font-extrabold text-ink capitalize">{d.weekday}</span>
                    <span className="text-[13px] text-ink-3">{d.rest}</span>
                    <div className="h-px flex-1 bg-surface-4" />
                    <div className="text-[12px] text-ink-3 flex items-center gap-3">
                      <span>{d.orders.length} zlec.</span>
                      <span className="font-semibold text-ink-2 tabular-nums">{fmtKg(d.kgDone, 0)} kg mięsa</span>
                      <span className="text-emerald-700 font-semibold tabular-nums">{fmtKg(d.kgOutput, 0)} kg uzysku</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="space-y-2.5 px-3 pb-3 pt-1 bg-surface-2">
                      {d.orders.map((o: any) => <OrderCard key={o.id} o={o} />)}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
