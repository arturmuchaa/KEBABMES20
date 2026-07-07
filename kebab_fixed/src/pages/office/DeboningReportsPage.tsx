/**
 * DeboningReportsPage — Rozbiór: monitoring i statystyki dla biura.
 *
 * Zastępuje stary panel „sesje rozbioru". Pełny dashboard: wybór zakresu
 * (dziś/wczoraj/7 dni/miesiąc/rok/własny), KPI, wykres przepustowości,
 * ranking pracowników (kto najwięcej, kto najlepszy %) i live-feed (gdy dziś).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { deboningApi, type DeboningStats } from '@/lib/api'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import {
  Scissors, Beef, Gauge, Percent, Users, Bone, Trophy, Radio, CalendarDays,
} from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell,
} from 'recharts'

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

// ─── Formatery ───────────────────────────────────────────────
const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

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

// ─── KPI ─────────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, unit, tone, accent }: {
  icon: any; label: string; value: string; unit?: string; tone?: string; accent?: string
}) {
  return (
    <div className="relative rounded-xl border border-surface-4 bg-white px-4 py-3.5 overflow-hidden">
      <div className={cn('absolute inset-x-0 top-0 h-0.5', accent ?? 'bg-brand/70')} />
      <div className="flex items-center gap-1.5 text-ink-4 mb-1.5">
        <Icon size={13} />
        <span className="text-[10.5px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className={cn('text-[26px] font-black leading-none [font-variant-numeric:tabular-nums]', tone ?? 'text-ink')}>
        {value}{unit && <span className="text-[13px] font-bold text-ink-4 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

// ─── Tooltip wykresu ─────────────────────────────────────────
function ChartTooltip({ active, payload, label, secondaryLabel }: any) {
  if (!active || !payload?.length) return null
  const p: Record<string, number> = {}
  payload.forEach((x: any) => { p[x.dataKey] = x.value })
  return (
    <div className="rounded-lg border border-surface-4 bg-white shadow-lg px-3 py-2 text-xs">
      <div className="font-bold text-ink mb-1">{label}</div>
      <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-brand" /> Kg mięsa: <b className="tabular-nums">{nf1.format(p.kgMeat ?? 0)}</b></div>
      <div className="text-ink-3">Ćwiartek: <b className="tabular-nums text-ink">{p.quarters ?? 0}</b></div>
      {p.secondary != null && <div className="text-ink-3">{secondaryLabel}: <b className="tabular-nums text-ink">{nf1.format(p.secondary)}</b></div>}
    </div>
  )
}

export function DeboningReportsPage() {
  const [preset, setPreset] = useState<Preset>('today')
  const [cf, setCf] = useState('')
  const [ct, setCt] = useState('')
  const { from, to } = useMemo(() => resolveRange(preset, cf, ct), [preset, cf, ct])
  const live = to === ymd(new Date())

  const [data, setData] = useState<DeboningStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    deboningApi.stats(from, to).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => { setLoading(true); load() }, [load])
  // Live: gdy zakres kończy się dziś, odświeżaj co 15 s.
  useEffect(() => {
    if (!live) return
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [live, load])

  // ── Kontrola zakresu w nagłówku ──
  usePageHeaderActions(
    <div className="flex items-center gap-2 flex-wrap">
      {live && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold uppercase tracking-wide">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Live
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
    </div>,
    [preset, cf, ct, live, from, to],
  )

  const s = data?.summary
  const useHours = preset === 'today' || preset === 'yesterday'
  const chartData = useMemo(() => {
    if (!data) return []
    if (useHours) return data.byHour.map(d => ({ label: d.hour.slice(11, 16), kgMeat: d.kgMeat, quarters: d.quarters, secondary: d.quarters }))
    return data.byDay.map(d => ({ label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`, kgMeat: d.kgMeat, quarters: d.quarters, secondary: d.avgYield }))
  }, [data, useHours])
  const secondaryLabel = useHours ? 'Ćwiartek' : 'Śr. rozbiór %'

  const empty = !loading && (!s || s.quarters === 0)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── KPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Scissors} label="Ćwiartek" value={nf0.format(s?.quarters ?? 0)} accent="bg-brand" />
        <Kpi icon={Beef} label="Kg mięsa" value={nf0.format(s?.kgMeat ?? 0)} unit="kg" accent="bg-brand" />
        <Kpi icon={Percent} label="Śr. rozbiór" value={nf1.format(s?.avgYield ?? 0)} unit="%" tone={yieldTone(s?.avgYield ?? 0)} accent="bg-emerald-500" />
        <Kpi icon={Gauge} label="Tempo" value={nf0.format(s?.kgPerHour ?? 0)} unit="kg/h" accent="bg-blue-500" />
        <Kpi icon={Users} label="Pracownicy" value={nf0.format(s?.workers ?? 0)} accent="bg-violet-500" />
        <Kpi icon={Bone} label="Kości / grzbiety" value={`${nf1.format(s?.bonesPct ?? 0)}/${nf1.format(s?.backsPct ?? 0)}`} unit="%" tone="text-ink-2" accent="bg-amber-500" />
      </div>

      {empty ? (
        <div className="rounded-xl border border-surface-4 bg-white flex flex-col items-center justify-center py-20 gap-2">
          <CalendarDays size={38} className="text-ink-5" />
          <div className="text-sm font-semibold text-ink-3">Brak rozbioru w tym zakresie</div>
          <div className="text-xs text-ink-4">Wybierz inny dzień lub zakres dat u góry.</div>
        </div>
      ) : (
        <>
          {/* ── Wykres przepustowości ── */}
          <div className="rounded-xl border border-surface-4 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-ink">Przepustowość rozbioru</div>
                <div className="text-[11px] text-ink-4">{useHours ? 'Kg mięsa na godzinę' : 'Kg mięsa dziennie · linia = średni % rozbioru'}</div>
              </div>
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barK" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1D4ED8" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#1D4ED8" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={44} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={34} domain={[50, 75]} hide={useHours} />
                  <Tooltip content={<ChartTooltip secondaryLabel={secondaryLabel} />} cursor={{ fill: '#F4F7FB' }} />
                  <Bar yAxisId="l" dataKey="kgMeat" radius={[4, 4, 0, 0]} fill="url(#barK)" maxBarSize={46}>
                    {chartData.map((_, i) => <Cell key={i} />)}
                  </Bar>
                  {!useHours && (
                    <Line yAxisId="r" type="monotone" dataKey="secondary" stroke="#059669" strokeWidth={2} dot={{ r: 2.5, fill: '#059669' }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* ── Ranking pracowników ── */}
            <div className={cn(live ? 'xl:col-span-2' : 'xl:col-span-3')}>
              <div className="flex items-center gap-2 mb-2">
                <Trophy size={15} className="text-amber-500" />
                <h2 className="text-sm font-bold text-ink">Ranking pracowników</h2>
                <span className="text-[11px] text-ink-4">({data?.workers.length ?? 0})</span>
              </div>
              <DataTable
                rows={data?.workers ?? []} rowKey={w => w.workerId}
                initialSort={{ key: 'kgQuarter', dir: 'desc' }}
                footer={rows => {
                  const q = rows.reduce((a, w) => a + w.quarters, 0)
                  const km = rows.reduce((a, w) => a + w.kgMeat, 0)
                  return <><span>Razem · {rows.length} os.</span><span className="ml-auto">Ćwiartek: <b>{q}</b></span><span>Kg mięsa: <b className="text-brand">{nf0.format(km)}</b></span></>
                }}
                columns={[
                  { key: 'pos', header: '#', width: 48,
                    cell: (w) => {
                      const i = (data?.workers ?? []).findIndex(x => x.workerId === w.workerId)
                      const medal = ['bg-amber-100 text-amber-700 border-amber-300', 'bg-slate-100 text-slate-600 border-slate-300', 'bg-orange-100 text-orange-700 border-orange-300'][i]
                      return <span className={cn('inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-black border', medal ?? 'border-transparent text-ink-4')}>{i + 1}</span>
                    } },
                  { key: 'workerName', header: 'Pracownik', sortable: true, sortValue: w => w.workerName,
                    cell: w => <span className="font-semibold text-ink">{w.workerName}</span> },
                  { key: 'quarters', header: 'Ćwiartek', align: 'right', sortable: true, sortValue: w => w.quarters,
                    cell: w => <span className="font-bold tabular-nums">{w.quarters}</span> },
                  { key: 'kgQuarter', header: 'Kg ćwiartki', align: 'right', sortable: true, sortValue: w => w.kgQuarter,
                    cell: w => <span className="tabular-nums text-ink-2">{nf1.format(w.kgQuarter)}</span> },
                  { key: 'kgMeat', header: 'Kg mięsa', align: 'right', sortable: true, sortValue: w => w.kgMeat,
                    cell: w => <span className="font-bold tabular-nums text-brand">{nf1.format(w.kgMeat)}</span> },
                  { key: 'avgYield', header: 'Śr. %', align: 'right', sortable: true, sortValue: w => w.avgYield,
                    cell: w => <span className={cn('font-black tabular-nums', yieldTone(w.avgYield))}>{nf1.format(w.avgYield)}</span> },
                  { key: 'kgPerHour', header: 'Kg/h', align: 'right', sortable: true, sortValue: w => w.kgPerHour,
                    cell: w => <span className="tabular-nums text-ink-2">{nf1.format(w.kgPerHour)}</span> },
                ]}
              />
            </div>

            {/* ── Live feed (tylko dziś/aktualny) ── */}
            {live && (
              <div className="xl:col-span-1">
                <div className="flex items-center gap-2 mb-2">
                  <Radio size={15} className="text-emerald-500" />
                  <h2 className="text-sm font-bold text-ink">Na żywo</h2>
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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {loading && !data && (
        <div className="text-center text-sm text-ink-4 py-4">Ładowanie…</div>
      )}
    </div>
  )
}
