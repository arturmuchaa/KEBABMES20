import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, deboningApi, meatStockApi } from '@/lib/apiClient'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/Badge'
import { fmtKg, fmtDatePl, fmtPct, getExpiryStatus, sortFefo, todayIso } from '@/lib/utils'
import { Link } from 'react-router-dom'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ShadcnBadge } from '@/components/ui/badge'
import {
  AlertTriangle, Package, Beef, Scissors, TrendingUp,
  TrendingDown, ArrowRight, Activity, BarChart3, Clock, Zap,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  BarChart, Bar, Cell,
} from 'recharts'

// ── Skeleton loading cards ──────────────────────────────────────
function KpiSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-20" />
    </Card>
  )
}

// ── KPI Card ───────────────────────────────────────────────────
interface KpiProps {
  label: string
  value: React.ReactNode
  unit?: string
  sub?: string
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendLabel?: string
  accent: 'blue' | 'green' | 'amber' | 'red'
}

const ACCENT_STYLES = {
  blue:  { icon: 'bg-blue-50 text-blue-600',   ring: 'ring-blue-100',  value: 'text-gray-900' },
  green: { icon: 'bg-green-50 text-green-600',  ring: 'ring-green-100', value: 'text-gray-900' },
  amber: { icon: 'bg-amber-50 text-amber-600',  ring: 'ring-amber-100', value: 'text-gray-900' },
  red:   { icon: 'bg-red-50 text-red-600',      ring: 'ring-red-100',   value: 'text-red-700'  },
}

