/**
 * DeboningReportsPage — Rozbiór: monitoring i statystyki dla biura.
 *
 * Zastępuje stary panel „sesje rozbioru". Pełny dashboard: wybór zakresu
 * (dziś/wczoraj/7 dni/miesiąc/rok/własny), KPI, wykres przepustowości,
 * ranking pracowników (kto najwięcej, kto najlepszy %) i live-feed (gdy dziś).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { deboningApi, type DeboningStats, type DeboningStatsWorker } from '@/lib/api'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import {
  Scissors, Beef, Gauge, Percent, Users, Bone, Layers, Radio, CalendarDays, X,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine,
} from 'recharts'
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
function Kpi({ icon: Icon, label, value, unit, sub, tone, accent }: {
  icon: any; label: string; value: string; unit?: string; sub?: string; tone?: string; accent?: string
}) {
  return (
    <div className="relative rounded-xl border border-surface-4 bg-white px-4 py-3.5 overflow-hidden">
      <div className={cn('absolute inset-x-0 top-0 h-0.5', accent ?? 'bg-brand/70')} />
      <div className="flex items-center gap-1.5 text-ink-4 mb-1.5">
        <Icon size={13} />
        <span className="text-[10.5px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <div className={cn('text-[26px] font-black leading-none [font-variant-numeric:tabular-nums]', tone ?? 'text-ink')}>
          {value}{unit && <span className="text-[13px] font-bold text-ink-4 ml-1">{unit}</span>}
        </div>
        {sub && <div className="text-[14px] font-bold text-ink-4 [font-variant-numeric:tabular-nums]">{sub}</div>}
      </div>
    </div>
  )
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
  const [preset, setPreset] = useState<Preset>('today')
  const [cf, setCf] = useState('')
  const [ct, setCt] = useState('')
  const { from, to } = useMemo(() => resolveRange(preset, cf, ct), [preset, cf, ct])
  const isTodayRange = to === ymd(new Date())

  const [data, setData] = useState<DeboningStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [drill, setDrill] = useState<DeboningStatsWorker | null>(null)

  // LIVE = rozbiór FAKTYCZNIE trwa: ostatni wpis w ciągu 30 minut. Sam zakres
  // „kończący się dziś" nie wystarcza (inaczej świeciło się zawsze).
  const liveNow = useMemo(() => {
    const r = data?.recent?.[0]
    return !!r && (Date.now() - new Date(r.at).getTime()) < 30 * 60 * 1000
  }, [data])
  const showFeed = isTodayRange && (data?.recent?.length ?? 0) > 0

  const load = useCallback(() => {
    deboningApi.stats(from, to).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
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
    </div>,
    [preset, cf, ct, liveNow, from, to],
  )

  const s = data?.summary
  const batchChart = useMemo(() => data?.byBatch ?? [], [data])

  const empty = !loading && (!s || s.quarters === 0)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── KPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon={Scissors} label="Ćwiartka pobrana" value={nf0.format(s?.kgQuarter ?? 0)} unit="kg" sub={`${nf0.format(s?.quarters ?? 0)} wpisów`} accent="bg-brand" />
        <Kpi icon={Beef} label="Kg mięsa" value={nf0.format(s?.kgMeat ?? 0)} unit="kg" accent="bg-brand" />
        <Kpi icon={Percent} label="Śr. rozbiór" value={nf1.format(s?.avgYield ?? 0)} unit="%" tone={yieldTone(s?.avgYield ?? 0)} accent="bg-emerald-500" />
        <Kpi icon={Gauge} label="Tempo" value={nf0.format(s?.kgPerHour ?? 0)} unit="kg/h" accent="bg-blue-500" />
        <Kpi icon={Users} label="Pracownicy" value={nf0.format(s?.workers ?? 0)} accent="bg-violet-500" />
        <Kpi icon={Bone} label="Kości" value={nf0.format(s?.kgBones ?? 0)} unit="kg" sub={`${nf1.format(s?.bonesPct ?? 0)}%`} tone="text-ink-2" accent="bg-amber-500" />
        <Kpi icon={Layers} label="Grzbiety" value={nf0.format(s?.kgBacks ?? 0)} unit="kg" sub={`${nf1.format(s?.backsPct ?? 0)}%`} tone="text-ink-2" accent="bg-orange-500" />
      </div>

      {empty ? (
        <div className="rounded-xl border border-surface-4 bg-white flex flex-col items-center justify-center py-20 gap-2">
          <CalendarDays size={38} className="text-ink-5" />
          <div className="text-sm font-semibold text-ink-3">Brak rozbioru w tym zakresie</div>
          <div className="text-xs text-ink-4">Wybierz inny dzień lub zakres dat u góry.</div>
        </div>
      ) : (
        <>
          {/* ── Uzysk per partia surowca ── najważniejsze dane raportu:
              % mięsa z każdej partii + kg; słaba partia = rozmowa z dostawcą. */}
          <div className="rounded-xl border border-surface-4 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-ink">Uzysk mięsa per partia surowca</div>
                <div className="text-[11px] text-ink-4">
                  % mięsa z ćwiartki każdej partii · linia = średnia zakresu ({nf1.format(s?.avgYield ?? 0)}%)
                </div>
              </div>
              <div className="text-[11px] text-ink-4">{batchChart.length} partii</div>
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={batchChart} margin={{ top: 18, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
                  <XAxis dataKey="batchNo" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={40}
                    domain={[0, (max: number) => Math.max(75, Math.ceil(max + 4))]} unit="%" />
                  <Tooltip cursor={{ fill: '#F4F7FB' }} content={({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0]?.payload
                    return (
                      <div className="rounded-lg border border-surface-4 bg-white shadow-lg px-3 py-2 text-xs">
                        <div className="font-bold text-ink mb-1">Partia {label}</div>
                        <div>Uzysk: <b className="tabular-nums">{nf1.format(d?.yieldPct ?? 0)}%</b></div>
                        <div className="text-ink-3">Ćwiartka: <b className="tabular-nums text-ink">{nf0.format(d?.kgQuarter ?? 0)} kg</b></div>
                        <div className="text-ink-3">Mięso: <b className="tabular-nums text-ink">{nf0.format(d?.kgMeat ?? 0)} kg</b></div>
                      </div>
                    )
                  }} />
                  <ReferenceLine y={s?.avgYield ?? 0} stroke="#94A3B8" strokeDasharray="5 4"
                    label={{ value: `śr. ${nf1.format(s?.avgYield ?? 0)}%`, position: 'insideTopRight', fontSize: 10, fill: '#64748B' }} />
                  <Bar dataKey="yieldPct" radius={[4, 4, 0, 0]} fill="#1D4ED8" maxBarSize={52}
                    label={batchChart.length <= 14 ? { position: 'top', fontSize: 10.5, fill: '#475569', formatter: (v: number) => `${nf1.format(v)}%` } : false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
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
    </div>
  )
}
