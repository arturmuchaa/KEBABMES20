import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, deboningApi, meatStockApi } from '@/lib/apiClient'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/Badge'
import { fmtKg, fmtDatePl, fmtPct, getExpiryStatus, sortFefo, todayIso } from '@/lib/utils'
import { Link } from 'react-router-dom'

// ── shadcn/ui components ────────────────────────────────────────
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'

// ── icons ───────────────────────────────────────────────────────
import {
  AlertTriangle, Package, Beef, Scissors, TrendingUp, TrendingDown,
  ArrowRight, Activity, BarChart3, Clock, Zap, Info,
} from 'lucide-react'

// ── recharts ────────────────────────────────────────────────────
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as ChartTooltip, BarChart, Bar, Cell,
} from 'recharts'

// ─────────────────────────────────────────────────────────────────
// Loading skeleton — 4 KPI cards
// ─────────────────────────────────────────────────────────────────
function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-4 w-28 mb-4" />
        <Skeleton className="h-8 w-36 mb-3" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────
// KPI Card — w pełni shadcn Card + CardContent + CardTitle + CardDescription
// ─────────────────────────────────────────────────────────────────
type Accent = 'blue' | 'green' | 'amber' | 'red'

const ACCENT: Record<Accent, { icon: string; value: string; badge: 'info' | 'success' | 'warning' | 'danger' }> = {
  blue:  { icon: 'bg-blue-50 text-blue-600',   value: 'text-foreground', badge: 'info'    },
  green: { icon: 'bg-green-50 text-green-600',  value: 'text-foreground', badge: 'success' },
  amber: { icon: 'bg-amber-50 text-amber-600',  value: 'text-foreground', badge: 'warning' },
  red:   { icon: 'bg-red-50 text-red-600',      value: 'text-red-600',    badge: 'danger'  },
}

interface KpiProps {
  label: string
  value: React.ReactNode
  unit?: string
  sub?: string
  tooltip?: string
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendLabel?: string
  accent: Accent
}

