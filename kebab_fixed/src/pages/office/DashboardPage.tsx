import { useEffect, useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi, finishedGoodsApi,
  deboningApi, dayClosuresApi,
} from '@/lib/apiClient'
import type { DayClosure } from '@/lib/api'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/badge'
import { fmtKg, fmtPct, fmtDatePl, getExpiryStatus, todayIso, cn } from '@/lib/utils'
import { Link } from 'react-router-dom'

import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'

import {
  AlertTriangle, Package, Beef, Boxes, ArrowRight, Clock, Zap,
  Info, Factory, Soup, Truck, ChevronDown, ChevronRight,
  Scissors, CheckCircle2, LogOut, RotateCcw, ListChecks, X,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────
// Status pill: zielona kropka (live) lub szara (zakończony)
// ─────────────────────────────────────────────────────────────────
function StatusDot({ live, closed }: { live: boolean; closed: boolean }) {
  if (closed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
        <span className="size-2 rounded-full bg-slate-500" />
        Zakończone
      </span>
    )
  }
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-green-500" />
        </span>
        Live
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      <span className="size-2 rounded-full bg-slate-400" />
      Bezczynne
    </span>
  )
}

const POLL_MS  = 7000
const KG_PER_CONTAINER = 15

// ─────────────────────────────────────────────────────────────────
// Helpers
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

type Accent = 'blue' | 'green' | 'amber' | 'red' | 'purple'
const ACCENT: Record<Accent, { icon: string; value: string }> = {
  blue:   { icon: 'bg-blue-50 text-blue-600',     value: 'text-foreground' },
  green:  { icon: 'bg-green-50 text-green-600',    value: 'text-foreground' },
  amber:  { icon: 'bg-amber-50 text-amber-600',    value: 'text-foreground' },
  red:    { icon: 'bg-red-50 text-red-600',        value: 'text-red-600'    },
  purple: { icon: 'bg-purple-50 text-purple-600',  value: 'text-foreground' },
}

