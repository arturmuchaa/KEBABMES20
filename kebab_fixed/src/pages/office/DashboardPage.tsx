import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, deboningApi, meatStockApi } from '@/lib/apiClient'
import { KpiCard, SkeletonCard, SkeletonTable, EmptyState, PageHeader } from '@/components/ui/Card'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/Badge'
import { fmtKg, fmtDatePl, fmtPct, getExpiryStatus, sortFefo, todayIso } from '@/lib/utils'
import { AlertTriangle, Package, Beef, Scissors, TrendingUp, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

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

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-40 bg-slate-100 rounded-lg animate-skeleton" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100"><div className="h-4 w-40 bg-slate-100 rounded animate-skeleton" /></div>
          <SkeletonTable rows={6} cols={5} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      <PageHeader
        title="Dashboard"
        subtitle={new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Surowiec dostępny" value={fmtKg(totalKgAvail, 0)} unit="kg"
          sub={`${activeBatches.length} partii aktywnych`} accent="blue" icon={<Package size={18} />} />
        <KpiCard label="Magazyn mięsa" value={fmtKg(meatKg, 0)} unit="kg"
          sub={`${allMeat.filter(m => m.status === 'AVAILABLE').length} lotów dostępnych`} accent="green" icon={<Beef size={18} />} />
        <KpiCard label="Rozbiory dziś" value={todayDeb.length} unit="sesji"
          sub={todayDeb.length > 0 ? `Śr. wydajność: ${fmtPct(todayDeb.reduce((s, d) => s + Number(d.yieldPct), 0) / todayDeb.length)}` : 'Brak sesji dzisiaj'}
          accent="amber" icon={<Scissors size={18} />} />
        <KpiCard label="Krytyczne FEFO" value={critical.length} unit="partii"
          sub="Wygasa ≤ 1 dzień" accent={critical.length > 0 ? 'red' : 'green'} icon={<TrendingUp size={18} />} />
      </div>

      {/* Alerts */}
      {critical.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-red-100 flex items-center gap-2">
            <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
            <span className="text-[12px] font-semibold text-red-700">Alerty FEFO — wymaga natychmiastowego działania</span>
          </div>
          <div className="divide-y divide-red-100">
            {critical.map(b => {
              const { daysLeft } = getExpiryStatus(b.expiryDate)
              return (
                <div key={b.id} className="px-5 py-2.5 flex items-center gap-3 text-[12px]">
                  <span className="font-mono font-bold text-red-700 w-12">{b.internalBatchNo}</span>
                  <span className="text-red-600 flex-1">{daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : 'Wygasa jutro'} — {fmtDatePl(b.expiryDate)}</span>
                  <span className="font-semibold text-red-700">{fmtKg(b.kgAvailable)} kg</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-100 flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
            <span className="text-[12px] font-semibold text-amber-700">Ostrzeżenia — wygasa w ciągu 3 dni</span>
          </div>
          <div className="divide-y divide-amber-100">
            {warnings.map(b => {
              const { daysLeft } = getExpiryStatus(b.expiryDate)
              return (
                <div key={b.id} className="px-5 py-2.5 flex items-center gap-3 text-[12px]">
                  <span className="font-mono font-bold text-amber-700 w-12">{b.internalBatchNo}</span>
                  <span className="text-amber-600 flex-1">Za {daysLeft} dni — {fmtDatePl(b.expiryDate)}</span>
                  <span className="font-semibold text-amber-700">{fmtKg(b.kgAvailable)} kg</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* FEFO table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-card">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-[14px] font-semibold text-slate-900">Partie ćwiartki</span>
            <span className="ml-2 text-[11px] text-slate-400">kolejność FEFO</span>
          </div>
          <Link to="/office/raw-batches" className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-900 transition-colors">
            Zarządzaj <ArrowRight size={12} />
          </Link>
        </div>
        {fefoSorted.length === 0
          ? <EmptyState icon={<Package size={32} />} title="Brak partii" message="Przyjmij pierwszą partię ćwiartki" />
          : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Partia</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Dostawca</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Dostępne</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Ważność</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fefoSorted.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono font-bold text-slate-900">{b.internalBatchNo}</td>
                    <td className="px-5 py-3 text-slate-600">{b.supplierName ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900">{fmtKg(b.kgAvailable)} kg</td>
                    <td className="px-5 py-3"><ExpiryBadge dateStr={b.expiryDate} /></td>
                    <td className="px-5 py-3"><StatusBadge status={computeDisplayStatus(b.expiryDate, Number(b.kgAvailable))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {/* Recent deboning */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-card">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-[14px] font-semibold text-slate-900">Ostatnie rozbiory</span>
            <span className="ml-2 text-[11px] text-slate-400">{allDebonings.length} sesji łącznie</span>
          </div>
          <Link to="/office/deboning" className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-900 transition-colors">
            Wszystkie <ArrowRight size={12} />
          </Link>
        </div>
        {allDebonings.length === 0
          ? <EmptyState title="Brak sesji" message="Wykonaj pierwszy rozbiór na tablecie" />
          : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Nr sesji</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Partia</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Pracownik</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Ćwiartka</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Mięso</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Wydajność</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...allDebonings].sort((a, b) => b.createdAt > a.createdAt ? 1 : -1).slice(0, 10).map(d => (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono font-semibold text-blue-600">{d.sessionNo}</td>
                    <td className="px-5 py-3 font-mono font-semibold text-slate-900">{d.rawBatchNo}</td>
                    <td className="px-5 py-3 text-slate-600">{d.workerName ?? '—'}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900">{fmtKg(Number(d.kgTaken), 1)} kg</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600">{fmtKg(Number(d.kgMeat), 1)} kg</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900">{fmtPct(d.yieldPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

    </div>
  )
}
