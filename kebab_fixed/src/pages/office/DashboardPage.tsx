import { Fragment, useEffect, useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { ProcessStatusBadge } from '@/features/operations/ProcessStatusBadge'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi, finishedGoodsApi,
  deboningApi,
} from '@/lib/apiClient'
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
  Scissors, CheckCircle2, Cog,
} from 'lucide-react'

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
const ACCENT: Record<Accent, { icon: string; value: string; bar: string }> = {
  blue:   { icon: 'bg-blue-50 text-blue-600 ring-1 ring-blue-100',         value: 'text-ink',     bar: 'from-blue-400 via-blue-500 to-blue-400' },
  green:  { icon: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100', value: 'text-ink',    bar: 'from-emerald-400 via-emerald-500 to-emerald-400' },
  amber:  { icon: 'bg-amber-50 text-amber-600 ring-1 ring-amber-100',       value: 'text-ink',    bar: 'from-amber-400 via-amber-500 to-amber-400' },
  red:    { icon: 'bg-red-50 text-red-600 ring-1 ring-red-100',             value: 'text-red-600', bar: 'from-red-400 via-red-500 to-red-400' },
  purple: { icon: 'bg-purple-50 text-purple-600 ring-1 ring-purple-100',    value: 'text-ink',    bar: 'from-purple-400 via-purple-500 to-purple-400' },
}

function KpiCard(props: {
  label: string; value: React.ReactNode; unit?: string; sub?: string
  tooltip?: string; icon: React.ReactNode; accent: Accent
}) {
  const s = ACCENT[props.accent]
  return (
    <Card className="relative overflow-hidden hover:shadow-card-hover transition-shadow duration-200">
      {/* premium top accent line */}
      <div className={`absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r ${s.bar} opacity-70`} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              {props.label}
            </CardDescription>
            {props.tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-ink-4 hover:text-ink-2 transition-colors">
                    <Info size={10} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">
                  {props.tooltip}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.icon}`}>
            {props.icon}
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={`font-mono text-[26px] font-semibold tabular-nums tracking-tight leading-none ${s.value}`}>
            {props.value}
          </span>
          {props.unit && (
            <span className="text-xs font-medium text-ink-3">{props.unit}</span>
          )}
        </div>
        {props.sub && (
          <div className="text-[11px] pt-2 text-ink-3">{props.sub}</div>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyCard({ icon, title, description }: {
  icon: React.ReactNode; title: string; description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 px-6">
      <div className="text-ink-5 opacity-50 mb-1">{icon}</div>
      <div className="font-serif italic text-lg text-ink-3 leading-tight">{title}</div>
      {description && (
        <CardDescription className="text-xs text-center max-w-xs">{description}</CardDescription>
      )}
    </div>
  )
}

/**
 * Status bar — wskaźnik live + zegar + data.
 * "Na żywo" świeci się tylko gdy zakład faktycznie pracuje
 * (przynajmniej jeden z procesów: rozbiór/masowanie/produkcja).
 */
function DashboardStatusBar({ live }: { live: boolean }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3 rounded-xl border border-surface-4 bg-white shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        {live ? (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        ) : (
          <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-300 flex-shrink-0" />
        )}
        <span className={cn(
          'text-[10px] font-semibold uppercase tracking-[0.18em] leading-none',
          live ? 'text-ink-2' : 'text-slate-500',
        )}>
          {live ? 'Na żywo' : 'Oczekuje'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-0 divide-x divide-surface-4">
          <div className="px-4 flex flex-col items-end gap-1">
            <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-ink-4">Czas</span>
            <span className="font-mono tabular-nums text-ink font-medium leading-none">{time}</span>
          </div>
          <div className="px-4 flex flex-col items-end gap-1">
            <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-ink-4">Data</span>
            <span className="font-mono tabular-nums text-ink font-medium leading-none">{date}</span>
          </div>
        </div>
      </div>
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
    }, POLL_MS)
    return () => clearInterval(t)
  }, [batchRes.refetch, meatRes.refetch, seasonedRes.refetch,
      plansRes.refetch, mixingRes.refetch, ordersRes.refetch,
      finishedRes.refetch, deboningRes.refetch])

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
  const finishedBatches = allBatches.filter(
    b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) === 'used'
  )
  // Suma kg mięsa z/s per partia surowca (z wpisów rozbioru) — pokazywane w "Zakończone".
  const meatKgByBatchId = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of allDeboning) {
      const id = (d as any).rawBatchId ?? (d as any).raw_batch_id
      if (!id) continue
      const kg = Number((d as any).kgMeat ?? (d as any).kg_meat ?? 0)
      m.set(id, (m.get(id) ?? 0) + kg)
    }
    return m
  }, [allDeboning])
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

  // ── Produkcja LIVE — z planów + finished goods ─────────────────
  const activePlans = allPlans.filter(p => p.status !== 'done' && p.status !== 'draft')
  const finishedKgByPlan = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => {
      const k = f.planNo ?? ''
      if (!k) return
      m.set(k, (m.get(k) ?? 0) + Number(f.totalKg ?? 0))
    })
    return m
  }, [allFinished])

  const prodPlanned  = activePlans.reduce((s, p) => s + Number(p.totalKg), 0)
  // Live = zamknięte (finished_goods) + w trakcie (qtyDone z linii planu).
  // Używamy w obu miejscach: globalnym pasku i wierszu per-plan, żeby były spójne —
  // inaczej globalny pasek "skacze" po polling a per-plan stoi do finish-day i wygląda
  // jakby refresh nic nie robił.
  const producedKgForPlan = (p: any) => {
    const finished = finishedKgByPlan.get(p.planNo) ?? 0
    const inProgress = (p.lines ?? []).reduce(
      (s: number, l: any) => s + (Number(l.qtyDone) || 0) * (Number(l.kgPerUnit) || 0),
      0,
    )
    return finished + inProgress
  }
  const prodProduced = activePlans.reduce((s, p) => s + producedKgForPlan(p), 0)
  const prodPct      = prodPlanned > 0 ? (prodProduced / prodPlanned) * 100 : 0

  // ── Produkcja: agregacja per typ produktu (recipe + waga + opakowanie) ─
  // Łączymy linie z różnych aktywnych planów żeby pokazać "co realnie się produkuje".
  // Trzymamy też set klientów (czyj towar idzie) i klientów-w-trakcie (te które mają IN_PROGRESS).
  const productionTypes = useMemo(() => {
    type Bucket = {
      key: string
      recipeName: string
      kgPerUnit: number
      packagingName: string
      qtyPlanned: number
      qtyDone: number
      kgPlanned: number
      kgDone: number
      inProgress: boolean
      done: boolean
      clientNames: Set<string>
      clientsInProgress: Set<string>
    }
    const m = new Map<string, Bucket>()
    for (const p of activePlans) {
      for (const l of (p.lines ?? [])) {
        const recipeName = l.recipeName || '—'
        const kgPerUnit = Number(l.kgPerUnit) || 0
        const packagingName = (l as any).packagingName || ''
        const clientName = ((l as any).clientName || '').trim()
        const key = `${recipeName}|${kgPerUnit}|${packagingName}`
        const qty = Number(l.qty) || 0
        const qtyDone = Number((l as any).qtyDone) || 0
        const status = ((l as any).lineStatus ?? 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE'
        const cur = m.get(key) ?? {
          key, recipeName, kgPerUnit, packagingName,
          qtyPlanned: 0, qtyDone: 0, kgPlanned: 0, kgDone: 0,
          inProgress: false, done: true,
          clientNames: new Set<string>(),
          clientsInProgress: new Set<string>(),
        }
        cur.qtyPlanned += qty
        cur.qtyDone   += qtyDone
        cur.kgPlanned += qty * kgPerUnit
        cur.kgDone    += qtyDone * kgPerUnit
        if (status === 'IN_PROGRESS') cur.inProgress = true
        if (status !== 'DONE')        cur.done = false
        if (clientName) cur.clientNames.add(clientName)
        if (clientName && status === 'IN_PROGRESS') cur.clientsInProgress.add(clientName)
        m.set(key, cur)
      }
    }
    // sortuj: aktualnie produkowane na górze, potem te ze startem (qtyDone > 0), na końcu zaplanowane
    return Array.from(m.values()).sort((a, b) => {
      const aw = a.inProgress ? 0 : a.qtyDone > 0 ? 1 : 2
      const bw = b.inProgress ? 0 : b.qtyDone > 0 ? 1 : 2
      if (aw !== bw) return aw - bw
      return b.kgPlanned - a.kgPlanned
    })
  }, [activePlans])

  const currentlyProducing = productionTypes.filter(t => t.inProgress)

  // ── Live qty wyprodukowane (w trakcie) per zamówienie i per pozycja zamówienia ─
  // Agregujemy qty_done z linii aktywnych planów, które wskazują na clientOrderId / clientOrderLineId.
  // Sekcja "Zamówienia od klientów" sumuje to z finished_goods (po finish-day) — pokazuje live postęp,
  // który rośnie z każdym wpisem operatora na tablecie (PATCH .../lines/{id}/progress).
  const { inProgressQtyByOrderId, inProgressQtyByOrderLineId } = useMemo(() => {
    const byOrder = new Map<string, number>()
    const byLine  = new Map<string, number>()
    for (const p of activePlans) {
      for (const l of (p.lines ?? [])) {
        const orderId = (l as any).clientOrderId || ''
        const orderLineId = (l as any).clientOrderLineId || ''
        const qtyDone = Number((l as any).qtyDone) || 0
        if (qtyDone <= 0) continue
        if (orderId) byOrder.set(orderId, (byOrder.get(orderId) ?? 0) + qtyDone)
        if (orderLineId) byLine.set(orderLineId, (byLine.get(orderLineId) ?? 0) + qtyDone)
      }
    }
    return { inProgressQtyByOrderId: byOrder, inProgressQtyByOrderLineId: byLine }
  }, [activePlans])

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

      {/* ── Status bar ────────────────────────────────────────── */}
      {/* Czy zakład pracuje? — przynajmniej jeden proces aktywny. */}
      {(() => {
        const debLive  = todayDeb.length > 0
        const mixLive  = activeMixing.some((o: any) => o.status === 'in_progress')
        const prodLive = activePlans.some((p: any) =>
          (p.lines ?? []).some((l: any) => (l.lineStatus ?? '') === 'IN_PROGRESS'))
        return <DashboardStatusBar live={debLive || mixLive || prodLive} />
      })()}

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

      {/* ── Rozbiór + Masowanie + Produkcja — na żywo ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Rozbiór */}
        {(() => {
          const dataActive = todayDeb.length > 0
          return (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Scissors size={15} className={dataActive ? "text-amber-500 animate-pulse" : "text-gray-400"} />
                  Rozbiór
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Dzisiaj · {todayDeb.length} {todayDeb.length === 1 ? 'sesja' : 'sesji'}
                </CardDescription>
              </div>
              <ProcessStatusBadge processType="deboning" dataActive={dataActive} />
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {(() => {
              const totalToday = totalKgRaw + debKgQuarter
              const pct = totalToday > 0 ? (debKgQuarter / totalToday) * 100 : 0
              return (
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <CardDescription className="text-xs uppercase tracking-wide font-semibold">
                      Pobrane dziś
                    </CardDescription>
                    <div className="text-xs tabular-nums">
                      <span className="font-bold text-foreground">{fmtKg(debKgQuarter, 0)} kg</span>
                      <span className="text-muted-foreground"> / {fmtKg(totalToday, 0)} kg</span>
                      <span className="ml-2 font-bold text-amber-600">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <ProgressBar value={pct} color="amber" height={10} />
                </div>
              )
            })()}

            <Separator />

            {activeBatches.length === 0 && finishedBatches.length === 0 ? (
              <EmptyCard icon={<Scissors size={36} />} title="Brak partii w magazynie"
                description="Po przyjęciu surowca partie pojawią się tutaj" />
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {activeBatches.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">
                      Partie w magazynie · {activeBatches.length}
                    </div>
                    {[...activeBatches]
                      .sort((a, b) => {
                        if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
                        return (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)
                      })
                      .map(b => {
                        const received  = Number(b.kgReceived)  || 0
                        const available = Number(b.kgAvailable) || 0
                        const used      = Math.max(0, received - available)
                        const pctLeft   = received > 0 ? (available / received) * 100 : 0
                        const supplier  = b.supplierDisplayName || b.supplierName || ''
                        return (
                          <div key={b.id} className="p-2 rounded-lg hover:bg-muted/50">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="min-w-0">
                                <code className="font-mono font-bold text-primary">{b.internalBatchNo}</code>
                                {supplier && (
                                  <span className="text-muted-foreground"> · {supplier}</span>
                                )}
                              </div>
                              <div className="tabular-nums flex-shrink-0 text-right">
                                <div>
                                  <span className="font-bold">{fmtKg(available, 0)} kg</span>
                                  <span className="text-muted-foreground"> / {fmtKg(received, 0)} kg</span>
                                  <span className={`ml-2 font-semibold ${
                                    pctLeft >= 50 ? 'text-green-600' : pctLeft >= 20 ? 'text-amber-600' : 'text-red-600'
                                  }`}>{pctLeft.toFixed(0)}%</span>
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  użyto {fmtKg(used, 0)} kg
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}

                {finishedBatches.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle2 size={11} className="text-green-600" />
                      Zakończone · {finishedBatches.length}
                    </div>
                    {[...finishedBatches]
                      .sort((a, b) => (b.internalBatchSeq ?? 0) - (a.internalBatchSeq ?? 0))
                      .map(b => {
                        const received = Number(b.kgReceived) || 0
                        const meat     = meatKgByBatchId.get(b.id) ?? 0
                        const yieldP   = received > 0 ? (meat / received) * 100 : 0
                        const supplier = b.supplierDisplayName || b.supplierName || ''
                        return (
                          <div key={b.id} className="p-2 rounded-lg hover:bg-muted/50 opacity-80">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="min-w-0">
                                <code className="font-mono font-bold text-muted-foreground">{b.internalBatchNo}</code>
                                {supplier && (
                                  <span className="text-muted-foreground"> · {supplier}</span>
                                )}
                              </div>
                              <div className="tabular-nums flex-shrink-0 text-right">
                                <div>
                                  <span className="text-muted-foreground">{fmtKg(received, 0)} kg ćw. → </span>
                                  <span className="font-bold text-green-600">{fmtKg(meat, 0)} kg z/s</span>
                                </div>
                                {meat > 0 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    wydajność <span className={`font-semibold ${
                                      yieldP >= 70 ? 'text-green-600' : yieldP >= 60 ? 'text-amber-600' : 'text-red-600'
                                    }`}>{yieldP.toFixed(0)}%</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
          )
        })()}

        {/* Masowanie */}
        {(() => {
          const dataActive = activeMixing.some((o: any) => o.status === 'in_progress')
          return (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Soup size={15} className={dataActive ? "text-purple-500 animate-pulse" : "text-gray-400"} />
                  Masowanie
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Aktywne zlecenia · {activeMixing.length}
                </CardDescription>
              </div>
              <ProcessStatusBadge processType="mixing" dataActive={dataActive} />
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <CardDescription className="text-xs uppercase tracking-wide font-semibold">
                  Postęp łączny
                </CardDescription>
                <div className="text-xs tabular-nums">
                  <span className="font-bold text-foreground">{fmtKg(mixDone, 0)} kg</span>
                  <span className="text-muted-foreground"> / {fmtKg(mixPlanned, 0)} kg</span>
                  <span className="ml-2 font-bold text-purple-600">{mixPct.toFixed(0)}%</span>
                </div>
              </div>
              <ProgressBar value={mixPct} color="purple" height={10} />
            </div>

            <Separator />

            {activeMixing.length === 0 ? (
              <EmptyCard icon={<Soup size={36} />} title="Brak aktywnych zleceń masowania" />
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {activeMixing.map(m => {
                  const pct = Number(m.meatKg) > 0 ? (Number(m.kgDone) / Number(m.meatKg)) * 100 : 0
                  return (
                    <div key={m.id} className="space-y-1 p-2 rounded-lg hover:bg-muted/50">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-xs tabular-nums">
                          <span className="font-bold">{fmtKg(m.kgDone, 0)} kg</span>
                          <span className="text-muted-foreground"> / {fmtKg(m.meatKg, 0)} kg</span>
                        </div>
                        <span className="text-xs font-semibold text-purple-600 tabular-nums">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                      <CardDescription className="text-xs truncate">{m.recipeName}</CardDescription>
                      <ProgressBar value={pct} color="purple" height={6} />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
          )
        })()}

        {/* Produkcja */}
        {(() => {
          // Sygnał "Na żywo" pochodzi przede wszystkim z production_sessions
          // (open/closed/approved) — patrz ProcessStatusBadge. dataActive to
          // tylko fallback gdy operator nie korzysta z sesji; bazujemy na
          // jakimkolwiek IN_PROGRESS niezależnie od czasu — przerwa pracownika
          // (np. 40 min) nie ma usuwać statusu LIVE.
          const dataActive = activePlans.some((p: any) =>
            (p.lines ?? []).some((l: any) => (l.lineStatus ?? '') === 'IN_PROGRESS'))
          return (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Factory size={15} className={dataActive ? "text-blue-500 animate-pulse" : "text-gray-400"} />
                  Produkcja
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Aktywne plany · {activePlans.length}
                </CardDescription>
              </div>
              <ProcessStatusBadge processType="production" dataActive={dataActive} />
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <CardDescription className="text-xs uppercase tracking-wide font-semibold">
                  Postęp łączny
                </CardDescription>
                <div className="text-xs tabular-nums">
                  <span className="font-bold text-foreground">{fmtKg(prodProduced, 0)} kg</span>
                  <span className="text-muted-foreground"> / {fmtKg(prodPlanned, 0)} kg</span>
                  <span className="ml-2 font-bold text-blue-600">{prodPct.toFixed(0)}%</span>
                </div>
              </div>
              <ProgressBar value={prodPct} color="blue" height={10} />
            </div>

            <Separator />

            {productionTypes.length === 0 ? (
              <EmptyCard icon={<Factory size={36} />} title="Brak aktywnych planów"
                description="Aktywuj plan w sekcji „Planowanie produkcji”" />
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {currentlyProducing.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide font-bold text-amber-700 mb-1.5 flex items-center gap-1.5">
                      <Zap size={11} className="text-amber-500" />
                      Aktualnie produkowane
                    </div>
                    <div className="space-y-2">
                      {currentlyProducing.map(t => {
                        const pct = t.kgPlanned > 0 ? (t.kgDone / t.kgPlanned) * 100 : 0
                        const clientsLive = Array.from(t.clientsInProgress)
                        return (
                          <div key={t.key} className="space-y-1 p-2 rounded-lg bg-amber-50/60 border border-amber-200/60">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="min-w-0">
                                <div className="font-semibold text-foreground truncate">
                                  {t.recipeName} · {t.kgPerUnit}kg
                                </div>
                                {clientsLive.length > 0 && (
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    <Cog size={10} className="text-amber-700 animate-spin [animation-duration:4s]" />
                                    {clientsLive.map(c => (
                                      <Badge key={c} variant="warning" className="text-[10px] px-1.5 py-0">
                                        {c}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                {t.packagingName && (
                                  <CardDescription className="text-[11px] truncate mt-0.5">{t.packagingName}</CardDescription>
                                )}
                              </div>
                              <div className="tabular-nums flex-shrink-0 text-right">
                                <div>
                                  <span className="font-bold">{t.qtyDone} szt</span>
                                  <span className="text-muted-foreground"> / {t.qtyPlanned} szt</span>
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {fmtKg(t.kgDone, 0)} kg / {fmtKg(t.kgPlanned, 0)} kg · <span className="font-semibold text-amber-700">{pct.toFixed(0)}%</span>
                                </div>
                              </div>
                            </div>
                            <ProgressBar value={pct} color="amber" height={6} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground mb-1.5">
                    Rodzaje · {productionTypes.length}
                  </div>
                  <div className="space-y-2">
                    {productionTypes.map(t => {
                      const pct = t.kgPlanned > 0 ? (t.kgDone / t.kgPlanned) * 100 : 0
                      const clients = Array.from(t.clientNames)
                      return (
                        <div key={t.key} className="space-y-1 p-2 rounded-lg hover:bg-muted/50">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">
                                {t.recipeName} · {t.kgPerUnit}kg
                                {clients.length > 0 && (
                                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                                    · {clients.join(', ')}
                                  </span>
                                )}
                              </div>
                              {t.packagingName && (
                                <CardDescription className="text-[11px] truncate">{t.packagingName}</CardDescription>
                              )}
                            </div>
                            <div className="tabular-nums flex-shrink-0 text-right">
                              <div>
                                <span className="font-bold">{t.qtyDone} szt</span>
                                <span className="text-muted-foreground"> / {t.qtyPlanned} szt</span>
                                <span className={`ml-2 font-semibold ${
                                  t.done ? 'text-green-600' : t.inProgress ? 'text-amber-600' : 'text-blue-600'
                                }`}>{pct.toFixed(0)}%</span>
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {fmtKg(t.kgDone, 0)} kg / {fmtKg(t.kgPlanned, 0)} kg
                              </div>
                            </div>
                          </div>
                          <ProgressBar
                            value={pct}
                            color={t.done ? 'green' : t.inProgress ? 'amber' : 'blue'}
                            height={6}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
          )
        })()}

      </div>

      {/* ── Magazyny: Mięso z/s i Mięso przyprawione ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Mięso z/s — grupowane po rawBatchNo */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Package size={13} className="text-green-500" />
                Mięso z/s — po rozbiorze
              </CardTitle>
              <CardDescription className="text-[11px] mt-0.5">
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
                <table className="w-full text-xs tabular-nums">
                  <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                    <tr>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Partia surowca</th>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-center">Lotów</th>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Ważność</th>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Razem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meatByBatch.map((g, idx) => (
                      <tr key={g.rawBatchNo} className={cn('border-b border-surface-3', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40', 'hover:bg-blue-50/60')}>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <code className="font-mono font-bold text-foreground text-[12px] bg-muted px-1.5 py-0.5 rounded">{g.rawBatchNo}</code>
                        </td>
                        <td className="px-2.5 py-2 text-center text-ink-2">{g.lots}</td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          {g.earliestExpiry ? <ExpiryBadge dateStr={g.earliestExpiry} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2.5 py-2 text-right whitespace-nowrap font-bold text-emerald-700">
                          {fmtKg(g.kg, 1)}<span className="font-normal text-[11px]"> kg</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mięso przyprawione — grupowane po recepturze */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Boxes size={13} className="text-purple-500" />
                Mięso przyprawione — magazyn
              </CardTitle>
              <CardDescription className="text-[11px] mt-0.5">
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
                <table className="w-full text-xs tabular-nums">
                  <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                    <tr>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Receptura</th>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-center">Szarż</th>
                      <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Razem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonedByRecipe.map((g, idx) => (
                      <tr key={g.recipeName} className={cn('border-b border-surface-3', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40', 'hover:bg-blue-50/60')}>
                        <td className="px-2.5 py-2 font-semibold text-ink">{g.recipeName}</td>
                        <td className="px-2.5 py-2 text-center text-ink-2">{g.batches}</td>
                        <td className="px-2.5 py-2 text-right whitespace-nowrap font-bold text-emerald-700">
                          {fmtKg(g.kg, 1)}<span className="font-normal text-[11px]"> kg</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Zamówienia — sort po dacie dostawy ───────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Truck size={13} className="text-amber-500" />
              Zamówienia od klientów
            </CardTitle>
            <CardDescription className="text-[11px] mt-0.5">
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
            <OrdersTable
              orders={visibleOrders}
              finishedQtyByOrderNo={finishedQtyByOrderNo}
              inProgressQtyByOrderId={inProgressQtyByOrderId}
              inProgressByLineId={inProgressQtyByOrderLineId}
            />
          )}
        </CardContent>
      </Card>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// OrdersTable — dense table z zamówieniami w stylu Subiekt GT
//   Klik wiersza rozwija inline pozycje zamówienia (line breakdown).
// ─────────────────────────────────────────────────────────────────
function OrdersTable({ orders, finishedQtyByOrderNo, inProgressQtyByOrderId, inProgressByLineId }: {
  orders: any[]
  finishedQtyByOrderNo: Map<string, number>
  inProgressQtyByOrderId: Map<string, number>
  inProgressByLineId: Map<string, number>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const ORDER_STATUS_BADGE_CLS: Record<string, string> = {
    draft:         'bg-gray-50 text-gray-700 border-gray-200',
    confirmed:     'bg-blue-50 text-blue-700 border-blue-200',
    in_production: 'bg-amber-50 text-amber-700 border-amber-200',
    done:          'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled:     'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className="overflow-auto max-h-[60vh]">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
          <tr>
            <th className="w-6" />
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Nr zam.</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Klient</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Dostawa</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left">Status</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Szt</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-right">Razem kg</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left min-w-[160px]">Postęp</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, idx) => {
            const isExp     = expanded === o.id
            const finished  = finishedQtyByOrderNo.get(o.orderNo) ?? 0
            const inProgress= inProgressQtyByOrderId.get(o.id) ?? 0
            const qtyDone   = finished + inProgress
            const qtyTotal  = Number(o.totalUnits ?? 0)
            const pct       = qtyTotal > 0 ? Math.round((qtyDone / qtyTotal) * 100) : 0
            const isDue     = o.deliveryDate
              ? new Date(o.deliveryDate).getTime() - Date.now() < 1000 * 60 * 60 * 48
              : false

            return (
              <Fragment key={o.id}>
                <tr
                  onClick={() => setExpanded(isExp ? null : o.id)}
                  className={cn(
                    'cursor-pointer border-b border-surface-3 transition-colors',
                    idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                    isExp ? 'bg-blue-50/40' : 'hover:bg-blue-50/60',
                  )}
                >
                  <td className="px-1 py-2 text-center text-muted-foreground">
                    {isExp ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <code className="font-mono font-bold text-primary text-[12px]">{o.orderNo}</code>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink font-medium max-w-[220px] truncate" title={o.clientName}>
                    {o.clientName}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    {o.deliveryDate ? (
                      <span className={isDue && o.status !== 'done' && o.status !== 'cancelled' ? 'text-red-600 font-semibold' : 'text-ink-2'}>
                        {fmtDatePl(o.deliveryDate)}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <Badge variant="outline" className={cn('text-[10px] font-medium', ORDER_STATUS_BADGE_CLS[o.status] || '')}>
                      {ORDER_STATUS_LABEL[o.status] ?? o.status}
                    </Badge>
                    {inProgress > 0 && (
                      <Badge variant="warning" className="text-[10px] ml-1 gap-1">
                        <Zap size={9}/> w produkcji
                      </Badge>
                    )}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-right">
                    {qtyDone > 0 ? (
                      <>
                        <span className={pct >= 100 ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>{qtyDone}</span>
                        <span className="text-muted-foreground">/{qtyTotal}</span>
                      </>
                    ) : (
                      <span className="font-bold">{qtyTotal}</span>
                    )}
                    <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold text-emerald-700">
                    {fmtKg(o.totalKg, 0)}<span className="font-normal text-[11px]"> kg</span>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    {qtyTotal > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden flex-1 max-w-[140px]">
                          <div
                            className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : pct > 0 ? 'bg-orange-400' : 'bg-slate-300')}
                            style={{ width: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                        <span className={cn('text-[11px] font-semibold tabular-nums', pct >= 100 ? 'text-emerald-700' : pct > 0 ? 'text-amber-700' : 'text-muted-foreground')}>
                          {pct}%
                        </span>
                      </div>
                    )}
                  </td>
                </tr>

                {isExp && (
                  <tr>
                    <td colSpan={8} className="bg-blue-50/20 border-b border-surface-3 px-4 py-3">
                      <CardDescription className="text-[11px] font-bold uppercase tracking-wide mb-1.5">
                        Pozycje ({(o.lines ?? []).length})
                      </CardDescription>
                      <div className="overflow-x-auto rounded border border-surface-3 bg-white">
                        <table className="w-full text-xs tabular-nums">
                          <thead className="bg-surface-2">
                            <tr>
                              {['Szt','Wykonano','kg','Razem kg','Rodzaj','Receptura','Tuleja'].map(h => (
                                <th key={h} className="px-2.5 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-ink-2 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(o.lines ?? []).map((l: any, li: number) => {
                              const linePending = inProgressByLineId.get(l.id) ?? 0
                              const linePct     = Number(l.qty) > 0 ? Math.round((linePending / Number(l.qty)) * 100) : 0
                              return (
                                <tr key={l.id} className={li % 2 === 0 ? 'bg-white' : 'bg-surface-2/40'}>
                                  <td className="px-2.5 py-2 font-bold">{l.qty}<span className="text-muted-foreground font-normal text-[11px]"> szt</span></td>
                                  <td className="px-2.5 py-2">
                                    {linePending > 0 ? (
                                      <>
                                        <span className={cn('font-bold', linePct >= 100 ? 'text-emerald-700' : 'text-amber-700')}>{linePending}</span>
                                        <span className="text-muted-foreground"> ({linePct}%)</span>
                                      </>
                                    ) : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-2.5 py-2 text-ink-2">{l.kgPerUnit}<span className="text-muted-foreground text-[11px]"> kg</span></td>
                                  <td className="px-2.5 py-2 font-bold text-emerald-700">{fmtKg(l.totalKg, 0)}<span className="font-normal text-[11px]"> kg</span></td>
                                  <td className="px-2.5 py-2 text-ink">{l.productTypeName || <span className="text-muted-foreground">—</span>}</td>
                                  <td className="px-2.5 py-2 text-ink-2">{l.recipeName || <span className="text-muted-foreground">—</span>}</td>
                                  <td className="px-2.5 py-2 text-ink-2">{l.packagingName || <span className="text-muted-foreground">—</span>}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Suppress unused warning — StatusBadge eksportowany dla kompat. wstecznej
void StatusBadge
