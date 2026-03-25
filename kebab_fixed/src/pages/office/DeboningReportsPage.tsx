/**
 * DeboningReportsPage — Biuro
 * Używa NOWEGO deboningEntriesApi przez hooks deboning
 * PLUS stary deboningApi.list() który teraz zwraca OBA źródła
 */
import { useState, useCallback } from 'react'
import { Toast, Spinner, EmptyState } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtKg, fmtPct, fmtDatePl } from '@/lib/utils'
import { CheckCircle, Scissors, Clock, Lock, BarChart2 } from 'lucide-react'
import { useProductionSession, useDeboningEntries, useSessionSummary } from '@/features/deboning'
import type { SessionStatus } from '@/features/deboning'

const STATUS_LABEL: Record<SessionStatus, string> = {
  open: 'Otwarta', closed: 'Zamknięta', approved: 'Zatwierdzona',
}
const STATUS_CLS: Record<SessionStatus, string> = {
  open: 'bg-green-100 text-green-700',
  closed: 'bg-amber-100 text-amber-700',
  approved: 'bg-gray-100 text-gray-600',
}

interface ToastState { msg: string; type: 'success'|'error'; visible: boolean }
const HIDDEN: ToastState = { msg: '', type: 'success', visible: false }

export function DeboningReportsPage() {
  const [toast, setToast] = useState<ToastState>(HIDDEN)
  const showToast = useCallback((msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(HIDDEN), 3000)
  }, [])

  const { session, todaySessions, timeWindow, loading, approveDay, approveLoading } = useProductionSession()
  const activeId = session?.id ?? null
  const { entries, loading: entriesLoading } = useDeboningEntries(activeId)
  const { summary } = useSessionSummary(activeId)

  async function handleApprove() {
    const err = await approveDay('office')
    if (err) showToast(err, 'error')
    else showToast('Sesja zatwierdzona')
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Spinner size={24} /></div>

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Status sesji */}
      <div className="bg-white border border-surface-4 shadow-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-ink mb-0.5">
              Sesja rozbioru — {timeWindow.productionDate}
            </div>
            <div className="flex items-center gap-2">
              {session ? (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STATUS_CLS[session.status]}`}>
                  {STATUS_LABEL[session.status]}
                </span>
              ) : (
                <span className="text-[11px] text-ink-3">Brak aktywnej sesji — uruchom z tabletu rozbioru</span>
              )}
              <span className="text-[11px] text-ink-4">{timeWindow.currentTimeHHMM}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {session && (session.status === 'closed' || session.status === 'open') && (
              <Button size="sm" loading={approveLoading} icon={<CheckCircle size={13} />} onClick={handleApprove}>
                Zatwierdź sesję
              </Button>
            )}
            {session?.status === 'approved' && (
              <div className="flex items-center gap-1.5 text-[12px] text-gray-500">
                <Lock size={13} /> Zatwierdzone przez {session.approvedBy ?? '—'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI */}
      {summary && (
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: 'Ćwiartka',  val: fmtKg(summary.totalKgTaken), unit: 'kg' },
            { label: 'Mięso Z/S', val: fmtKg(summary.totalKgMeat),  unit: 'kg' },
            { label: 'Kości',     val: fmtKg(summary.totalKgBones), unit: 'kg' },
            { label: 'Grzbiety',  val: fmtKg(summary.totalKgBacks), unit: 'kg' },
            { label: 'Wydajność', val: fmtPct(summary.avgYieldPct), unit: ''   },
            { label: 'Wpisów',    val: summary.entryCount,           unit: ''   },
          ].map(k => (
            <div key={k.label} className="bg-white border border-surface-4 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">{k.label}</div>
              <div className="text-xl font-bold text-ink">
                {k.val}{k.unit && <span className="text-xs font-normal text-ink-3 ml-1">{k.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabela wpisów LIVE */}
      <div className="bg-white border border-surface-4 shadow-card">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center gap-2">
          <Scissors size={13} className="text-ink-3" />
          <span className="text-[13px] font-semibold text-ink">Wpisy rozbioru</span>
          {session?.status === 'open' && (
            <span className="text-[10px] font-semibold text-green-600 ml-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" /> LIVE
            </span>
          )}
          <span className="ml-auto text-[11px] text-ink-4">{entries.length} wpisów</span>
        </div>

        {entriesLoading
          ? <div className="flex items-center justify-center py-10"><Spinner size={20} /></div>
          : entries.length === 0
            ? <EmptyState icon={<BarChart2 size={28} />} title="Brak wpisów"
                message={session ? 'Oczekiwanie na wpisy z tabletu...' : 'Brak aktywnej sesji'} />
            : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-surface-4 bg-surface-2">
                    {['Nr sesji','Partia','Pracownik','Lot mięsa','Ćwiartka kg','Mięso kg','Kości kg','Grzbiety kg','Wydajność'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-surface-2">
                      <td className="px-3 py-2 font-mono text-brand">{e.sessionNo}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{e.rawBatchNo}</td>
                      <td className="px-3 py-2 text-ink-2">{e.workerName}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{e.meatLotNo ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtKg(e.kgTaken, 2)}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmtKg(e.kgMeat, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink-3">{fmtKg(e.kgBones, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink-3">{fmtKg(e.kgBacks, 2)}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmtPct(e.yieldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        }
      </div>

      {/* Historia sesji dnia */}
      {todaySessions.length > 1 && (
        <div className="bg-white border border-surface-4 shadow-card">
          <div className="px-4 py-2.5 border-b border-surface-4">
            <span className="text-[13px] font-semibold text-ink">Sesje dnia {timeWindow.productionDate}</span>
          </div>
          <div className="divide-y divide-surface-4">
            {todaySessions.map(s => (
              <div key={s.id} className="px-4 py-2.5 flex items-center gap-4 text-[12px]">
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_CLS[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
                <span className="text-ink-3">Start: {s.startedAt.slice(11, 16)}</span>
                {s.endedAt && <span className="text-ink-3">Koniec: {s.endedAt.slice(11, 16)}</span>}
                {s.approvedBy && <span className="text-ink-4">Zatwierdził: {s.approvedBy}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
