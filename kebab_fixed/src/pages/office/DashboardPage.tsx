import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, deboningApi, meatStockApi } from '@/lib/apiClient'
import { StatCard, StatCardSkeleton } from '@/components/ui/StatCard'
import { SkeletonTable, EmptyState, PageHeader } from '@/components/ui/Card'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/Badge'
import { fmtKg, fmtDatePl, fmtPct, getExpiryStatus, sortFefo, todayIso } from '@/lib/utils'
import { AlertTriangle, Package, Beef, Scissors, TrendingUp, ArrowRight, Activity } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function DashboardPage() {
  const batchRes    = useApi(() => rawBatchesApi.list())
  const deboningRes = useApi(() => deboningApi.list())
  const meatRes     = useApi(() => meatStockApi.list())

  const loading = batchRes.loading || deboningRes.loading || meatRes.loading

  const allBatches   = batchRes.data?.data   ?? []
  const allDebonings = deboningRes.data?.data ?? []
  const allMeat      = meatRes.data?.data     ?? []

  const activeBatches = allBatches.filter(b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const fefoSorted    = sortFefo(activeBatches).slice(0, 25)
  const totalKgAvail  = activeBatches.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const meatKg        = allMeat.filter(m => m.status === 'AVAILABLE').reduce((s, m) => s + Number(m.kgAvailable), 0)
  const today         = todayIso()
  const todayDeb      = allDebonings.filter(d => d.createdAt?.slice(0, 10) === today)
  const critical      = activeBatches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 1)
  const warnings      = activeBatches.filter(b => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })

  const avgYield = todayDeb.length > 0
    ? todayDeb.reduce((s, d) => s + Number(d.yieldPct), 0) / todayDeb.length
    : 0

  if (loading) {
    return (
      <div className="space-y-7 animate-fade-in">
        <div className="h-8 w-48 bg-slate-100 rounded-xl animate-skeleton" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100"><div className="h-4 w-40 bg-slate-100 rounded animate-skeleton" /></div>
          <SkeletonTable rows={6} cols={5} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-7 animate-fade-in">

      <PageHeader
        title="Dashboard"
        subtitle={new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      {/* ── Stat cards (bundui style) ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Surowiec dostępny"
          value={Math.round(totalKgAvail)}
          unit="kg"
          sub={`${activeBatches.length} partii aktywnych`}
          accent="blue"
          icon={<Package size={16} />}
        />
        <StatCard
          label="Magazyn mięsa"
          value={Math.round(meatKg)}
          unit="kg"
          sub={`${allMeat.filter(m => m.status === 'AVAILABLE').length} lotów dostępnych`}
          accent="green"
          icon={<Beef size={16} />}
        />
        <StatCard
          label="Rozbiory dziś"
          value={todayDeb.length}
          unit="sesji"
          sub={avgYield > 0 ? `Śr. wydajność ${fmtPct(avgYield)}` : 'Brak sesji dzisiaj'}
          accent="amber"
          icon={<Scissors size={16} />}
        />
        <StatCard
          label="Krytyczne FEFO"
          value={critical.length}
          unit="partii"
          sub="Wygasa ≤ 1 dzień"
          accent={critical.length > 0 ? 'red' : 'green'}
          icon={<TrendingUp size={16} />}
        />
      </div>

      {/* ── Alert banners ── */}
      {critical.length > 0 && (
        <AlertBanner
          variant="danger"
          title="Alerty FEFO — wymaga natychmiastowego działania"
          items={critical.map(b => {
            const { daysLeft } = getExpiryStatus(b.expiryDate)
            return {
              key: b.id,
              batch: b.internalBatchNo,
              label: daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : 'Wygasa jutro',
              date: fmtDatePl(b.expiryDate),
              kg: fmtKg(b.kgAvailable),
            }
          })}
        />
      )}
      {warnings.length > 0 && (
        <AlertBanner
          variant="warn"
          title="Ostrzeżenia — wygasa w ciągu 3 dni"
          items={warnings.map(b => {
            const { daysLeft } = getExpiryStatus(b.expiryDate)
            return {
              key: b.id,
              batch: b.internalBatchNo,
              label: `Za ${daysLeft} ${daysLeft === 1 ? 'dzień' : 'dni'}`,
              date: fmtDatePl(b.expiryDate),
              kg: fmtKg(b.kgAvailable),
            }
          })}
        />
      )}

      {/* ── Two-column tables on large screens ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

        {/* FEFO table — wider */}
        <div className="xl:col-span-3">
          <DashTable
            title="Partie ćwiartki"
            badge="FEFO"
            link={{ to: '/office/raw-batches', label: 'Zarządzaj' }}
            empty={fefoSorted.length === 0}
            emptyContent={<EmptyState icon={<Package size={28} />} title="Brak partii" message="Przyjmij pierwszą partię ćwiartki" />}
          >
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <Th>Partia</Th>
                  <Th>Dostawca</Th>
                  <Th right>Dostępne</Th>
                  <Th>Ważność</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {fefoSorted.map(b => (
                  <tr key={b.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-5 py-3 font-mono font-bold text-slate-900 text-[11px]">{b.internalBatchNo}</td>
                    <td className="px-5 py-3 text-slate-500">{b.supplierName ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900">{fmtKg(b.kgAvailable)} kg</td>
                    <td className="px-5 py-3"><ExpiryBadge dateStr={b.expiryDate} /></td>
                    <td className="px-5 py-3"><StatusBadge status={computeDisplayStatus(b.expiryDate, Number(b.kgAvailable))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashTable>
        </div>

        {/* Deboning summary — narrower */}
        <div className="xl:col-span-2">
          <DashTable
            title="Ostatnie rozbiory"
            badge={`${allDebonings.length} sesji`}
            link={{ to: '/office/deboning', label: 'Wszystkie' }}
            empty={allDebonings.length === 0}
            emptyContent={<EmptyState title="Brak sesji" message="Wykonaj pierwszy rozbiór na tablecie" />}
          >
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <Th>Sesja</Th>
                  <Th>Pracownik</Th>
                  <Th right>Mięso</Th>
                  <Th right>Wydajność</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[...allDebonings].sort((a, b) => b.createdAt > a.createdAt ? 1 : -1).slice(0, 10).map(d => (
                  <tr key={d.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-5 py-3">
                      <span className="font-mono font-semibold text-blue-600 text-[11px]">{d.sessionNo}</span>
                      <div className="text-[10px] text-slate-400 font-mono">{d.rawBatchNo}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-500 truncate max-w-[80px]">{d.workerName ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-700">{fmtKg(Number(d.kgMeat), 1)}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900">{fmtPct(d.yieldPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashTable>
        </div>

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn(
      'px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400',
      right ? 'text-right' : 'text-left',
    )}>
      {children}
    </th>
  )
}

interface DashTableProps {
  title: string
  badge?: string
  link?: { to: string; label: string }
  empty: boolean
  emptyContent: React.ReactNode
  children: React.ReactNode
}

function DashTable({ title, badge, link, empty, emptyContent, children }: DashTableProps) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-slate-400" />
          <span className="text-[13px] font-semibold text-slate-900">{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 rounded-md">
              {badge}
            </span>
          )}
        </div>
        {link && (
          <Link
            to={link.to}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            {link.label} <ArrowRight size={11} />
          </Link>
        )}
      </div>
      {empty ? emptyContent : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  )
}

interface AlertItem {
  key: string | number
  batch: string
  label: string
  date: string
  kg: string
}

function AlertBanner({ variant, title, items }: {
  variant: 'danger' | 'warn'
  title: string
  items: AlertItem[]
}) {
  const isDanger = variant === 'danger'
  return (
    <div className={cn(
      'rounded-2xl overflow-hidden border',
      isDanger ? 'border-red-200/80 bg-red-50/60' : 'border-amber-200/80 bg-amber-50/60',
    )}>
      <div className={cn(
        'px-5 py-3.5 border-b flex items-center gap-2.5',
        isDanger ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50',
      )}>
        <AlertTriangle size={13} className={isDanger ? 'text-red-500' : 'text-amber-500'} />
        <span className={cn(
          'text-[12px] font-semibold',
          isDanger ? 'text-red-800' : 'text-amber-800',
        )}>{title}</span>
        <span className={cn(
          'ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold',
          isDanger ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700',
        )}>
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-red-100/60">
        {items.map(item => (
          <div key={item.key} className="px-5 py-2.5 flex items-center gap-3 text-[12px]">
            <span className={cn(
              'font-mono font-bold text-[11px] w-14 flex-shrink-0',
              isDanger ? 'text-red-800' : 'text-amber-800',
            )}>
              {item.batch}
            </span>
            <span className={cn('flex-1', isDanger ? 'text-red-700' : 'text-amber-700')}>
              {item.label} — {item.date}
            </span>
            <span className={cn(
              'font-mono font-semibold',
              isDanger ? 'text-red-800' : 'text-amber-800',
            )}>
              {item.kg} kg
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