function KpiCard({ label, value, unit, sub, icon, trend, trendLabel, accent }: KpiProps) {
  const s = ACCENT_STYLES[accent]
  return (
    <Card className="p-6 hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums ${s.value}`}>{value}</span>
            {unit && <span className="text-sm font-medium text-gray-400">{unit}</span>}
          </div>
          {(sub || trend) && (
            <div className="flex items-center gap-1.5 mt-2">
              {trend === 'up' && <TrendingUp size={12} className="text-green-500" />}
              {trend === 'down' && <TrendingDown size={12} className="text-red-500" />}
              {trendLabel && <span className="text-xs text-gray-400">{trendLabel}</span>}
              {sub && !trendLabel && <span className="text-xs text-gray-400">{sub}</span>}
            </div>
          )}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ml-4 ${s.icon}`}>
          {icon}
        </div>
      </div>
    </Card>
  )
}

// ── Custom chart tooltip ────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="text-gray-500">
          <span className="font-medium" style={{ color: p.color }}>{p.name}:</span>{' '}
          {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          {p.name === 'Wydajność' ? '%' : ' kg'}
        </p>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const batchRes    = useApi(() => rawBatchesApi.list())
  const deboningRes = useApi(() => deboningApi.list())
  const meatRes     = useApi(() => meatStockApi.list())

  const loading = batchRes.loading || deboningRes.loading || meatRes.loading

  const allBatches   = batchRes.data?.data   ?? []
  const allDebonings = deboningRes.data?.data ?? []
  const allMeat      = meatRes.data?.data     ?? []

  const activeBatches = allBatches.filter(
    b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used'
  )
  const fefoSorted   = sortFefo(activeBatches).slice(0, 30)
  const totalKgAvail = activeBatches.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const meatKg       = allMeat.filter(m => m.status === 'AVAILABLE').reduce((s, m) => s + Number(m.kgAvailable), 0)
  const today        = todayIso()
  const todayDeb     = allDebonings.filter(d => d.createdAt?.slice(0, 10) === today)
  const critical     = activeBatches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 1)
  const warnings     = activeBatches.filter(b => {
    const d = getExpiryStatus(b.expiryDate).daysLeft
    return d >= 2 && d <= 3
  })

  // Chart data: last 14 days of deboning
  const chartData = (() => {
    const byDay = new Map<string, { kg: number; meat: number; count: number }>()
    allDebonings.forEach(d => {
      const day = d.createdAt?.slice(0, 10) ?? ''
      if (!day) return
      const cur = byDay.get(day) ?? { kg: 0, meat: 0, count: 0 }
      byDay.set(day, {
        kg:    cur.kg + Number(d.kgTaken),
        meat:  cur.meat + Number(d.kgMeat),
        count: cur.count + 1,
      })
    })
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([day, v]) => ({
        day: day.slice(5).replace('-', '/'),
        'Ćwiartka': Math.round(v.kg * 10) / 10,
        'Mięso':    Math.round(v.meat * 10) / 10,
        'Wydajność': v.kg > 0 ? Math.round((v.meat / v.kg) * 1000) / 10 : 0,
      }))
  })()

  // ── Loading skeleton ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <KpiSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
            <CardContent><Skeleton className="h-48 w-full" /></CardContent>
          </Card>
          <Card>
            <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
            <CardContent className="space-y-3">
              {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── KPI row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Surowiec dostępny"
          value={fmtKg(totalKgAvail, 0)}
          unit="kg"
          sub={`${activeBatches.length} aktywnych partii`}
          icon={<Beef size={18} />}
          accent="blue"
          trend={totalKgAvail > 0 ? 'neutral' : 'down'}
        />
        <KpiCard
          label="Magazyn mięsa"
          value={fmtKg(meatKg, 0)}
          unit="kg"
          sub={`${allMeat.filter(m => m.status === 'AVAILABLE').length} lotów`}
          icon={<Package size={18} />}
          accent="green"
        />
        <KpiCard
          label="Rozbiory dziś"
          value={todayDeb.length}
          unit="sesji"
          sub={todayDeb.length > 0
            ? `Śr. wydajność: ${fmtPct(todayDeb.reduce((s,d) => s + Number(d.yieldPct), 0) / todayDeb.length)}`
            : 'Brak sesji'}
          icon={<Scissors size={18} />}
          accent="amber"
          trend={todayDeb.length > 0 ? 'up' : 'neutral'}
          trendLabel={todayDeb.length > 0 ? 'aktywne dziś' : undefined}
        />
        <KpiCard
          label="Alerty FEFO"
          value={critical.length + warnings.length}
          unit="partii"
          sub={critical.length > 0 ? `${critical.length} krytycznych` : 'Brak krytycznych'}
          icon={<AlertTriangle size={18} />}
          accent={critical.length > 0 ? 'red' : 'green'}
          trend={critical.length > 0 ? 'down' : 'up'}
          trendLabel={critical.length > 0 ? 'wymaga działania' : 'wszystko OK'}
        />
      </div>

      {/* ── FEFO Alerts ─────────────────────────────────────── */}
      {(critical.length > 0 || warnings.length > 0) && (
        <div className="space-y-3">
          {critical.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-red-200 flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={12} className="text-red-600" />
                </div>
                <span className="text-sm font-semibold text-red-800">
                  Krytyczne FEFO — wymaga natychmiastowego działania
                </span>
                <ShadcnBadge variant="danger" className="ml-auto">{critical.length} partii</ShadcnBadge>
              </div>
              <div className="divide-y divide-red-100">
                {critical.map(b => {
                  const { daysLeft } = getExpiryStatus(b.expiryDate)
                  return (
                    <div key={b.id} className="px-4 py-2.5 flex items-center gap-4 text-sm">
                      <code className="font-mono font-bold text-red-700 text-xs bg-red-100 px-1.5 py-0.5 rounded">
                        {b.internalBatchNo}
                      </code>
                      <span className="text-red-700 flex-1">
                        {daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : 'Wygasa jutro'}
                        {' — '}{fmtDatePl(b.expiryDate)}
                      </span>
                      <span className="font-semibold text-red-800 tabular-nums">{fmtKg(b.kgAvailable)} kg</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-200 flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Clock size={12} className="text-amber-600" />
                </div>
                <span className="text-sm font-semibold text-amber-800">
                  Ostrzeżenia FEFO — wygasa w ciągu 2–3 dni
                </span>
                <ShadcnBadge variant="warning" className="ml-auto">{warnings.length} partii</ShadcnBadge>
              </div>
              <div className="divide-y divide-amber-100">
                {warnings.map(b => {
                  const { daysLeft } = getExpiryStatus(b.expiryDate)
                  return (
                    <div key={b.id} className="px-4 py-2.5 flex items-center gap-4 text-sm">
                      <code className="font-mono font-bold text-amber-700 text-xs bg-amber-100 px-1.5 py-0.5 rounded">
                        {b.internalBatchNo}
                      </code>
                      <span className="text-amber-700 flex-1">Za {daysLeft} dni — {fmtDatePl(b.expiryDate)}</span>
                      <span className="font-semibold text-amber-800 tabular-nums">{fmtKg(b.kgAvailable)} kg</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Main grid: Chart + Quick stats ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Production chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity size={16} className="text-blue-500" />
                  Produkcja — ostatnie 14 dni
                </CardTitle>
                <CardDescription className="mt-0.5">Rozbiór ćwiartki i uzysk mięsa (kg)</CardDescription>
              </div>
              <ShadcnBadge variant="info" className="text-xs">
                <Zap size={10} className="mr-1" /> Live
              </ShadcnBadge>
            </div>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <BarChart3 size={32} className="mb-2 opacity-30" />
                <p className="text-sm font-medium">Brak danych produkcyjnych</p>
                <p className="text-xs text-gray-400 mt-1">Dane pojawią się po pierwszym rozbiorze</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gradBlue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10B981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={40} />
                  <ChartTooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone" dataKey="Ćwiartka" stroke="#3B82F6" strokeWidth={2}
                    fill="url(#gradBlue)" dot={false} activeDot={{ r: 4, fill: '#3B82F6' }}
                  />
                  <Area
                    type="monotone" dataKey="Mięso" stroke="#10B981" strokeWidth={2}
                    fill="url(#gradGreen)" dot={false} activeDot={{ r: 4, fill: '#10B981' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Quick stats / yield chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Wydajność rozbioru</CardTitle>
            <CardDescription>Ostatnie sesje (%)</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <BarChart3 size={28} className="mb-2 opacity-30" />
                <p className="text-sm">Brak danych</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData.slice(-7)} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={30} />
                  <ChartTooltip content={<CustomTooltip />} />
                  <Bar dataKey="Wydajność" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {chartData.slice(-7).map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry['Wydajność'] >= 70 ? '#10B981' : entry['Wydajność'] >= 60 ? '#F59E0B' : '#EF4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Tables ──────────────────────────────────────────── */}
      <Tabs defaultValue="fefo">
        <TabsList className="mb-4">
          <TabsTrigger value="fefo" className="flex items-center gap-1.5">
            <Package size={13} />
            Partie FEFO
            {(critical.length > 0 || warnings.length > 0) && (
              <span className="ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {critical.length + warnings.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="deboning" className="flex items-center gap-1.5">
            <Scissors size={13} />
            Ostatnie rozbiory
          </TabsTrigger>
        </TabsList>

        {/* FEFO table */}
        <TabsContent value="fefo">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Partie ćwiartki — FEFO</CardTitle>
                <CardDescription className="mt-0.5">
                  Sortowanie wg daty ważności ({fefoSorted.length} partii)
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/office/raw-batches" className="flex items-center gap-1.5">
                  Zarządzaj <ArrowRight size={13} />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {fefoSorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Package size={36} className="mb-3 opacity-20" />
                  <p className="text-sm font-medium text-gray-500">Brak partii</p>
                  <p className="text-xs text-gray-400 mt-1">Przyjmij pierwszą partię ćwiartki</p>
                  <Button variant="outline" size="sm" className="mt-4" asChild>
                    <Link to="/office/raw-batches">Dodaj partię</Link>
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs uppercase tracking-wide">Nr partii</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide">Dostawca</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-right">Dostępne</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide">Ważność</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fefoSorted.map(b => {
                      const displayStatus = computeDisplayStatus(b.expiryDate, Number(b.kgAvailable))
                      return (
                        <TableRow key={b.id}>
                          <TableCell>
                            <code className="font-mono font-bold text-gray-900 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                              {b.internalBatchNo}
                            </code>
                          </TableCell>
                          <TableCell className="text-gray-600 text-sm">{b.supplierName ?? '—'}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {fmtKg(b.kgAvailable)} kg
                          </TableCell>
                          <TableCell><ExpiryBadge dateStr={b.expiryDate} /></TableCell>
                          <TableCell><StatusBadge status={displayStatus} /></TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deboning table */}
        <TabsContent value="deboning">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Ostatnie rozbiory</CardTitle>
                <CardDescription className="mt-0.5">10 ostatnich wpisów</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/office/deboning" className="flex items-center gap-1.5">
                  Wszystkie <ArrowRight size={13} />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {allDebonings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Scissors size={36} className="mb-3 opacity-20" />
                  <p className="text-sm font-medium text-gray-500">Brak sesji rozbioru</p>
                  <p className="text-xs text-gray-400 mt-1">Wykonaj pierwszy rozbiór na tablecie</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs uppercase tracking-wide">Nr sesji</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide">Partia</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide">Pracownik</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-right">Ćwiartka</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-right">Mięso</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-right">Wydajność</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...allDebonings]
                      .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
                      .slice(0, 10)
                      .map(d => {
                        const yield_ = Number(d.yieldPct)
                        return (
                          <TableRow key={d.id}>
                            <TableCell>
                              <code className="font-mono text-blue-600 text-xs font-semibold">{d.sessionNo}</code>
                            </TableCell>
                            <TableCell>
                              <code className="font-mono font-bold text-gray-900 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                {d.rawBatchNo}
                              </code>
                            </TableCell>
                            <TableCell className="text-gray-600">{d.workerName ?? '—'}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {fmtKg(Number(d.kgTaken), 1)} kg
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-gray-600">
                              {fmtKg(Number(d.kgMeat), 1)} kg
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={
                                yield_ >= 70 ? 'text-green-600 font-bold' :
                                yield_ >= 60 ? 'text-amber-600 font-semibold' :
                                'text-red-600 font-semibold'
                              }>
                                {fmtPct(yield_)}
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  )
}