function KpiCard(props: {
  label: string; value: React.ReactNode; unit?: string; sub?: string
  tooltip?: string; icon: React.ReactNode; accent: Accent
}) {
  const s = ACCENT[props.accent]
  return (
    <Card className="hover:shadow-card-hover transition-all duration-200">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-xs font-semibold uppercase tracking-wide">
                {props.label}
              </CardDescription>
              {props.tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info size={11} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    {props.tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-baseline gap-1.5">
              <CardTitle className={`text-2xl font-bold tabular-nums ${s.value}`}>
                {props.value}
              </CardTitle>
              {props.unit && (
                <CardDescription className="text-sm font-medium">{props.unit}</CardDescription>
              )}
            </div>
            {props.sub && (
              <CardDescription className="text-xs pt-0.5">{props.sub}</CardDescription>
            )}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.icon}`}>
            {props.icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyCard({ icon, title, description }: {
  icon: React.ReactNode; title: string; description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <div className="text-muted-foreground opacity-20 mb-1">{icon}</div>
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      {description && (
        <CardDescription className="text-xs text-center max-w-xs">{description}</CardDescription>
      )}
    </div>
  )
}

function ProgressBar({ value, color = 'blue', height = 8 }: {
  value: number; color?: 'blue' | 'green' | 'amber' | 'red' | 'purple'; height?: number
}) {
  const pct = Math.max(0, Math.min(100, value))
  const colors: Record<string, string> = {
    blue:   'bg-blue-500',
    green:  'bg-green-500',
    amber:  'bg-amber-500',
    red:    'bg-red-500',
    purple: 'bg-purple-500',
  }
  return (
    <div className="w-full bg-muted rounded-full overflow-hidden" style={{ height }}>
      <div
        className={`${colors[color]} h-full transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  draft:          'Szkic',
  confirmed:      'Potwierdzone',
  in_production:  'W produkcji',
  done:           'Zrealizowane',
  cancelled:      'Anulowane',
}
const ORDER_STATUS_VARIANT: Record<string, any> = {
  draft:         'outline',
  confirmed:     'info',
  in_production: 'warning',
  done:          'success',
  cancelled:     'danger',
}

// ─────────────────────────────────────────────────────────────────
// DashboardPage
// ─────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const batchRes    = useApi(() => rawBatchesApi.list({ active_only: true, limit: 500 }))
  const meatRes     = useApi(() => meatStockApi.list())
  const seasonedRes = useApi(() => seasonedMeatApi.list())
  const plansRes    = useApi(() => productionPlansApi.list())
  const mixingRes   = useApi(() => mixingOrdersApi.list())
  const ordersRes   = useApi(() => clientOrdersApi.list())
  const finishedRes = useApi(() => finishedGoodsApi.list())
  const deboningRes = useApi(() => deboningApi.list())
  const closuresRes = useApi(() => dayClosuresApi.listToday())
  const [planModal, setPlanModal] = useState<string | null>(null)

  // Live polling — odświeża sekcje produkcyjne i magazynowe co POLL_MS
  useEffect(() => {
    const t = setInterval(() => {
      batchRes.refetch()
      meatRes.refetch()
      seasonedRes.refetch()
      plansRes.refetch()
      mixingRes.refetch()
      ordersRes.refetch()
      finishedRes.refetch()
      deboningRes.refetch()
      closuresRes.refetch()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [batchRes.refetch, meatRes.refetch, seasonedRes.refetch,
      plansRes.refetch, mixingRes.refetch, ordersRes.refetch,
      finishedRes.refetch, deboningRes.refetch, closuresRes.refetch])

  // ── Day closures helpers ─────────────────────────────────────
  const closures: DayClosure[] = closuresRes.data ?? []
  function isSectionClosed(section: DayClosure['section']) {
    return closures.some(c => c.section === section)
  }
  async function closeSection(section: DayClosure['section'], label: string) {
    if (!confirm(`Zakończyć dzień: ${label}? Status zmieni się na "Zakończone".`)) return
    try {
      await dayClosuresApi.close(section)
      closuresRes.refetch()
    } catch (e) {
      alert('Błąd: ' + (e instanceof Error ? e.message : 'nieznany'))
    }
  }
  async function reopenSection(section: DayClosure['section'], label: string) {
    if (!confirm(`Wznowić dzień: ${label}?`)) return
    try {
      await dayClosuresApi.reopen(section)
      closuresRes.refetch()
    } catch (e) {
      alert('Błąd: ' + (e instanceof Error ? e.message : 'nieznany'))
    }
  }

  // Skeleton tylko przy pierwszym ładowaniu (gdy żadnych danych jeszcze nie ma).
  // Polling robi setLoading(true) na useApi przy każdym refetch — bez tego warunku
  // strona "skakałaby" co 7 s do skeletonu i z powrotem.
  const initialLoading =
    (batchRes.loading    && !batchRes.data) ||
    (meatRes.loading     && !meatRes.data)  ||
    (seasonedRes.loading && !seasonedRes.data)

  const allBatches  = batchRes.data?.data    ?? []
  const allMeat     = meatRes.data?.data     ?? []
  const allSeasoned = seasonedRes.data       ?? []
  const allPlans    = plansRes.data          ?? []
  const allMixing   = mixingRes.data         ?? []
  const allOrders   = ordersRes.data         ?? []
  const allFinished = finishedRes.data       ?? []
  const allDeboning = deboningRes.data?.data ?? []

  // ── Rozbiór — sesje z dzisiaj (live) ───────────────────────────
  const today        = todayIso()
  const todayDeb     = useMemo(
    () => [...allDeboning]
      .filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today)
      .sort((a: any, b: any) =>
        ((b.createdAt ?? b.created_at ?? '') > (a.createdAt ?? a.created_at ?? '')) ? 1 : -1
      ),
    [allDeboning, today],
  )
  const debKgQuarter = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)
  const debKgMeat    = todayDeb.reduce((s: number, d: any) => s + Number(d.kgMeat  ?? d.kg_meat  ?? 0), 0)
  const debYield     = debKgQuarter > 0 ? (debKgMeat / debKgQuarter) * 100 : 0

  // ── KPI: ćwiartka + pojemniki ──────────────────────────────────
  const activeBatches = allBatches.filter(
    b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used'
  )
  const totalKgRaw      = activeBatches.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const totalContainers = Math.ceil(totalKgRaw / KG_PER_CONTAINER)

  // ── Mięso z/s po rozbiorze ─────────────────────────────────────
  const availableMeat = allMeat.filter(m => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat   = availableMeat.reduce((s, m) => s + Number(m.kgAvailable), 0)

  // Grupowanie po rawBatchNo — sumowanie kg dla zdublowanych partii
  const meatByBatch = useMemo(() => {
    const m = new Map<string, { rawBatchNo: string; kg: number; lots: number; earliestExpiry: string }>()
    availableMeat.forEach(item => {
      const key = item.rawBatchNo ?? '—'
      const cur = m.get(key)
      if (cur) {
        cur.kg += Number(item.kgAvailable)
        cur.lots += 1
        if (item.expiryDate && (!cur.earliestExpiry || item.expiryDate < cur.earliestExpiry)) {
          cur.earliestExpiry = item.expiryDate
        }
      } else {
        m.set(key, {
          rawBatchNo: key,
          kg: Number(item.kgAvailable),
          lots: 1,
          earliestExpiry: item.expiryDate ?? '',
        })
      }
    })
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [availableMeat])

  // ── Mięso przyprawione — grupowanie po recepturze ──────────────
  const availableSeasoned = allSeasoned.filter(s => Number(s.kgAvailable) > 0)
  const totalKgSeasoned   = availableSeasoned.reduce((s, b) => s + Number(b.kgAvailable), 0)

  const seasonedByRecipe = useMemo(() => {
    const m = new Map<string, { recipeName: string; kg: number; batches: number }>()
    availableSeasoned.forEach(b => {
      const key = b.recipeName || '—'
      const cur = m.get(key)
      if (cur) {
        cur.kg += Number(b.kgAvailable)
        cur.batches += 1
      } else {
        m.set(key, { recipeName: key, kg: Number(b.kgAvailable), batches: 1 })
      }
    })
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [availableSeasoned])

  // ── Krótki termin — 3 stany: zielony / żółty / czerwony ────────
  const expired  = activeBatches.filter(b => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter(b => {
    const d = getExpiryStatus(b.expiryDate).daysLeft
    return d >= 0 && d <= 1
  })
  const warnings = activeBatches.filter(b => {
    const d = getExpiryStatus(b.expiryDate).daysLeft
    return d >= 2 && d <= 3
  })
  const shortTermCount = expired.length + critical.length + warnings.length
  const shortTermAccent: Accent =
    expired.length > 0 ? 'red'
    : (critical.length + warnings.length) > 0 ? 'amber'
    : 'green'

  // ── Produkcja LIVE — z linii planów (qtyDone × kgPerUnit) ──────
  const activePlans = allPlans.filter(p => p.status !== 'done' && p.status !== 'draft')

  // wszystkie linie aktywnych planów — to one są realnie produkowane
  const allActiveLines = useMemo(
    () => activePlans.flatMap((p: any) =>
      (p.lines ?? []).map((l: any) => ({ ...l, _plan: p }))
    ),
    [activePlans],
  )
  const prodPlanned  = allActiveLines.reduce((s: number, l: any) => s + Number(l.totalKg ?? 0), 0)
  const prodProduced = allActiveLines.reduce(
    (s: number, l: any) => s + Number(l.qtyDone ?? 0) * Number(l.kgPerUnit ?? 0), 0,
  )
  const prodPct = prodPlanned > 0 ? (prodProduced / prodPlanned) * 100 : 0
  const prodLastUpdate = allActiveLines
    .map((l: any) => l.progressUpdatedAt)
    .filter(Boolean)
    .sort()
    .pop() ?? null

  // Linie pogrupowane po statusie — ostatnie 2 zrobione + w trakcie + następne 2
  const linesByStatus = useMemo(() => {
    const lines = [...allActiveLines]
    const inProgress = lines.filter(l => (l.lineStatus ?? 'PLANNED') === 'IN_PROGRESS')
    const done       = lines.filter(l => (l.lineStatus ?? 'PLANNED') === 'DONE')
    const planned    = lines.filter(l => (l.lineStatus ?? 'PLANNED') === 'PLANNED')
    // ostatnie 2 done (po progress_updated_at desc), 1 w trakcie pierwsze, 2 najbliższe planned
    const sortedDone = done.sort((a, b) =>
      String(b.progressUpdatedAt ?? '').localeCompare(String(a.progressUpdatedAt ?? '')),
    )
    return {
      done: sortedDone.slice(0, 2).reverse(), // chronologicznie: starsze → nowsze
      inProgress,
      planned: planned.slice(0, 2),
    }
  }, [allActiveLines])

  // ── Masowanie LIVE ─────────────────────────────────────────────
  const activeMixing = allMixing.filter(o => o.status !== 'done' && o.status !== 'cancelled')
  const mixPlanned   = activeMixing.reduce((s, o) => s + Number(o.meatKg), 0)
  const mixDone      = activeMixing.reduce((s, o) => s + Number(o.kgDone), 0)
  const mixPct       = mixPlanned > 0 ? (mixDone / mixPlanned) * 100 : 0

  // ── Zamówienia — sort po deliveryDate ASC, exclude done/cancelled ─
  const finishedQtyByOrderNo = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => {
      const k = f.clientOrderNo ?? ''
      if (!k) return
      m.set(k, (m.get(k) ?? 0) + Number(f.qty ?? 0))
    })
    return m
  }, [allFinished])

  const visibleOrders = useMemo(() => {
    return [...allOrders]
      .filter(o => o.status !== 'done' && o.status !== 'cancelled')
      .sort((a, b) => {
        const da = a.deliveryDate || '9999-12-31'
        const db = b.deliveryDate || '9999-12-31'
        return da.localeCompare(db)
      })
  }, [allOrders])

  // Loading state ─────────────────────────────────────────────────
  if (initialLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <KpiSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── KPI row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Ćwiartka dostępna"
          value={fmtKg(totalKgRaw, 0)}
          unit="kg"
          sub={`${totalContainers} poj. · ${activeBatches.length} partii`}
          tooltip={`Łączna kg ćwiartki we wszystkich aktywnych partiach. Pojemnik = ${KG_PER_CONTAINER} kg.`}
          icon={<Beef size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Mięso z/s po rozbiorze"
          value={fmtKg(totalKgMeat, 0)}
          unit="kg"
          sub={`${meatByBatch.length} partii`}
          tooltip="Mięso po rozbiorze gotowe do masowania (status AVAILABLE)"
          icon={<Package size={18} />}
          accent="green"
        />
        <KpiCard
          label="Mięso przyprawione"
          value={fmtKg(totalKgSeasoned, 0)}
          unit="kg"
          sub={`${seasonedByRecipe.length} receptur`}
          tooltip="Mięso po masowaniu, gotowe do produkcji (kg dostępne)"
          icon={<Boxes size={18} />}
          accent="purple"
        />
        <KpiCard
          label="Krótki termin"
          value={shortTermCount}
          unit="partii"
          sub={
            expired.length > 0
              ? `${expired.length} po terminie · ${critical.length + warnings.length} krótkich`
              : (critical.length + warnings.length) > 0
                ? `${critical.length + warnings.length} kończy się ≤3 dni`
                : 'Brak — wszystko OK'
          }
          tooltip="Partie ćwiartki: po terminie (czerwony), kończą się ≤3 dni (żółty), brak alertów (zielony)"
          icon={shortTermAccent === 'green' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          accent={shortTermAccent}
        />
      </div>

      {/* ── Krótki termin — alerty ──────────────────────────────── */}
      {(expired.length > 0 || critical.length > 0 || warnings.length > 0) && (
        <div className="space-y-3">
          {(expired.length + critical.length) > 0 && (
            <Card className="border-red-200 bg-red-50 overflow-hidden">
              <CardHeader className="py-3 px-4 border-b border-red-200 flex-row items-center space-y-0 gap-2">
                <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={13} className="text-red-600" />
                </div>
                <CardTitle className="text-sm font-semibold text-red-800 flex-1">
                  Krótki termin — po terminie lub wygasa dziś/jutro
                </CardTitle>
                <Badge variant="danger">
                  {expired.length + critical.length} {(expired.length + critical.length) === 1 ? 'partia' : 'partii'}
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {[...expired, ...critical].map(b => {
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

          {warnings.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 overflow-hidden">
              <CardHeader className="py-3 px-4 border-b border-amber-200 flex-row items-center space-y-0 gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Clock size={13} className="text-amber-600" />
                </div>
                <CardTitle className="text-sm font-semibold text-amber-800 flex-1">
                  Krótki termin — wygasa w 2–3 dni
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

      {/* ── Rozbiór + Masowanie + Produkcja — kafelki ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Rozbiór */}
        {(() => {
          const closed = isSectionClosed('rozbior')
          const live = !closed && todayDeb.length > 0
          const ratio = totalKgRaw > 0 ? Math.min(100, (debKgQuarter / (debKgQuarter + totalKgRaw)) * 100) : 0
          return (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Scissors size={15} className="text-amber-500" />
                    Rozbiór
                  </CardTitle>
                  <StatusDot live={live} closed={closed} />
                </div>
                <CardDescription className="mt-0.5">
                  Pobrana ćwiartka dziś · dostępne partie
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="pt-4 space-y-3">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <CardDescription className="text-xs uppercase tracking-wide font-semibold">
                      Pobrana dziś
                    </CardDescription>
                    <div className="text-sm tabular-nums">
                      <span className="font-bold">{fmtKg(debKgQuarter, 0)}</span>
                      <span className="text-muted-foreground"> / {fmtKg(totalKgRaw, 0)} kg</span>
                    </div>
                  </div>
                  <ProgressBar value={ratio} color="amber" height={10} />
                </div>

                <Separator />

                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Dostępne partie · {meatByBatch.length}
                  </div>
                  {meatByBatch.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">Brak partii w magazynie</div>
                  ) : (
                    <ul className="space-y-1 max-h-32 overflow-y-auto">
                      {meatByBatch.slice(0, 5).map(g => (
                        <li key={g.rawBatchNo} className="flex justify-between text-xs">
                          <code className="font-mono font-bold text-xs">{g.rawBatchNo}</code>
                          <span className="tabular-nums">{fmtKg(g.kg, 0)} kg</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {todayDeb.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Sesje dziś · {todayDeb.length}
                      </div>
                      <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                        {todayDeb.slice(0, 5).map((d: any) => (
                          <li key={d.id} className="flex justify-between text-xs">
                            <span className="truncate">{d.workerName ?? d.worker_name ?? '—'} · <code className="font-mono">{d.rawBatchNo ?? d.raw_batch_no ?? ''}</code></span>
                            <span className="tabular-nums shrink-0 ml-2">{fmtKg(Number(d.kgMeat ?? d.kg_meat ?? 0), 0)}/{fmtKg(Number(d.kgTaken ?? d.kg_taken ?? 0), 0)} kg</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                <Separator />
                {closed ? (
                  <Button size="sm" variant="outline" className="w-full gap-1.5"
                          onClick={() => reopenSection('rozbior', 'Rozbiór')}>
                    <RotateCcw size={13} /> Wznów dzień
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full gap-1.5"
                          onClick={() => closeSection('rozbior', 'Rozbiór')}>
                    <LogOut size={13} /> Zakończ dzień
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })()}

        {/* Masownia */}
        {(() => {
          const closed = isSectionClosed('masownia')
          const live = !closed && activeMixing.length > 0 && mixDone > 0
          return (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Soup size={15} className="text-purple-500" />
                    Masownia
                  </CardTitle>
                  <StatusDot live={live} closed={closed} />
                </div>
                <CardDescription className="mt-0.5">
                  {activeMixing.length} {activeMixing.length === 1 ? 'aktywne zlecenie' : 'aktywne zlecenia'}
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="pt-4 space-y-3">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <CardDescription className="text-xs uppercase tracking-wide font-semibold">
                      Postęp łączny
                    </CardDescription>
                    <div className="text-sm tabular-nums">
                      <span className="font-bold">{fmtKg(mixDone, 0)}</span>
                      <span className="text-muted-foreground"> / {fmtKg(mixPlanned, 0)} kg</span>
                      <span className="ml-2 font-bold text-purple-600">{mixPct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <ProgressBar value={mixPct} color="purple" height={10} />
                </div>

                <Separator />

                {activeMixing.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">Brak aktywnych zleceń</div>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {activeMixing.map(m => {
                      const pct = Number(m.meatKg) > 0 ? (Number(m.kgDone) / Number(m.meatKg)) * 100 : 0
                      return (
                        <div key={m.id} className="space-y-0.5 p-1.5 rounded hover:bg-muted/40">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate font-semibold">{m.recipeName}</span>
                            <span className="tabular-nums shrink-0">
                              <span className="font-bold">{fmtKg(m.kgDone, 0)}</span>
                              <span className="text-muted-foreground"> / {fmtKg(m.meatKg, 0)} kg</span>
                            </span>
                          </div>
                          <ProgressBar value={pct} color="purple" height={4} />
                        </div>
                      )
                    })}
                  </div>
                )}

                <Separator />
                {closed ? (
                  <Button size="sm" variant="outline" className="w-full gap-1.5"
                          onClick={() => reopenSection('masownia', 'Masownia')}>
                    <RotateCcw size={13} /> Wznów dzień
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full gap-1.5"
                          onClick={() => closeSection('masownia', 'Masownia')}>
                    <LogOut size={13} /> Zakończ dzień
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })()}

        {/* Produkcja */}
        {(() => {
          const closed = isSectionClosed('produkcja')
          // Live gdy w ostatniej 1h przyszedł update
          const recent = prodLastUpdate
            ? (Date.now() - new Date(prodLastUpdate).getTime()) < 60 * 60 * 1000
            : false
          const live = !closed && (recent || linesByStatus.inProgress.length > 0)
          const slice = [
            ...linesByStatus.done.map((l: any) => ({ ...l, _bucket: 'done'    as const })),
            ...linesByStatus.inProgress.map((l: any) => ({ ...l, _bucket: 'inProgress' as const })),
            ...linesByStatus.planned.map((l: any) => ({ ...l, _bucket: 'planned' as const })),
          ]
          return (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Factory size={15} className="text-blue-500" />
                    Produkcja
                  </CardTitle>
                  <StatusDot live={live} closed={closed} />
                </div>
                <CardDescription className="mt-0.5">
                  {activePlans.length} {activePlans.length === 1 ? 'aktywny plan' : 'aktywne plany'} · {allActiveLines.length} pozycji
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="pt-4 space-y-3">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <CardDescription className="text-xs uppercase tracking-wide font-semibold">
                      Postęp łączny
                    </CardDescription>
                    <div className="text-sm tabular-nums">
                      <span className="font-bold">{fmtKg(prodProduced, 0)}</span>
                      <span className="text-muted-foreground"> / {fmtKg(prodPlanned, 0)} kg</span>
                      <span className="ml-2 font-bold text-blue-600">{prodPct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <ProgressBar value={prodPct} color="blue" height={10} />
                </div>

                <Separator />

                {slice.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">Brak aktywnych pozycji</div>
                ) : (
                  <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {slice.map((l: any) => {
                      const qty = Number(l.qty ?? 0)
                      const done = Number(l.qtyDone ?? 0)
                      const pct = qty > 0 ? (done / qty) * 100 : 0
                      const isDone = l._bucket === 'done'
                      const isProg = l._bucket === 'inProgress'
                      return (
                        <li key={l.id}
                            className={cn(
                              'p-1.5 rounded border-l-2',
                              isDone   ? 'border-l-green-500 bg-green-50/50'
                              : isProg ? 'border-l-amber-500 bg-amber-50/50'
                              :          'border-l-slate-300 bg-muted/30',
                            )}
                        >
                          <div className="flex items-center gap-2 text-xs">
                            {isDone   && <CheckCircle2 size={12} className="text-green-600 shrink-0" />}
                            {isProg   && <Zap size={12} className="text-amber-600 shrink-0 animate-pulse" />}
                            {!isDone && !isProg && <Clock size={12} className="text-slate-400 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-bold">
                                {done}/{qty} szt × {l.kgPerUnit} kg
                                <span className="ml-1 text-muted-foreground font-normal">· {l.recipeName ?? '—'}</span>
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {l.clientName ?? '—'} {l._plan?.planNo && <>· <code className="font-mono">{l._plan.planNo}</code></>}
                              </div>
                            </div>
                            <span className="text-[11px] font-bold tabular-nums shrink-0">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <Separator />
                <div className="flex gap-2">
                  {activePlans.length > 0 && (
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5"
                            onClick={() => setPlanModal(activePlans[0].id)}>
                      <ListChecks size={13} /> Pełna lista
                    </Button>
                  )}
                  {closed ? (
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5"
                            onClick={() => reopenSection('produkcja', 'Produkcja')}>
                      <RotateCcw size={13} /> Wznów dzień
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5"
                            onClick={() => closeSection('produkcja', 'Produkcja')}>
                      <LogOut size={13} /> Zakończ dzień
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })()}

      </div>

      {/* Modal: pełna lista planu produkcji */}
      {planModal && (() => {
        const plan = allPlans.find((p: any) => p.id === planModal)
        if (!plan) return null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
               onClick={() => setPlanModal(null)}>
            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b flex items-center justify-between">
                <div>
                  <div className="text-base font-bold">Plan produkcji {plan.planNo}</div>
                  <div className="text-xs text-muted-foreground">{plan.planDate} · {plan.lines.length} pozycji</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPlanModal(null)}>
                  <X size={16} />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Pozycja</TableHead>
                      <TableHead>Klient</TableHead>
                      <TableHead className="text-right">Postęp</TableHead>
                      <TableHead className="w-24 text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.lines.map((l: any, idx: number) => {
                      const qty = Number(l.qty ?? 0)
                      const done = Number(l.qtyDone ?? 0)
                      const pct = qty > 0 ? (done / qty) * 100 : 0
                      const st = (l.lineStatus ?? 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE'
                      return (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs tabular-nums">{idx + 1}</TableCell>
                          <TableCell>
                            <div className="text-sm font-bold">{done}/{qty} szt × {l.kgPerUnit} kg</div>
                            <div className="text-xs text-muted-foreground">{l.recipeName ?? '—'}</div>
                          </TableCell>
                          <TableCell className="text-xs">{l.clientName ?? '—'}</TableCell>
                          <TableCell className="text-right text-sm">
                            <span className="font-bold tabular-nums">{fmtKg(done * Number(l.kgPerUnit ?? 0), 0)}</span>
                            <span className="text-muted-foreground"> / {fmtKg(l.totalKg ?? 0, 0)} kg</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={st === 'DONE' ? 'success' : st === 'IN_PROGRESS' ? 'warning' : 'outline'}>
                              {pct.toFixed(0)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Magazyny: Mięso z/s i Mięso przyprawione ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Mięso z/s — grupowane po rawBatchNo */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package size={15} className="text-green-500" />
                Mięso z/s — po rozbiorze
              </CardTitle>
              <CardDescription className="mt-0.5">
                Suma kg per partia surowca · {meatByBatch.length} partii
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/office/magazyn/surowiec" className="gap-1.5">
                Magazyn <ArrowRight size={13} />
              </Link>
            </Button>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            {meatByBatch.length === 0 ? (
              <EmptyCard icon={<Package size={36} />} title="Brak mięsa w magazynie"
                description="Wykonaj rozbiór aby zasilić magazyn" />
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs uppercase tracking-wide">Partia surowca</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-center">Lotów</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide">Najbliższa ważność</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-right">Razem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meatByBatch.map(g => (
                      <TableRow key={g.rawBatchNo}>
                        <TableCell>
                          <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">
                            {g.rawBatchNo}
                          </code>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="tabular-nums">{g.lots}</Badge>
                        </TableCell>
                        <TableCell>
                          {g.earliestExpiry ? <ExpiryBadge dateStr={g.earliestExpiry} /> : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <CardTitle className="text-sm font-semibold tabular-nums">
                            {fmtKg(g.kg, 1)} kg
                          </CardTitle>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mięso przyprawione — grupowane po recepturze */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Boxes size={15} className="text-purple-500" />
                Mięso przyprawione — magazyn
              </CardTitle>
              <CardDescription className="mt-0.5">
                Suma kg per receptura · {seasonedByRecipe.length} receptur
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/office/magazyn/mieso-przyp" className="gap-1.5">
                Magazyn <ArrowRight size={13} />
              </Link>
            </Button>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            {seasonedByRecipe.length === 0 ? (
              <EmptyCard icon={<Boxes size={36} />} title="Brak mięsa przyprawionego"
                description="Zakończ zlecenie masowania aby zasilić magazyn" />
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs uppercase tracking-wide">Receptura</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-center">Szarż</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-right">Razem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seasonedByRecipe.map(g => (
                      <TableRow key={g.recipeName}>
                        <TableCell>
                          <CardTitle className="text-sm font-semibold">{g.recipeName}</CardTitle>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="tabular-nums">{g.batches}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <CardTitle className="text-sm font-semibold tabular-nums">
                            {fmtKg(g.kg, 1)} kg
                          </CardTitle>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Zamówienia — sort po dacie dostawy ───────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck size={15} className="text-amber-500" />
              Zamówienia od klientów
            </CardTitle>
            <CardDescription className="mt-0.5">
              Sortowanie od najszybszej daty wyjazdu · {visibleOrders.length} aktywnych
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/office/zamowienia" className="gap-1.5">
              Wszystkie <ArrowRight size={13} />
            </Link>
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {visibleOrders.length === 0 ? (
            <EmptyCard icon={<Truck size={36} />} title="Brak aktywnych zamówień"
              description="Utwórz zamówienie w sekcji „Zamówienia od klientów”" />
          ) : (
            <div className="divide-y">
              {visibleOrders.map(o => <OrderRow key={o.id} order={o}
                qtyDone={finishedQtyByOrderNo.get(o.orderNo) ?? 0} />)}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// OrderRow — wiersz zamówienia z paskiem postępu i podglądem pozycji
// ─────────────────────────────────────────────────────────────────
function OrderRow({ order, qtyDone }: { order: any; qtyDone: number }) {
  const [open, setOpen] = useState(false)
  const qtyTotal = Number(order.totalUnits ?? 0)
  const pct      = qtyTotal > 0 ? (qtyDone / qtyTotal) * 100 : 0
  const isDue    = order.deliveryDate
    ? new Date(order.deliveryDate).getTime() - Date.now() < 1000 * 60 * 60 * 48
    : false

  return (
    <div className="px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono font-bold text-primary text-xs">{order.orderNo}</code>
            <CardTitle className="text-sm truncate">{order.clientName}</CardTitle>
            <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'outline'} className="text-[10px]">
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </Badge>
            {order.deliveryDate && (
              <Badge variant={isDue ? 'danger' : 'outline'} className="text-[10px] gap-1">
                <Truck size={9} /> {fmtDatePl(order.deliveryDate)}
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="flex-1 max-w-md">
              <ProgressBar value={pct} color={pct >= 100 ? 'green' : pct > 0 ? 'amber' : 'blue'} height={6} />
            </div>
            <div className="text-xs tabular-nums whitespace-nowrap">
              <span className="font-bold">{qtyDone}</span>
              <span className="text-muted-foreground"> / {qtyTotal} szt</span>
              <span className="ml-2 font-semibold text-amber-600">{pct.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-3 pl-7">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wide">Szt</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">kg/szt</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">Razem kg</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">Rodzaj</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">Receptura</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">Tuleja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.lines ?? []).map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="font-bold text-xs">{l.qty}</TableCell>
                  <TableCell className="text-xs">{l.kgPerUnit} kg</TableCell>
                  <TableCell>
                    <CardTitle className="text-xs text-primary tabular-nums">
                      {fmtKg(l.totalKg, 0)} kg
                    </CardTitle>
                  </TableCell>
                  <TableCell className="text-xs">{l.productTypeName || '—'}</TableCell>
                  <TableCell className="text-xs">{l.recipeName || '—'}</TableCell>
                  <TableCell>
                    <CardDescription className="text-xs">{l.packagingName || '—'}</CardDescription>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// Suppress unused warning — StatusBadge eksportowany dla kompat. wstecznej
void StatusBadge
