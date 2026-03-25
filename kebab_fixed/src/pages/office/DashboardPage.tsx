import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, deboningApi, meatStockApi } from '@/lib/apiClient'
import { KpiCard, Spinner, EmptyState } from '@/components/ui/Card'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/Badge'
import { fmtKg, fmtDatePl, fmtPct, getExpiryStatus, sortFefo, todayIso } from '@/lib/utils'
import { AlertTriangle, Package } from 'lucide-react'
import { Link } from 'react-router-dom'

export function DashboardPage() {
  const batchRes   = useApi(() => rawBatchesApi.list())
  const deboningRes= useApi(() => deboningApi.list())
  const meatRes    = useApi(() => meatStockApi.list())

  const loading = batchRes.loading || deboningRes.loading || meatRes.loading

  const allBatches  = batchRes.data?.data  ?? []
  const allDebonings= deboningRes.data?.data ?? []
  const allMeat     = meatRes.data?.data     ?? []

  // Zawsze używaj computeDisplayStatus — nie ufaj batch.status
  const activeBatches  = allBatches.filter(b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const fefoSorted     = sortFefo(activeBatches).slice(0, 25)
  const totalKgAvail   = activeBatches.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const meatKg         = allMeat.filter(m => m.status === 'AVAILABLE').reduce((s, m) => s + Number(m.kgAvailable), 0)
  const today          = todayIso()
  const todayDeb       = allDebonings.filter(d => d.createdAt?.slice(0, 10) === today)
  const critical       = activeBatches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 1)
  const warnings       = activeBatches.filter(b => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })

  if (loading) return (
    <div className="flex items-center justify-center py-24"><Spinner size={24} /></div>
  )

  return (
    <div className="space-y-4 animate-fade-in">

      {/* KPI — kompaktowe, 4 kolumny */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="Surowiec dostępny" value={fmtKg(totalKgAvail, 0)} unit="kg"
          sub={`${activeBatches.length} partii`} accent="blue" />
        <KpiCard label="Magazyn mięsa" value={fmtKg(meatKg, 0)} unit="kg"
          sub={`${allMeat.filter(m => m.status === 'AVAILABLE').length} lotów`} accent="green" />
        <KpiCard label="Rozbiory dziś" value={todayDeb.length} unit="sesji"
          sub={todayDeb.length > 0
            ? `Śr. wydajność: ${fmtPct(todayDeb.reduce((s,d)=>s+Number(d.yieldPct),0)/todayDeb.length)}`
            : 'Brak sesji'}
          accent="amber" />
        <KpiCard label="Krytyczne FEFO" value={critical.length} unit="partii"
          sub="Wygasa ≤ 1 dzień" accent={critical.length > 0 ? 'red' : 'green'} />
      </div>

      {/* Alerty FEFO — tylko jeśli są */}
      {critical.length > 0 && (
        <div className="border border-red-200 bg-red-50">
          <div className="px-3 py-2 border-b border-red-200 flex items-center gap-2">
            <AlertTriangle size={13} className="text-red-600 flex-shrink-0" />
            <span className="text-[12px] font-semibold text-red-700">Alerty FEFO — wymaga natychmiastowego działania</span>
          </div>
          <div className="divide-y divide-red-100">
            {critical.map(b => {
              const { daysLeft } = getExpiryStatus(b.expiryDate)
              return (
                <div key={b.id} className="px-3 py-1.5 flex items-center gap-3 text-[12px]">
                  <span className="font-mono font-bold text-red-700 w-12">{b.internalBatchNo}</span>
                  <span className="text-red-600 flex-1">
                    {daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : 'Wygasa jutro'}
                    {' — '}{fmtDatePl(b.expiryDate)}
                  </span>
                  <span className="font-semibold text-red-700">{fmtKg(b.kgAvailable)} kg</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border border-amber-200 bg-amber-50">
          <div className="px-3 py-2 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
            <span className="text-[12px] font-semibold text-amber-700">Ostrzeżenia — wygasa w ciągu 3 dni</span>
          </div>
          <div className="divide-y divide-amber-100">
            {warnings.map(b => {
              const { daysLeft } = getExpiryStatus(b.expiryDate)
              return (
                <div key={b.id} className="px-3 py-1.5 flex items-center gap-3 text-[12px]">
                  <span className="font-mono font-bold text-amber-700 w-12">{b.internalBatchNo}</span>
                  <span className="text-amber-600 flex-1">Za {daysLeft} dni — {fmtDatePl(b.expiryDate)}</span>
                  <span className="font-semibold text-amber-700">{fmtKg(b.kgAvailable)} kg</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabela FEFO — główny element */}
      <div className="bg-white border border-surface-4 shadow-card">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">Partie ćwiartki — FEFO</span>
          <Link to="/office/raw-batches"
            className="text-[12px] font-medium text-brand hover:underline">
            Zarządzaj →
          </Link>
        </div>

        {fefoSorted.length === 0 ? (
          <EmptyState icon={<Package size={32} />} title="Brak partii"
            message="Przyjmij pierwszą partię ćwiartki" />
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 bg-surface-2">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Partia</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Dostawca</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-ink-4">Kg dostępne</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Ważność</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {fefoSorted.map(b => {
                const displayStatus = computeDisplayStatus(b.expiryDate, Number(b.kgAvailable))
                return (
                  <tr key={b.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2 font-mono font-bold text-ink">{b.internalBatchNo}</td>
                    <td className="px-4 py-2 text-ink-2">{b.supplierName ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-ink">{fmtKg(b.kgAvailable)} kg</td>
                    <td className="px-4 py-2">
                      <ExpiryBadge dateStr={b.expiryDate} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={displayStatus} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Ostatnie rozbiory — kompaktowa tabela */}
      <div className="bg-white border border-surface-4 shadow-card">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">Ostatnie rozbiory</span>
          <Link to="/office/deboning" className="text-[12px] font-medium text-brand hover:underline">
            Wszystkie →
          </Link>
        </div>
        {allDebonings.length === 0 ? (
          <EmptyState title="Brak sesji" message="Wykonaj pierwszy rozbiór na tablecie" />
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 bg-surface-2">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Nr sesji</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Partia</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">Pracownik</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-ink-4">Ćwiartka</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-ink-4">Mięso</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-ink-4">Wydajność</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {[...allDebonings]
                .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
                .slice(0, 10)
                .map(d => (
                  <tr key={d.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2 font-mono text-brand">{d.sessionNo}</td>
                    <td className="px-4 py-2 font-mono font-semibold text-ink">{d.rawBatchNo}</td>
                    <td className="px-4 py-2 text-ink-2">{d.workerName ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmtKg(Number(d.kgTaken), 1)} kg</td>
                    <td className="px-4 py-2 text-right text-ink-2">{fmtKg(Number(d.kgMeat), 1)} kg</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmtPct(d.yieldPct)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
