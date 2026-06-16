/**
 * ProductionHistoryPage — Historia produkcji.
 *
 * Bliźniacza do Historii masowania, dla produkcji wyrobu gotowego. Linie planów
 * produkcji pogrupowane po dniach: jaki produkt, ile sztuk/kg, z jakiej partii
 * przyprawionego, dla jakiego zamówienia, w jakim opakowaniu. Czysty odczyt
 * z productionPlansApi.list() (bez nowego backendu).
 *
 * Filtry: status (domyślnie Zakończone), data (wybór dnia), szukaj (produkt/
 * partia/klient). Dni domyślnie ZWINIĘTE — rozwijane klikiem w nagłówek dnia.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { productionPlansApi } from '@/lib/apiClient'
import { fmtKg, cn } from '@/lib/utils'
import {
  Factory, Search, ArrowRight, Box, ChevronDown,
  CalendarDays, CheckCircle2, Clock3, XCircle, CircleDashed, Package, User, ShoppingCart,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Status → wygląd (wspólne z masowaniem dla spójności) ───────────────
const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  DONE:        { label: 'Zakończone',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={12} /> },
  IN_PROGRESS: { label: 'W toku',      cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: <Clock3 size={12} /> },
  PLANNED:     { label: 'Zaplanowane', cls: 'bg-slate-100 text-slate-600 border-slate-200',      icon: <CircleDashed size={12} /> },
  cancelled:   { label: 'Anulowane',   cls: 'bg-rose-50 text-rose-600 border-rose-200',          icon: <XCircle size={12} /> },
}

type StatusFilter = 'done' | 'all' | 'cancelled'
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'done', label: 'Zakończone' },
  { key: 'all', label: 'Wszystkie' },
  { key: 'cancelled', label: 'Anulowane' },
]

const DOW = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
const MON = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']

function prettyDay(iso: string): { weekday: string; rest: string } {
  if (!iso) return { weekday: '', rest: '' }
  const d = new Date(iso + 'T00:00:00')
  return { weekday: DOW[d.getDay()], rest: `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
}
function uniq<T>(xs: T[]): T[] { return Array.from(new Set(xs)) }
// Status efektywny linii: anulowany plan ma priorytet nad statusem linii.
function effStatus(line: any): string {
  return line.planStatus === 'cancelled' ? 'cancelled' : (line.lineStatus || 'PLANNED')
}

// ─── Segmentowany filtr statusu ─────────────────────────────────────────
function SegFilter({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-3 border border-surface-4">
      {STATUS_TABS.map(t => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={cn('h-7 px-3 rounded-md text-[12px] font-semibold transition-colors',
            value === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Karta linii produkcji ──────────────────────────────────────────────
function LineCard({ line }: { line: any }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[effStatus(line)] ?? STATUS.PLANNED
  const qty = Number(line.qty || 0)
  const qtyDone = Number(line.qtyDone || 0)
  const pct = qty > 0 ? Math.min(100, (qtyDone / qty) * 100) : 0
  const totalKg = Number(line.totalKg || 0)

  const seasoned = uniq([...(line.seasonedBatchNos || []), line.seasonedBatchNo].filter(Boolean))
  const workers: any[] = line.workerEntries || []
  const productName = line.recipeName || line.productTypeName || 'Bez produktu'

  return (
    <div className="rounded-xl border border-surface-4 bg-white overflow-hidden transition-shadow hover:shadow-md">
      <button
        onClick={() => workers.length > 0 && setOpen(v => !v)}
        className={cn('w-full text-left px-4 py-3.5 flex items-start gap-4', workers.length > 0 && 'cursor-pointer')}
      >
        <div className="mt-0.5 shrink-0 w-9 h-9 rounded-lg bg-brand-light border border-brand-border flex items-center justify-center">
          <Factory size={17} className="text-brand" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-ink leading-tight">{productName}</span>
            <Badge variant="outline" className={cn('text-[10px] gap-1 font-semibold', st.cls)}>
              {st.icon}{st.label}
            </Badge>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-4">
            {line.planNo}{line.productTypeName && line.recipeName ? ` · ${line.productTypeName}` : ''}
          </div>

          <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[12px]">
            {seasoned.length > 0 && (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <Package size={12} className="text-ink-4" />
                {seasoned.map((b, i) => (
                  <span key={i} className="font-mono font-semibold text-ink-2">{b}{i < seasoned.length - 1 ? ',' : ''}</span>
                ))}
                <ArrowRight size={13} className="text-ink-5" />
                <span className="font-semibold text-ink-2">wyrób</span>
              </span>
            )}
            {line.packagingName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 border border-surface-4 px-2 py-0.5 text-ink-3">
                <Box size={11} /> {line.packagingName}
              </span>
            )}
            {(line.clientName || line.clientOrderNo) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-light border border-brand-border px-2 py-0.5 text-brand-dark">
                <ShoppingCart size={11} /> {line.clientName || line.clientOrderNo}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 w-36 text-right">
          <div className="text-[19px] font-extrabold text-ink tabular-nums leading-none">
            {qtyDone}<span className="text-[12px] font-semibold text-ink-4"> / {qty} szt</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-4 overflow-hidden">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-ink-4">
            <span className="font-semibold text-ink-3 tabular-nums">{fmtKg(totalKg, 0)} kg</span>
            {workers.length > 0 && (
              <ChevronDown size={13} className={cn('inline ml-1 transition-transform text-ink-4', open && 'rotate-180')} />
            )}
          </div>
        </div>
      </button>

      {open && workers.length > 0 && (
        <div className="border-t border-surface-3 bg-surface-2 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-ink-4 font-bold mb-2">Wpisy operatorów ({workers.length})</div>
          <div className="grid gap-1.5">
            {workers.map((w, i) => (
              <div key={i} className="flex items-center gap-3 text-[12px] rounded-lg bg-white border border-surface-4 px-3 py-2">
                <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
                  <User size={12} className="text-ink-4" /> {w.workerName || w.worker_name || w.name || 'Operator'}
                </span>
                <span className="ml-auto font-semibold text-ink-2 tabular-nums">{Number(w.qty ?? w.qtyDone ?? 0)} szt</span>
                <span className="text-[11px] text-ink-4 w-12 text-right tabular-nums">{String(w.at || w.createdAt || '').slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Strona ─────────────────────────────────────────────────────────────
export function ProductionHistoryPage() {
  const { data, loading } = useApi<any[]>(() => productionPlansApi.list())
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('done')
  const [date, setDate] = useState('')
  const [openDays, setOpenDays] = useState<Set<string>>(new Set())

  const toggleDay = (k: string) => setOpenDays(prev => {
    const next = new Set(prev)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })

  const days = useMemo(() => {
    const lines: any[] = []
    for (const p of data || []) {
      const day = String(p.planDate || p.createdAt || '').slice(0, 10)
      for (const ln of p.lines || []) {
        lines.push({ ...ln, planNo: p.planNo, planDate: day, planStatus: p.status })
      }
    }
    const filtered = lines.filter(ln => {
      const es = effStatus(ln)
      if (status === 'done' && es !== 'DONE') return false
      if (status === 'cancelled' && es !== 'cancelled') return false
      if (date && ln.planDate !== date) return false
      if (q.trim()) {
        const hay = `${ln.recipeName} ${ln.productTypeName} ${ln.planNo} ${ln.clientName} ${ln.clientOrderNo} ${(ln.seasonedBatchNos || []).join(' ')}`.toLowerCase()
        if (!hay.includes(q.trim().toLowerCase())) return false
      }
      return true
    })
    const groups = new Map<string, any[]>()
    for (const ln of filtered) {
      if (!groups.has(ln.planDate)) groups.set(ln.planDate, [])
      groups.get(ln.planDate)!.push(ln)
    }
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, ls]) => ({
        key: k,
        ...prettyDay(k),
        lines: ls,
        qtyDone: ls.reduce((s, l) => s + Number(l.qtyDone || 0), 0),
        kg: ls.reduce((s, l) => s + Number(l.totalKg || 0), 0),
      }))
  }, [data, q, status, date])

  const forceOpen = Boolean(q.trim() || date)

  return (
    <div className="min-h-full bg-surface-2">
      <div className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur border-b border-surface-4 px-6 py-4">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
                <Factory size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-ink leading-tight">Historia produkcji</h1>
                <p className="text-[12px] text-ink-3">Produkcja wyrobu per dzień — produkt, sztuki/kg, partia przyprawionego i zamówienie</p>
              </div>
            </div>
            <div className="relative w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj: produkt, klient, partia…" className="pl-9 h-9 bg-white" />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <SegFilter value={status} onChange={setStatus} />
            <div className="flex items-center gap-1.5">
              <CalendarDays size={14} className="text-ink-4" />
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-7 w-40 bg-white text-[12px]" />
              {date && <button onClick={() => setDate('')} className="text-[12px] text-ink-3 hover:text-ink underline">wyczyść</button>}
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
              <Factory size={26} className="text-ink-4" />
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
                  <button onClick={() => toggleDay(d.key)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
                    <ChevronDown size={16} className={cn('text-ink-4 transition-transform', isOpen && 'rotate-180')} />
                    <CalendarDays size={16} className="text-brand" />
                    <span className="text-[15px] font-extrabold text-ink capitalize">{d.weekday}</span>
                    <span className="text-[13px] text-ink-3">{d.rest}</span>
                    <div className="h-px flex-1 bg-surface-4" />
                    <div className="text-[12px] text-ink-3 flex items-center gap-3">
                      <span>{d.lines.length} poz.</span>
                      <span className="font-semibold text-ink-2 tabular-nums">{d.qtyDone} szt</span>
                      <span className="text-emerald-700 font-semibold tabular-nums">{fmtKg(d.kg, 0)} kg</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="space-y-2.5 px-3 pb-3 pt-1 bg-surface-2">
                      {d.lines.map((ln: any) => <LineCard key={ln.id} line={ln} />)}
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
