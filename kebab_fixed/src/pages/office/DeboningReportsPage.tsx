/**
 * DeboningReportsPage — Rozbiór: monitoring i statystyki dla biura.
 *
 * Zastępuje stary panel „sesje rozbioru". Pełny dashboard: wybór zakresu
 * (dziś/wczoraj/7 dni/miesiąc/rok/własny), KPI, wykres przepustowości,
 * ranking pracowników (kto najwięcej, kto najlepszy %) i live-feed (gdy dziś).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { deboningApi, type DeboningStats, type DeboningStatsWorker } from '@/lib/api'
import { ChangeBatchDialog, EntryCorrectionDialog } from '@/features/deboning/EntryFixDialogs'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import {
  Scissors, Beef, Gauge, Percent, Users, Bone, Layers, Radio, CalendarDays, X,
  Package, Scale, Truck, Banknote, Printer, ArrowLeftRight, PencilLine, ListChecks,
  ChevronUp, ChevronDown,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, LineChart, Line, ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// ─── Zakresy dat ─────────────────────────────────────────────
type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'year' | 'custom'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today',     label: 'Dziś' },
  { key: 'yesterday', label: 'Wczoraj' },
  { key: '7d',        label: '7 dni' },
  { key: 'month',     label: 'Miesiąc' },
  { key: 'year',      label: 'Rok' },
  { key: 'custom',    label: 'Zakres' },
]

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function resolveRange(preset: Preset, cf: string, ct: string): { from: string; to: string } {
  const now = new Date()
  const today = ymd(now)
  switch (preset) {
    case 'today':     return { from: today, to: today }
    case 'yesterday': { const y = new Date(now); y.setDate(now.getDate() - 1); const d = ymd(y); return { from: d, to: d } }
    case '7d':        { const st = new Date(now); st.setDate(now.getDate() - 6); return { from: ymd(st), to: today } }
    case 'month':     return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
    case 'year':      return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: today }
    case 'custom':    return { from: cf || today, to: ct || today }
  }
}

/** Poprzedni okres o tej samej długości, bezpośrednio przed bieżącym
 *  (dziś → wczoraj, 7 dni → poprzednie 7 dni itd.). */
function prevRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00`)
  const t = new Date(`${to}T00:00:00`)
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1)
  const pt = new Date(f); pt.setDate(f.getDate() - 1)
  const pf = new Date(pt); pf.setDate(pt.getDate() - (days - 1))
  return { from: ymd(pf), to: ymd(pt) }
}

// ─── Formatery ───────────────────────────────────────────────
const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function yieldTone(pct: number): string {
  if (pct >= 66) return 'text-emerald-600'
  if (pct >= 64) return 'text-ink'
  return 'text-amber-600'
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'teraz'
  if (s < 3600) return `${Math.floor(s / 60)} min temu`
  if (s < 86400) return `${Math.floor(s / 3600)} h temu`
  return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
}

// ─── KPI — styl dashboardu (industrial polish: chip ikony, bez pasków) ──
type Accent = 'blue' | 'green' | 'amber' | 'purple' | 'red'
const ACCENT: Record<Accent, string> = {
  blue:   'bg-surface-3 text-ink-2 ring-1 ring-surface-4',
  green:  'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100',
  amber:  'bg-amber-50 text-amber-600 ring-1 ring-amber-100',
  purple: 'bg-surface-3 text-ink-2 ring-1 ring-surface-4',
  red:    'bg-red-50 text-red-600 ring-1 ring-red-100',
}

/** Delta vs poprzedni okres — mała linijka pod wartością KPI. */
function DeltaVsPrev({ cur, prev, fmt, unit, invert }: {
  cur?: number | null; prev?: number | null; fmt: Intl.NumberFormat; unit: string; invert?: boolean
}) {
  if (cur == null || prev == null) return null
  const d = cur - prev
  if (Math.abs(d) < 0.05) return <span className="text-ink-4">= jak w poprzednim okresie</span>
  const up = d > 0
  const good = invert ? !up : up
  return (
    <span className={cn('font-semibold tabular-nums', good ? 'text-emerald-600' : 'text-red-500')}>
      {up ? '▲' : '▼'} {up ? '+' : '−'}{fmt.format(Math.abs(d))} {unit} vs poprz.
    </span>
  )
}

function Kpi({ icon: Icon, label, value, unit, sub, tone, accent, delta }: {
  icon: any; label: string; value: string; unit?: string; sub?: ReactNode; tone?: string; accent: Accent; delta?: ReactNode
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 min-w-0">
            {label}
          </CardDescription>
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', ACCENT[accent])}>
            <Icon size={16} />
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={cn('font-mono text-[26px] font-semibold tabular-nums tracking-tight leading-none', tone ?? 'text-ink')}>
            {value}
          </span>
          {unit && <span className="text-xs font-medium text-ink-3">{unit}</span>}
        </div>
        {sub && <div className="text-[11px] pt-2 text-ink-3">{sub}</div>}
        {delta && <div className="text-[10.5px] pt-1.5">{delta}</div>}
      </CardContent>
    </Card>
  )
}

// ─── Dziennik ważeń ────────────────────────────────────────────
// Jeden wiersz = jedna porcja mięsa faktycznie zważona (waga auto lub
// wpis ręczny) — pełny audyt: brutto, tara wózka, pojemniki E2, netto.
interface TakeWeighing {
  id:             string
  entryId:        string
  kgMeat:         number
  kgGross:        number | null
  tareCartKg:     number | null
  tareE2Kg:       number | null
  e2Count:        number | null
  weighMode:      string | null
  weighedAtLocal: string   // naive local (Europe/Warsaw) datetime z backendu
  dayLocal:       string   // 'YYYY-MM-DD' lokalnie
  workerName:     string
  rawBatchNo:     string
  kgQuarter:      number
  entryStatus:    string
}

function fmtTimePl(iso: string): string {
  const t = iso.slice(11, 16)
  return t || '—'
}
function fmtDayShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
}

function MiniStat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 border border-surface-3 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-4">{label}</div>
      <div className={cn('text-lg font-black [font-variant-numeric:tabular-nums]', tone ?? 'text-ink')}>{value}{unit && <span className="text-[11px] text-ink-4 ml-0.5">{unit}</span>}</div>
    </div>
  )
}

export function DeboningReportsPage() {
  const navigate = useNavigate()
  const [preset, setPreset] = useState<Preset>('today')
  const [cf, setCf] = useState('')
  const [ct, setCt] = useState('')
  const { from, to } = useMemo(() => resolveRange(preset, cf, ct), [preset, cf, ct])
  const isTodayRange = to === ymd(new Date())

  const [data, setData] = useState<DeboningStats | null>(null)
  const [prevData, setPrevData] = useState<DeboningStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [drill, setDrill] = useState<DeboningStatsWorker | null>(null)
  const [weighings, setWeighings] = useState<TakeWeighing[] | null>(null)
  const [showWeighings, setShowWeighings] = useState(true)

  // Korekty wpisu z biura — wspólne modale (EntryFixDialogs) używane też
  // przez Panel rozbioru: „Popraw" (pracownik/kg + powód) i „Zmień partię".
  const [cbEntry, setCbEntry] = useState<any | null>(null)
  const [fixEntry, setFixEntry] = useState<any | null>(null)

  // Kurs EUR z NBP (tabela A) — do przeliczenia kosztu mięsa na €/kg.
  // Ten sam wzorzec co WZ/faktury; brak kursu = po prostu bez linijki euro.
  const [eurRate, setEurRate] = useState<number | null>(null)
  useEffect(() => {
    fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json')
      .then(r => r.json())
      .then(j => { const m = Number(j?.rates?.[0]?.mid); if (m > 0) setEurRate(m) })
      .catch(() => setEurRate(null))
  }, [])

  // LIVE = rozbiór FAKTYCZNIE trwa: ostatni wpis w ciągu 30 minut. Sam zakres
  // „kończący się dziś" nie wystarcza (inaczej świeciło się zawsze).
  const liveNow = useMemo(() => {
    const r = data?.recent?.[0]
    return !!r && (Date.now() - new Date(r.at).getTime()) < 30 * 60 * 1000
  }, [data])
  // Live feed „Ostatnie wpisy" TYLKO na filtrze Dziś — przy Wczoraj/7 dni/
  // Miesiąc to szum; tabela pracowników dostaje wtedy pełną szerokość.
  const showFeed = preset === 'today' && (data?.recent?.length ?? 0) > 0

  const load = useCallback(() => {
    deboningApi.stats(from, to).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
    // Poprzedni okres o tej samej długości — do delt na KPI (▲/▼ vs poprz.).
    const p = prevRange(from, to)
    deboningApi.stats(p.from, p.to).then(setPrevData).catch(() => setPrevData(null))
    deboningApi.weighings(from, to).then(r => setWeighings(r.data ?? [])).catch(() => setWeighings(null))
  }, [from, to])

  useEffect(() => { setLoading(true); load() }, [load])
  // Auto-odświeżanie gdy zakres kończy się dziś (żeby łapać nowe wpisy na żywo).
  useEffect(() => {
    if (!isTodayRange) return
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [isTodayRange, load])

  // ── Kontrola zakresu w nagłówku ──
  usePageHeaderActions(
    <div className="flex items-center gap-2 flex-wrap">
      {liveNow && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold uppercase tracking-wide">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Rozbiór trwa
        </span>
      )}
      <div className="inline-flex items-center rounded-lg border border-surface-4 bg-white p-0.5">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => setPreset(p.key)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
              preset === p.key ? 'bg-brand text-white shadow-sm' : 'text-ink-3 hover:text-ink hover:bg-surface-2',
            )}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="inline-flex items-center gap-1">
          <input type="date" value={cf} max={to} onChange={e => setCf(e.target.value)}
            className="h-8 rounded-md border border-surface-4 px-2 text-xs" />
          <span className="text-ink-4">–</span>
          <input type="date" value={ct} onChange={e => setCt(e.target.value)}
            className="h-8 rounded-md border border-surface-4 px-2 text-xs" />
        </div>
      )}
      <button
        onClick={() => window.open(`/office/rozbior-raport/druk?from=${from}&to=${to}`, '_blank')}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-surface-4 bg-white text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
        title="Raport okresowy do druku / PDF">
        <Printer size={14} />
        Drukuj raport
      </button>
    </div>,
    [preset, cf, ct, liveNow, from, to],
  )

  const s = data?.summary
  // Delty tylko gdy poprzedni okres miał rozbiór (inaczej porównanie z zerem myli).
  const ps = (prevData?.summary?.quarters ?? 0) > 0 ? prevData!.summary : null
  const empty = !loading && (!s || s.quarters === 0)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── KPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-9 gap-3">
        <Kpi icon={Scissors} label="Ćwiartka pobrana" value={nf0.format(s?.kgQuarter ?? 0)} unit="kg" sub={`${nf0.format(s?.quarters ?? 0)} wpisów`} accent="blue"
          delta={<DeltaVsPrev cur={s?.kgQuarter} prev={ps?.kgQuarter} fmt={nf0} unit="kg" />} />
        <Kpi icon={Beef} label="Kg mięsa" value={nf0.format(s?.kgMeat ?? 0)} unit="kg" accent="blue"
          delta={<DeltaVsPrev cur={s?.kgMeat} prev={ps?.kgMeat} fmt={nf0} unit="kg" />} />
        <Kpi icon={Percent} label="Śr. rozbiór" value={nf1.format(s?.avgYield ?? 0)} unit="%" tone={yieldTone(s?.avgYield ?? 0)} accent="green"
          delta={<DeltaVsPrev cur={s?.avgYield} prev={ps?.avgYield} fmt={nf1} unit="p.p." />} />
        <Kpi icon={Gauge} label="Tempo" value={nf0.format(s?.kgPerHour ?? 0)} unit="kg/h" accent="blue"
          delta={<DeltaVsPrev cur={s?.kgPerHour} prev={ps?.kgPerHour} fmt={nf0} unit="kg/h" />} />
        <Kpi icon={Users} label="Pracownicy" value={nf0.format(s?.workers ?? 0)} accent="purple" />
        <Kpi icon={Bone} label="Kości" value={nf0.format(s?.kgBones ?? 0)} unit="kg" sub={`${nf1.format(s?.bonesPct ?? 0)}%`} tone="text-ink-2" accent="amber" />
        <Kpi icon={Layers} label="Grzbiety" value={nf0.format(s?.kgBacks ?? 0)} unit="kg" sub={`${nf1.format(s?.backsPct ?? 0)}%`} tone="text-ink-2" accent="amber" />
        {/* Bilans masy: ćwiartka − (mięso+kości+grzbiety). Dodatni = ubytek
            (coś niezważone, >3% czerwone); ujemny = NADWYŻKA nad wagę
            z dokumentu dostawcy (realny towar > deklaracja — zielone). */}
        {/* Rachunek rozbioru: (koszt ćwiartki + robocizna − sprzedane uboczne) / kg mięsa */}
        <Kpi icon={Banknote} label="Koszt mięsa"
          value={s?.meatCostPerKg != null ? nf2.format(s.meatCostPerKg) : '—'} unit="zł/kg"
          sub={s?.quarterCost != null ? (
            s.meatCostPerKg != null && eurRate != null ? (
              <span>
                <span className="font-bold text-ink-2">≈ {nf2.format(s.meatCostPerKg / eurRate)} €/kg</span>
                <span className="text-ink-4"> · kurs NBP {nf2.format(eurRate)}</span>
              </span>
            ) : undefined
          ) : 'brak cen zakupu w zakresie'}
          accent="green"
          delta={<DeltaVsPrev cur={s?.meatCostPerKg} prev={ps?.meatCostPerKg} fmt={nf2} unit="zł" invert />} />
        {(() => {
          const mk = s?.missingKg ?? 0
          const mp = s?.missingPct ?? 0
          const surplus = mk < 0
          return (
            <Kpi icon={Scale} label="Bilans masy"
              value={surplus ? `+${nf0.format(-mk)}` : nf0.format(mk)} unit="kg"
              sub={surplus ? `nadwyżka ${nf1.format(-mp)}% nad deklarację` : `ubytek ${nf1.format(mp)}% ćwiartki`}
              tone={surplus ? 'text-emerald-600' : mp > 3 ? 'text-red-600' : 'text-ink-2'}
              accent={surplus ? 'green' : mp > 3 ? 'red' : 'green'} />
          )
        })()}
      </div>

      {empty ? (
        <div className="rounded-xl border border-surface-4 bg-white flex flex-col items-center justify-center py-20 gap-2">
          <CalendarDays size={38} className="text-ink-5" />
          <div className="text-sm font-semibold text-ink-3">Brak rozbioru w tym zakresie</div>
          <div className="text-xs text-ink-4">Wybierz inny dzień lub zakres dat u góry.</div>
        </div>
      ) : (
        <>
          {/* ── Uzysk per partia — jakość surowca / dostawcy ── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Package size={15} className="text-ink-3" />
              <h2 className="text-sm font-bold text-ink">Partie</h2>
              <span className="text-[11px] text-ink-4">({data?.byBatch.length ?? 0}) · klik = raport traceability partii</span>
            </div>
            <DataTable
              rows={data?.byBatch ?? []} rowKey={b => b.batchNo}
              initialSort={{ key: 'batchNo', dir: 'desc' }}
              onRowClick={b => { if (b.batchNo !== '—') navigate(`/office/partia/${encodeURIComponent(b.batchNo)}/raport`) }}
              footer={rows => {
                const kq = rows.reduce((a, b) => a + b.kgQuarter, 0)
                const km = rows.reduce((a, b) => a + b.kgMeat, 0)
                const kb = rows.reduce((a, b) => a + b.kgBacks, 0)
                const kk = rows.reduce((a, b) => a + b.kgBones, 0)
                return (
                  <>
                    <span>Razem · {rows.length} part.</span>
                    <span className="ml-auto">Ćwiartka: <b>{nf0.format(kq)} kg</b></span>
                    <span>Mięso: <b className="text-brand">{nf0.format(km)} kg</b>{kq > 0 && <b className={cn('ml-1', yieldTone(km / kq * 100))}>({nf1.format(km / kq * 100)}%)</b>}</span>
                    <span>Grzbiety: <b>{nf0.format(kb)}</b></span>
                    <span>Kości: <b>{nf0.format(kk)}</b></span>
                  </>
                )
              }}
              columns={[
                { key: 'batchNo', header: 'Partia', sortable: true, sortValue: b => b.batchNo, width: 110,
                  cell: b => <code className="font-mono font-bold text-brand">{b.batchNo}</code> },
                { key: 'supplierName', header: 'Dostawca', sortable: true, sortValue: b => b.supplierName,
                  cell: b => b.supplierName
                    ? <span className="text-ink-2 truncate block max-w-[220px]" title={b.supplierName}>{b.supplierName}</span>
                    : <span className="text-ink-4">—</span> },
                { key: 'kgQuarter', header: 'Ćwiartka [kg]', align: 'right', sortable: true, sortValue: b => b.kgQuarter,
                  cell: b => <span className="font-bold tabular-nums">{nf1.format(b.kgQuarter)}</span> },
                { key: 'kgMeat', header: 'Mięso [kg]', align: 'right', sortable: true, sortValue: b => b.kgMeat,
                  cell: b => <span className="font-bold tabular-nums text-brand">{nf1.format(b.kgMeat)}</span> },
                { key: 'yieldPct', header: '% mięsa', align: 'right', sortable: true, sortValue: b => b.yieldPct ?? -1,
                  cell: b => b.yieldPct != null
                    ? <span className={cn('font-black tabular-nums', yieldTone(b.yieldPct))}>{nf1.format(b.yieldPct)}</span>
                    : <span className="text-ink-4">—</span> },
                { key: 'kgBacks', header: 'Grzbiety', align: 'right', sortable: true, sortValue: b => b.kgBacks,
                  cell: b => <span className="tabular-nums text-ink-2">{nf1.format(b.kgBacks)}{b.backsPct != null && <span className="text-[10px] text-ink-4"> ({nf1.format(b.backsPct)}%)</span>}</span> },
                { key: 'kgBones', header: 'Kości', align: 'right', sortable: true, sortValue: b => b.kgBones,
                  cell: b => <span className="tabular-nums text-ink-2">{nf1.format(b.kgBones)}{b.bonesPct != null && <span className="text-[10px] text-ink-4"> ({nf1.format(b.bonesPct)}%)</span>}</span> },
                { key: 'meatCostPerKg', header: 'Koszt mięsa [zł/kg]', align: 'right', sortable: true, sortValue: b => b.meatCostPerKg ?? 999,
                  cell: b => b.meatCostPerKg != null
                    ? <span className="font-black tabular-nums text-ink" title={`ćwiartka ${nf0.format(b.quarterCost ?? 0)} zł + robocizna ${nf0.format(b.laborCost ?? 0)} zł − uboczne ${nf0.format(b.byproductRevenue ?? 0)} zł`}>{nf2.format(b.meatCostPerKg)}</span>
                    : <span className="text-ink-4">—</span> },
                { key: 'missingKg', header: 'Bilans ±', align: 'right', sortable: true, sortValue: b => b.missingKg ?? -999,
                  cell: b => {
                    if (b.missingKg == null) return <span className="text-ink-4">—</span>
                    const surplus = b.missingKg < 0
                    return (
                      <span className={cn('tabular-nums font-semibold',
                        surplus ? 'text-emerald-600' : (b.missingPct ?? 0) > 3 ? 'text-red-600' : 'text-ink-3')}>
                        {surplus ? `+${nf1.format(-b.missingKg)}` : nf1.format(b.missingKg)}
                        {b.missingPct != null && <span className="text-[10px]"> ({surplus ? `+${nf1.format(-b.missingPct)}` : nf1.format(b.missingPct)}%)</span>}
                      </span>
                    )
                  } },
              ]}
            />
          </div>

          {/* ── Dziennik ważeń — każda porcja mięsa zważona, z pełnym audytem wagi ── */}
          <div>
            <button onClick={() => setShowWeighings(v => !v)}
              className="flex items-center gap-2 mb-2 w-full text-left">
              <ListChecks size={15} className="text-ink-3" />
              <h2 className="text-sm font-bold text-ink">Dziennik ważeń</h2>
              <span className="text-[11px] text-ink-4">
                ({weighings?.length ?? 0}) · każda porcja mięsa zważona — brutto / tara / netto
              </span>
              <span className="ml-auto text-ink-4">
                {showWeighings ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </span>
            </button>
            {showWeighings && (
              weighings == null ? (
                <div className="rounded-lg border border-surface-4 bg-white py-6 text-center text-xs text-ink-4">Ładowanie…</div>
              ) : (
                <DataTable
                  rows={weighings} rowKey={w => w.id}
                  searchText={w => `${w.rawBatchNo} ${w.workerName}`}
                  searchPlaceholder="Szukaj partii lub pracownika…"
                  initialSort={{ key: 'weighedAtLocal', dir: 'desc' }}
                  empty={<div className="py-8 text-center text-xs text-ink-4">Brak ważeń w tym zakresie</div>}
                  footer={rows => {
                    const gross = rows.reduce((a, w) => a + (w.kgGross ?? 0), 0)
                    const net = rows.reduce((a, w) => a + w.kgMeat, 0)
                    const carts = rows.filter(w => (w.tareCartKg ?? 0) > 0).length
                    return (
                      <>
                        <span>Razem · {rows.length} ważeń</span>
                        <span>Wózków: <b>{carts}</b></span>
                        <span className="ml-auto">Brutto: <b>{nf1.format(gross)} kg</b></span>
                        <span>Netto mięsa: <b className="text-brand">{nf1.format(net)} kg</b></span>
                      </>
                    )
                  }}
                  columns={[
                    { key: 'weighedAtLocal', header: isTodayRange && from === to ? 'Godzina' : 'Dzień / godzina',
                      sortable: true, sortValue: w => w.weighedAtLocal, width: 110,
                      cell: w => (
                        <span className="tabular-nums text-ink-2">
                          {from === to ? fmtTimePl(w.weighedAtLocal) : `${fmtDayShort(w.dayLocal)} ${fmtTimePl(w.weighedAtLocal)}`}
                        </span>
                      ) },
                    { key: 'rawBatchNo', header: 'Partia', sortable: true, sortValue: w => w.rawBatchNo, width: 90,
                      cell: w => <code className="font-mono font-bold text-brand">{w.rawBatchNo}</code> },
                    { key: 'workerName', header: 'Pracownik', sortable: true, sortValue: w => w.workerName,
                      cell: w => <span className="font-semibold text-ink">{w.workerName}</span> },
                    { key: 'kgGross', header: 'Brutto [kg]', align: 'right', sortable: true, sortValue: w => w.kgGross ?? -1,
                      cell: w => w.kgGross != null
                        ? <span className="tabular-nums text-ink-2">{nf1.format(w.kgGross)}</span>
                        : <span className="text-ink-4">—</span> },
                    { key: 'tareCartKg', header: 'Tara wózka [kg]', align: 'right', sortable: true, sortValue: w => w.tareCartKg ?? -1,
                      cell: w => w.tareCartKg != null
                        ? <span className="tabular-nums text-ink-3">{nf1.format(w.tareCartKg)}</span>
                        : <span className="text-ink-4">—</span> },
                    { key: 'e2', header: 'Pojemniki E2', align: 'right', sortable: true, sortValue: w => w.e2Count ?? -1,
                      cell: w => w.e2Count != null && w.e2Count > 0
                        ? (
                          <span className="tabular-nums text-ink-3">
                            {w.e2Count} szt<span className="text-ink-4 text-[11px]"> · {nf1.format(w.tareE2Kg ?? 0)} kg</span>
                          </span>
                        )
                        : <span className="text-ink-4">—</span> },
                    { key: 'kgMeat', header: 'Netto mięsa [kg]', align: 'right', sortable: true, sortValue: w => w.kgMeat,
                      cell: w => <span className="font-black tabular-nums text-brand">{nf1.format(w.kgMeat)}</span> },
                    { key: 'weighMode', header: 'Tryb', width: 90,
                      cell: w => (
                        <span className={cn(
                          'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                          w.weighMode === 'auto'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-surface-2 text-ink-3 border-surface-4',
                        )}>
                          {w.weighMode === 'auto' ? 'Waga' : 'Ręcznie'}
                        </span>
                      ) },
                    { key: 'entryStatus', header: 'Wpis', width: 90,
                      cell: w => (
                        <span className={cn(
                          'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                          w.entryStatus === 'pending'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-surface-2 text-ink-3 border-surface-4',
                        )}>
                          {w.entryStatus === 'pending' ? 'Trwa' : 'Gotowe'}
                        </span>
                      ) },
                  ]}
                />
              )
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* ── Ranking pracowników ── */}
            <div className={cn(showFeed ? 'xl:col-span-2' : 'xl:col-span-3')}>
              <div className="flex items-center gap-2 mb-2">
                <Users size={15} className="text-ink-3" />
                <h2 className="text-sm font-bold text-ink">Pracownicy</h2>
                <span className="text-[11px] text-ink-4">({data?.workers.length ?? 0}) · klik = szczegóły dzień po dniu</span>
              </div>
              <DataTable
                rows={data?.workers ?? []} rowKey={w => w.workerId}
                initialSort={{ key: 'workerName', dir: 'asc' }}
                onRowClick={w => setDrill(w)}
                footer={rows => {
                  const kq = rows.reduce((a, w) => a + w.kgQuarter, 0)
                  const km = rows.reduce((a, w) => a + w.kgMeat, 0)
                  return <><span>Razem · {rows.length} os.</span><span className="ml-auto">Ćwiartka: <b>{nf0.format(kq)} kg</b></span><span>Mięso: <b className="text-brand">{nf0.format(km)} kg</b></span></>
                }}
                columns={[
                  { key: 'workerName', header: 'Pracownik', sortable: true, sortValue: w => w.workerName,
                    cell: w => <span className="font-semibold text-ink">{w.workerName}</span> },
                  { key: 'kgQuarter', header: 'Ćwiartka pobrana [kg]', align: 'right', sortable: true, sortValue: w => w.kgQuarter,
                    cell: w => <span className="font-bold tabular-nums">{nf1.format(w.kgQuarter)}</span> },
                  { key: 'kgMeat', header: 'Mięso [kg]', align: 'right', sortable: true, sortValue: w => w.kgMeat,
                    cell: w => <span className="font-bold tabular-nums text-brand">{nf1.format(w.kgMeat)}</span> },
                  { key: 'avgYield', header: 'Śr. %', align: 'right', sortable: true, sortValue: w => w.avgYield,
                    cell: w => <span className={cn('font-black tabular-nums', yieldTone(w.avgYield))}>{nf1.format(w.avgYield)}</span> },
                  { key: 'vsAvg', header: '± zakład', align: 'right', sortable: true,
                    sortValue: w => w.avgYield - (s?.avgYield ?? 0),
                    cell: w => {
                      const d = w.avgYield - (s?.avgYield ?? 0)
                      if (Math.abs(d) < 0.05) return <span className="text-ink-4 tabular-nums">0,0</span>
                      // Przełożenie na mięso: ile kg więcej/mniej niż gdyby
                      // pracował na średniej zakładu (na SWOJEJ ćwiartce).
                      const kg = (d / 100) * w.kgQuarter
                      const sign = d > 0 ? '+' : '−'
                      return (
                        <span className={cn('tabular-nums font-semibold whitespace-nowrap', d > 0 ? 'text-emerald-600' : 'text-red-500')}>
                          {sign}{nf1.format(Math.abs(d))}
                          <span className="text-[10px] font-medium"> ({sign}{nf1.format(Math.abs(kg))} kg)</span>
                        </span>
                      )
                    } },
                  { key: 'kgPerHour', header: 'Kg/h', align: 'right', sortable: true, sortValue: w => w.kgPerHour,
                    cell: w => <span className="tabular-nums text-ink-2">{nf1.format(w.kgPerHour)}</span> },
                  { key: 'quarters', header: 'Wpisy', align: 'right', sortable: true, sortValue: w => w.quarters,
                    cell: w => <span className="tabular-nums text-ink-3">{w.quarters}</span> },
                ]}
              />
            </div>

            {/* ── Live feed (tylko dziś, gdy są wpisy) ── */}
            {showFeed && (
              <div className="xl:col-span-1">
                <div className="flex items-center gap-2 mb-2">
                  <Radio size={15} className={liveNow ? 'text-emerald-500' : 'text-ink-4'} />
                  <h2 className="text-sm font-bold text-ink">{liveNow ? 'Na żywo' : 'Ostatnie wpisy'}</h2>
                </div>
                <div className="rounded-xl border border-surface-4 bg-white divide-y divide-surface-3 max-h-[420px] overflow-auto">
                  {(data?.recent ?? []).length === 0 ? (
                    <div className="px-4 py-10 text-center text-xs text-ink-4">Brak wpisów</div>
                  ) : (data?.recent ?? []).map(r => (
                    <div key={r.id} className="px-3 py-2 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-ink text-[13px] truncate">{r.workerName}</span>
                          <code className="font-mono text-[10px] bg-brand/10 text-brand px-1 rounded">{r.rawBatchNo}</code>
                        </div>
                        <div className="text-[10.5px] text-ink-4">{timeAgo(r.at)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-bold tabular-nums text-brand">{nf1.format(r.kgMeat)}<span className="text-[10px] text-ink-4"> kg</span></div>
                        <div className={cn('text-[11px] font-black tabular-nums', yieldTone(r.yield))}>{nf1.format(r.yield)}%</div>
                      </div>
                      <button onClick={() => setCbEntry(r)}
                        title="Zmień partię wpisu (korekta pomyłki operatora)"
                        className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-ink-4 hover:text-brand hover:bg-brand/10">
                        <ArrowLeftRight size={14} />
                      </button>
                      <button onClick={() => setFixEntry(r)}
                        title="Popraw pracownika lub kg (pomyłka operatora)"
                        className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-ink-4 hover:text-brand hover:bg-brand/10">
                        <PencilLine size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Trend dzienny + porównanie dostawców (zakresy wielodniowe) ── */}
          {(() => {
            const days = data?.byDay ?? []
            const sup = new Map<string, { kgQuarter: number; kgMeat: number; batches: number }>()
            for (const b of data?.byBatch ?? []) {
              if (!b.supplierName || b.yieldPct == null) continue
              const cur = sup.get(b.supplierName) ?? { kgQuarter: 0, kgMeat: 0, batches: 0 }
              cur.kgQuarter += b.kgQuarter; cur.kgMeat += b.kgMeat; cur.batches += 1
              sup.set(b.supplierName, cur)
            }
            const suppliers = Array.from(sup.entries())
              .map(([name, v]) => ({ name, ...v, avgYield: v.kgQuarter > 0 ? v.kgMeat / v.kgQuarter * 100 : 0 }))
              .sort((a, b) => b.kgQuarter - a.kgQuarter)
            if (days.length <= 1 && suppliers.length <= 1) return null
            const chart = days.map(d => ({
              label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
              pct: d.avgYield, kg: d.kgMeat,
            }))
            return (
              // Tabela dni i wykres ZAWSZE równej szerokości (para 50/50);
              // Dostawcy wchodzą do siatki jako kolejny kafel pod spodem.
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {days.length > 1 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CalendarDays size={15} className="text-ink-3" />
                      <h2 className="text-sm font-bold text-ink">Trend dzienny</h2>
                    </div>
                    <div className="rounded-lg border border-surface-4 bg-white overflow-hidden">
                      <div className="overflow-auto max-h-[320px]">
                        <table className="w-full text-[13px] [font-variant-numeric:tabular-nums]">
                          <thead>
                            <tr className="sticky top-0 bg-surface-2 text-[11px] uppercase font-bold text-ink-3">
                              <th className="text-left px-3 py-2">Dzień</th>
                              <th className="text-right px-3 py-2">Wpisy</th>
                              <th className="text-right px-3 py-2">Mięso [kg]</th>
                              <th className="text-right px-3 py-2">Śr. %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {days.slice().reverse().map(d => (
                              <tr key={d.date} className="border-t border-surface-3 even:bg-[#F4F7FB]">
                                <td className="px-3 py-1.5">{d.date.slice(8, 10)}.{d.date.slice(5, 7)}.{d.date.slice(0, 4)}</td>
                                <td className="px-3 py-1.5 text-right text-ink-2">{d.quarters}</td>
                                <td className="px-3 py-1.5 text-right font-bold text-brand">{nf1.format(d.kgMeat)}</td>
                                <td className={cn('px-3 py-1.5 text-right font-black', yieldTone(d.avgYield))}>{nf1.format(d.avgYield)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
                {days.length > 1 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Percent size={15} className="text-ink-3" />
                      <h2 className="text-sm font-bold text-ink">Wykres trendu — śr. % mięsa</h2>
                    </div>
                    <div className="rounded-lg border border-surface-4 bg-white p-3" style={{ height: 320 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} minTickGap={14} />
                          <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} width={52}
                            domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={v => `${nf1.format(v)}%`} />
                          <Tooltip
                            formatter={(v: any, name: any) => name === 'pct' ? [`${nf1.format(v)}%`, 'śr. % mięsa'] : [`${nf0.format(v)} kg`, 'mięso']}
                            labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 12 }} cursor={{ stroke: '#CBD5E1' }} />
                          {/* Punkt odniesienia: średnia zakładu w całym zakresie */}
                          <ReferenceLine y={s?.avgYield ?? 0} stroke="#94A3B8" strokeDasharray="4 4"
                            label={{ value: `śr. ${nf1.format(s?.avgYield ?? 0)}%`, fontSize: 10, fill: '#64748B', position: 'insideTopRight' }} />
                          <Line type="monotone" dataKey="pct" stroke="#1D4ED8" strokeWidth={2}
                            dot={{ r: 3, fill: '#1D4ED8' }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {suppliers.length > 1 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Truck size={15} className="text-ink-3" />
                      <h2 className="text-sm font-bold text-ink">Dostawcy</h2>
                      <span className="text-[11px] text-ink-4">śr. uzysk z partii dostawcy w zakresie</span>
                    </div>
                    <div className="rounded-lg border border-surface-4 bg-white overflow-hidden">
                      <table className="w-full text-[13px] [font-variant-numeric:tabular-nums]">
                        <thead>
                          <tr className="bg-surface-2 text-[11px] uppercase font-bold text-ink-3">
                            <th className="text-left px-3 py-2">Dostawca</th>
                            <th className="text-right px-3 py-2">Partie</th>
                            <th className="text-right px-3 py-2">Ćwiartka [kg]</th>
                            <th className="text-right px-3 py-2">Śr. % mięsa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {suppliers.map(x => (
                            <tr key={x.name} className="border-t border-surface-3 even:bg-[#F4F7FB]">
                              <td className="px-3 py-1.5 font-semibold text-ink">{x.name}</td>
                              <td className="px-3 py-1.5 text-right text-ink-2">{x.batches}</td>
                              <td className="px-3 py-1.5 text-right font-bold">{nf0.format(x.kgQuarter)}</td>
                              <td className={cn('px-3 py-1.5 text-right font-black', yieldTone(x.avgYield))}>{nf1.format(x.avgYield)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </>
      )}

      {loading && !data && (
        <div className="text-center text-sm text-ink-4 py-4">Ładowanie…</div>
      )}

      {/* ── Drill-down: pracownik dzień po dniu ── */}
      {drill && (() => {
        const days = data?.workerDaily?.[drill.workerId] ?? []
        const chart = days.map(d => ({ label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`, kgMeat: d.kgMeat }))
        return (
          <Dialog open onOpenChange={v => { if (!v) setDrill(null) }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand/10 text-brand"><Users size={15} /></span>
                  {drill.workerName} — dzień po dniu
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <MiniStat label="Ćwiartka pobr." value={nf0.format(drill.kgQuarter)} unit="kg" />
                  <MiniStat label="Kg mięsa" value={nf0.format(drill.kgMeat)} unit="kg" />
                  <MiniStat label="Śr. %" value={nf1.format(drill.avgYield)} tone={yieldTone(drill.avgYield)} />
                  <MiniStat label="Kg/h" value={nf1.format(drill.kgPerHour)} />
                </div>
                {days.length > 1 && (
                  <div style={{ height: 150 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} minTickGap={12} />
                        <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} width={38} />
                        <Tooltip cursor={{ fill: '#F4F7FB' }} />
                        <Bar dataKey="kgMeat" radius={[3, 3, 0, 0]} fill="#1D4ED8" maxBarSize={38} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="rounded-lg border border-surface-4 overflow-hidden">
                  <table className="w-full text-[13px] [font-variant-numeric:tabular-nums]">
                    <thead>
                      <tr className="bg-surface-2 text-[11px] uppercase font-bold text-ink-3">
                        <th className="text-left px-3 py-2">Dzień</th>
                        <th className="text-right px-3 py-2">Wpisy</th>
                        <th className="text-right px-3 py-2">Ćwiartka [kg]</th>
                        <th className="text-right px-3 py-2">Mięso [kg]</th>
                        <th className="text-right px-3 py-2">Śr. %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.slice().reverse().map(d => (
                        <tr key={d.date} className="border-t border-surface-3 even:bg-[#F4F7FB]">
                          <td className="px-3 py-1.5">{d.date.slice(8, 10)}.{d.date.slice(5, 7)}.{d.date.slice(0, 4)}</td>
                          <td className="px-3 py-1.5 text-right font-bold">{d.quarters}</td>
                          <td className="px-3 py-1.5 text-right text-ink-2">{nf1.format(d.kgQuarter)}</td>
                          <td className="px-3 py-1.5 text-right font-bold text-brand">{nf1.format(d.kgMeat)}</td>
                          <td className={cn('px-3 py-1.5 text-right font-black', yieldTone(d.avgYield))}>{nf1.format(d.avgYield)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}

      {cbEntry && (
        <ChangeBatchDialog entry={cbEntry} onClose={() => setCbEntry(null)} onSaved={load} />
      )}
      {fixEntry && (
        <EntryCorrectionDialog entry={fixEntry} onClose={() => setFixEntry(null)} onSaved={load} />
      )}
    </div>
  )
}