function KpiCard({ label, value, unit, sub, tooltip, icon, trend, trendLabel, accent }: KpiProps) {
  const s = ACCENT[accent]

  return (
    <Card className="hover:shadow-card-hover transition-all duration-200">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          {/* Left: text */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-xs font-semibold uppercase tracking-wide">
                {label}
              </CardDescription>
              {tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info size={11} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px] text-xs">
                    {tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-baseline gap-1.5">
              <CardTitle className={`text-2xl font-bold tabular-nums ${s.value}`}>
                {value}
              </CardTitle>
              {unit && (
                <CardDescription className="text-sm font-medium">{unit}</CardDescription>
              )}
            </div>

            {(trendLabel || sub) && (
              <div className="flex items-center gap-1 pt-0.5">
                {trend === 'up'   && <TrendingUp  size={12} className="text-green-500 flex-shrink-0" />}
                {trend === 'down' && <TrendingDown size={12} className="text-red-500 flex-shrink-0"  />}
                <CardDescription className="text-xs">
                  {trendLabel ?? sub}
                </CardDescription>
              </div>
            )}
          </div>

          {/* Right: icon circle */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.icon}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────
// Custom recharts tooltip — must be a plain div (recharts requirement)
// ─────────────────────────────────────────────────────────────────
function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <Card className="shadow-modal p-3 min-w-[130px]">
      <CardDescription className="font-semibold text-foreground mb-1.5">{label}</CardDescription>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <CardDescription className="text-foreground font-medium">{p.name}:</CardDescription>
          <CardDescription>
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
            {p.name === 'Wydajność' ? '%' : ' kg'}
          </CardDescription>
        </div>
      ))}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────
// Empty state — shadcn Card
// ─────────────────────────────────────────────────────────────────
function EmptyCard({ icon, title, description, action }: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <div className="text-muted-foreground opacity-20 mb-1">{icon}</div>
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      {description && (
        <CardDescription className="text-xs text-center max-w-xs">{description}</CardDescription>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// DashboardPage
// ─────────────────────────────────────────────────────────────────
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

  // Chart data: last 14 days aggregated by day
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

  const avgYield = todayDeb.length > 0
    ? todayDeb.reduce((s, d) => s + Number(d.yieldPct), 0) / todayDeb.length
    : 0

  // ── Loading state ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <KpiSkeleton key={i} />)}
        </div>
        <Separator />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-52 w-full rounded-xl" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── KPI row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Surowiec dostępny"
          value={fmtKg(totalKgAvail, 0)}
          unit="kg"
          trendLabel={`${activeBatches.length} aktywnych partii`}
          tooltip="Łączna ilość kg surowca we wszystkich aktywnych partiach (FEFO)"
          icon={<Beef size={18} />}
          accent="blue"
          trend="neutral"
        />
        <KpiCard
          label="Magazyn mięsa"
          value={fmtKg(meatKg, 0)}
          unit="kg"
          trendLabel={`${allMeat.filter(m => m.status === 'AVAILABLE').length} lotów dostępnych`}
          tooltip="Mięso po rozbiorze gotowe do masowania"
          icon={<Package size={18} />}
          accent="green"
        />
        <KpiCard
          label="Rozbiory dziś"
          value={todayDeb.length}
          unit="sesji"
          trendLabel={todayDeb.length > 0 ? `Śr. wydajność: ${fmtPct(avgYield)}` : 'Brak sesji dziś'}
          tooltip="Liczba sesji rozbioru zarejestrowanych dzisiaj"
          icon={<Scissors size={18} />}
          accent="amber"
          trend={todayDeb.length > 0 ? 'up' : 'neutral'}
        />
        <KpiCard
          label="Alerty FEFO"
          value={critical.length + warnings.length}
          unit="partii"
          trendLabel={critical.length > 0 ? `${critical.length} krytycznych` : 'Brak krytycznych'}
          tooltip="Partie wygasające ≤3 dni (krytyczne ≤1 dzień)"
          icon={<AlertTriangle size={18} />}
          accent={critical.length > 0 ? 'red' : 'green'}
          trend={critical.length > 0 ? 'down' : 'up'}
        />
      </div>

      <Separator />

      {/* ── FEFO Alert cards ─────────────────────────────────────── */}
      {(critical.length > 0 || warnings.length > 0) && (
        <div className="space-y-3">

          {/* Critical */}
          {critical.length > 0 && (
            <Card className="border-red-200 bg-red-50 overflow-hidden">
              <CardHeader className="py-3 px-4 border-b border-red-200 flex-row items-center space-y-0 gap-2">
                <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={13} className="text-red-600" />
                </div>
                <CardTitle className="text-sm font-semibold text-red-800 flex-1">
                  Krytyczne FEFO — wymaga natychmiastowego działania
                </CardTitle>
                <Badge variant="danger">{critical.length} {critical.length === 1 ? 'partia' : 'partii'}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {critical.map(b => {
                      const { daysLeft } = getExpiryStatus(b.expiryDate)
                      return (
                        <TableRow key={b.id} className="hover:bg-red-100/50">
                          <TableCell>
                            <code className="font-mono font-bold text-red-700 text-xs bg-red-100 px-1.5 py-0.5 rounded">
                              {b.internalBatchNo}
                            </code>
                          </TableCell>
                          <TableCell>
                            <CardDescription className="text-red-700">
                              {daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : 'Wygasa jutro'}
                              {' — '}{fmtDatePl(b.expiryDate)}
                            </CardDescription>
                          </TableCell>
                          <TableCell className="text-right">
                            <CardTitle className="text-sm font-semibold text-red-800 tabular-nums">
                              {fmtKg(b.kgAvailable)} kg
                            </CardTitle>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 overflow-hidden">
              <CardHeader className="py-3 px-4 border-b border-amber-200 flex-row items-center space-y-0 gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Clock size={13} className="text-amber-600" />
                </div>
                <CardTitle className="text-sm font-semibold text-amber-800 flex-1">
                  Ostrzeżenia FEFO — wygasa w ciągu 2–3 dni
                </CardTitle>
                <Badge variant="warning">{warnings.length} {warnings.length === 1 ? 'partia' : 'partii'}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {warnings.map(b => {
                      const { daysLeft } = getExpiryStatus(b.expiryDate)
                      return (
                        <TableRow key={b.id} className="hover:bg-amber-100/50">
                          <TableCell>
                            <code className="font-mono font-bold text-amber-700 text-xs bg-amber-100 px-1.5 py-0.5 rounded">
                              {b.internalBatchNo}
                            </code>
                          </TableCell>
                          <TableCell>
                            <CardDescription className="text-amber-700">
                              Za {daysLeft} {daysLeft === 1 ? 'dzień' : 'dni'} — {fmtDatePl(b.expiryDate)}
                            </CardDescription>
                          </TableCell>
                          <TableCell className="text-right">
                            <CardTitle className="text-sm font-semibold text-amber-800 tabular-nums">
                              {fmtKg(b.kgAvailable)} kg
                            </CardTitle>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Charts row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Area chart — production over 14 days */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity size={15} className="text-blue-500" />
                  Produkcja — ostatnie 14 dni
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Rozbiór ćwiartki i uzysk mięsa (kg)
                </CardDescription>
              </div>
              <Badge variant="info" className="flex-shrink-0">
                <Zap size={10} className="mr-1" />
                Live
              </Badge>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {chartData.length === 0 ? (
              <EmptyCard
                icon={<BarChart3 size={40} />}
                title="Brak danych produkcyjnych"
                description="Wykres pojawi się po zarejestrowaniu pierwszego rozbioru"
              />
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
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="Ćwiartka" stroke="#3B82F6" strokeWidth={2}
                    fill="url(#gradBlue)" dot={false} activeDot={{ r: 4, fill: '#3B82F6', strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="Mięso" stroke="#10B981" strokeWidth={2}
                    fill="url(#gradGreen)" dot={false} activeDot={{ r: 4, fill: '#10B981', strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Bar chart — yield per day */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Wydajność rozbioru</CardTitle>
            <CardDescription>Ostatnie 7 dni (%)</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {chartData.length === 0 ? (
              <EmptyCard
                icon={<BarChart3 size={32} />}
                title="Brak danych"
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData.slice(-7)} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={30} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="Wydajność" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {chartData.slice(-7).map((entry, i) => (
                      <Cell key={i} fill={
                        entry['Wydajność'] >= 70 ? '#10B981' :
                        entry['Wydajność'] >= 60 ? '#F59E0B' : '#EF4444'
                      } />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Tables — FEFO / Rozbiory ──────────────────────────────── */}
      <Tabs defaultValue="fefo">
        <TabsList>
          <TabsTrigger value="fefo" className="gap-1.5">
            <Package size={13} />
            Partie FEFO
            {(critical.length + warnings.length) > 0 && (
              <Badge variant="danger" className="ml-1 px-1.5 py-0 text-[10px] h-4 leading-none">
                {critical.length + warnings.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="deboning" className="gap-1.5">
            <Scissors size={13} />
            Ostatnie rozbiory
          </TabsTrigger>
        </TabsList>

        {/* FEFO table */}
        <TabsContent value="fefo" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Partie ćwiartki — FEFO</CardTitle>
                <CardDescription className="mt-0.5">
                  Sortowanie wg daty ważności · {fefoSorted.length} partii
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/office/raw-batches" className="gap-1.5">
                  Zarządzaj <ArrowRight size={13} />
                </Link>
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {fefoSorted.length === 0 ? (
                <EmptyCard
                  icon={<Package size={40} />}
                  title="Brak partii"
                  description="Przyjmij pierwszą partię ćwiartki aby rozpocząć produkcję"
                  action={
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/office/raw-batches">Dodaj partię</Link>
                    </Button>
                  }
                />
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
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded cursor-default">
                                  {b.internalBatchNo}
                                </code>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-xs">
                                ID: {b.id}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <CardDescription>{b.supplierName ?? '—'}</CardDescription>
                          </TableCell>
                          <TableCell className="text-right">
                            <CardTitle className="text-sm font-semibold tabular-nums">{fmtKg(b.kgAvailable)} kg</CardTitle>
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
            {fefoSorted.length > 0 && (
              <CardFooter className="border-t pt-3 justify-end">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/office/raw-batches" className="gap-1.5 text-muted-foreground">
                    Pokaż wszystkie partie <ArrowRight size={12} />
                  </Link>
                </Button>
              </CardFooter>
            )}
          </Card>
        </TabsContent>

        {/* Deboning log table */}
        <TabsContent value="deboning" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Ostatnie rozbiory</CardTitle>
                <CardDescription className="mt-0.5">10 ostatnich wpisów rozbioru</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/office/deboning" className="gap-1.5">
                  Wszystkie <ArrowRight size={13} />
                </Link>
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {allDebonings.length === 0 ? (
                <EmptyCard
                  icon={<Scissors size={40} />}
                  title="Brak sesji rozbioru"
                  description="Wykonaj pierwszy rozbiór z poziomu tabletu hali produkcyjnej"
                />
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
                        const yld = Number(d.yieldPct)
                        const yldVariant =
                          yld >= 70 ? 'success' :
                          yld >= 60 ? 'warning' : 'danger'
                        return (
                          <TableRow key={d.id}>
                            <TableCell>
                              <code className="font-mono text-primary text-xs font-semibold">
                                {d.sessionNo}
                              </code>
                            </TableCell>
                            <TableCell>
                              <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">
                                {d.rawBatchNo}
                              </code>
                            </TableCell>
                            <TableCell>
                              <CardDescription>{d.workerName ?? '—'}</CardDescription>
                            </TableCell>
                            <TableCell className="text-right">
                              <CardTitle className="text-sm font-semibold tabular-nums">
                                {fmtKg(Number(d.kgTaken), 1)} kg
                              </CardTitle>
                            </TableCell>
                            <TableCell className="text-right">
                              <CardDescription className="tabular-nums">
                                {fmtKg(Number(d.kgMeat), 1)} kg
                              </CardDescription>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={yldVariant as any} className="tabular-nums">
                                {fmtPct(yld)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {allDebonings.length > 0 && (
              <CardFooter className="border-t pt-3 justify-end">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/office/deboning" className="gap-1.5 text-muted-foreground">
                    Pokaż wszystkie rozbiory <ArrowRight size={12} />
                  </Link>
                </Button>
              </CardFooter>
            )}
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  )
}
