/**
 * RawStockPage — Magazyn surowca
 * Prosta lista mięsa Z/S bez tabelek ledger
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { meatStockApi, deboningApi, rawBatchesApi } from '@/lib/apiClient'
import { Card, CardHeader, Spinner, EmptyState, Modal } from '@/components/ui/Card'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Eye, ArrowRight, Beef, Layers, Package } from 'lucide-react'
import type { MeatStock, DeboningSession, RawBatch } from '@/types'

function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  const base = 'text-[10px] font-bold px-1.5 py-0.5 rounded ring-1'
  if (daysLeft < 0)   return <span className={cn(base, 'bg-red-500/15 text-red-400 ring-red-500/25')}>Wygasło</span>
  if (daysLeft === 0) return <span className={cn(base, 'bg-red-500/15 text-red-400 ring-red-500/25')}>Dziś!</span>
  if (daysLeft <= 2)  return <span className={cn(base, 'bg-amber-500/15 text-amber-400 ring-amber-500/25')}>{daysLeft}d</span>
  return <span className={cn(base, 'bg-green-500/15 text-green-400 ring-green-500/25')}>{daysLeft} dni</span>
}

interface TraceabilityModalProps {
  type: 'meat' | 'backs' | 'bones'
  item?: MeatStock
  session?: DeboningSession
  batch?: RawBatch
  onClose: () => void
}

function TraceabilityModal({ type, item, session, batch, onClose }: TraceabilityModalProps) {
  const title = type === 'meat' ? 'Śledzenie mięsa Z/S' : type === 'backs' ? 'Śledzenie grzbietów' : 'Śledzenie kości'
  return (
    <Modal open={true} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        <div className="bg-brand-light border-2 border-brand rounded-xl p-4">
          <div className="text-[10px] font-bold text-brand uppercase mb-1">Nasza partia</div>
          <div className="text-3xl font-black font-mono text-brand">{batch?.internalBatchNo || item?.rawBatchNo || '—'}</div>
        </div>
        <div className="flex items-center gap-2 text-ink-3">
          {['DOSTAWCA','PRZYJĘCIE','ROZBIÓR','MAGAZYN'].map((s, i, arr) => (
            <span key={s} className="flex items-center gap-2">
              <span className="text-xs font-semibold">{s}</span>
              {i < arr.length - 1 && <ArrowRight size={14} />}
            </span>
          ))}
        </div>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr className="border-b border-surface-4">
              <td className="py-2 font-semibold text-ink-3 w-1/3">Dostawca:</td>
              <td className="py-2 font-bold">{batch?.supplierName || '—'}</td>
            </tr>
            <tr className="border-b border-surface-4">
              <td className="py-2 font-semibold text-ink-3">Nr partii dostawcy:</td>
              <td className="py-2 font-mono font-bold">{batch?.supplierBatchNo || '—'}</td>
            </tr>
            <tr className="border-b border-surface-4">
              <td className="py-2 font-semibold text-ink-3">Data uboju:</td>
              <td className="py-2">{batch?.slaughterDate ? fmtDatePl(batch.slaughterDate) : '—'}</td>
            </tr>
            <tr className="border-b border-surface-4">
              <td className="py-2 font-semibold text-ink-3">Data przyjęcia:</td>
              <td className="py-2">{batch?.receivedDate ? fmtDatePl(batch.receivedDate) : '—'}</td>
            </tr>
            <tr className="border-b border-surface-4">
              <td className="py-2 font-semibold text-ink-3">Data ważności:</td>
              <td className="py-2">
                {batch?.expiryDate ? (
                  <span className="flex items-center gap-2">
                    {fmtDatePl(batch.expiryDate)}
                    <ExpiryBadge date={batch.expiryDate} />
                  </span>
                ) : '—'}
              </td>
            </tr>
            {session && (
              <>
                <tr className="border-b border-surface-4 bg-slate-50">
                  <td className="py-2 font-semibold text-ink-3" colSpan={2}>
                    <span className="text-[10px] uppercase tracking-wide">Sesja rozbioru</span>
                  </td>
                </tr>
                <tr className="border-b border-surface-4">
                  <td className="py-2 font-semibold text-ink-3">Nr sesji:</td>
                  <td className="py-2 font-mono">{session.sessionNo}</td>
                </tr>
                <tr className="border-b border-surface-4">
                  <td className="py-2 font-semibold text-ink-3">Pracownik:</td>
                  <td className="py-2">{session.workerName}</td>
                </tr>
                <tr className="border-b border-surface-4">
                  <td className="py-2 font-semibold text-ink-3">Data rozbioru:</td>
                  <td className="py-2">{fmtDatePl(session.createdAt?.slice(0,10) || '')}</td>
                </tr>
              </>
            )}
            {item && (
              <>
                <tr className="border-b border-surface-4 bg-slate-50">
                  <td className="py-2 font-semibold text-ink-3" colSpan={2}>
                    <span className="text-[10px] uppercase tracking-wide">Stan magazynowy</span>
                  </td>
                </tr>
                <tr className="border-b border-surface-4">
                  <td className="py-2 font-semibold text-ink-3">Nr partii mięsa:</td>
                  <td className="py-2 font-mono font-bold text-brand">{item.lotNo}</td>
                </tr>
                <tr className="border-b border-surface-4">
                  <td className="py-2 font-semibold text-ink-3">Ilość początkowa:</td>
                  <td className="py-2 font-bold">{fmtKg(item.kgInitial, 1)} kg</td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold text-ink-3">Ilość dostępna:</td>
                  <td className="py-2 font-bold text-success">{fmtKg(item.kgAvailable, 1)} kg</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

export function RawStockPage() {
  const { data: meatData, loading: meatLoading } = useApi(() => meatStockApi.list())
  const { data: debData,  loading: debLoading  } = useApi(() => deboningApi.list())
  // WAŻNE: używamy .all() — traceability wymaga WSZYSTKICH partii (w tym zużytych)
  const { data: batchData } = useApi(() => (rawBatchesApi as any).all())

  const [activeTab, setActiveTab] = useState<'meat' | 'backs' | 'bones'>('meat')
  const [traceItem, setTraceItem] = useState<{
    type: 'meat' | 'backs' | 'bones'
    item?: MeatStock
    session?: DeboningSession
    batch?: RawBatch
  } | null>(null)

  const meatList = meatData?.data ?? []
  const sessions = debData?.data ?? []
  const batches  = batchData?.data ?? []

  const totalMeatAvailable = meatList.reduce((sum, m) => sum + Number(m.kgAvailable), 0)
  const totalBacks = sessions.reduce((sum, s) => sum + Number(s.kgBacks || 0), 0)
  const totalBones = sessions.reduce((sum, s) => sum + Number(s.kgBones || 0), 0)

  const backsItems = sessions.filter(s => Number(s.kgBacks || 0) > 0)
  const bonesItems = sessions.filter(s => Number(s.kgBones || 0) > 0)

  const loading = meatLoading || debLoading

  const openTrace = (type: 'meat' | 'backs' | 'bones', item?: MeatStock, session?: DeboningSession) => {
    const s = session || (item ? sessions.find(x => x.id === item.deboningSessionId) : undefined)
    const b = s
      ? batches.find(x => x.id === s.rawBatchId)
      : item
        ? batches.find(x => x.id === item.rawBatchId || x.internalBatchNo === item.rawBatchNo)
        : undefined
    setTraceItem({ type, item, session: s, batch: b })
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Card className="p-5">
        <CardHeader title="Magazyn — Surowiec" subtitle="Stany i partie surowca" />
        <div className="grid grid-cols-3 gap-4 mt-4">
          {[
            { key:'meat',  label:'Mięso Z/S',  val:`${fmtKg(totalMeatAvailable, 0)} kg`, icon:<Beef size={16} /> },
            { key:'backs', label:'Grzbiety',    val:`${fmtKg(totalBacks, 0)} kg`,         icon:<Layers size={16} /> },
            { key:'bones', label:'Kości',       val:`${fmtKg(totalBones, 0)} kg`,         icon:<Package size={16} /> },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
              className={cn('p-4 rounded-xl border-2 text-center transition-all',
                activeTab === tab.key ? 'border-brand bg-brand-light' : 'border-surface-4 bg-surface-3 hover:border-brand/30')}>
              <div className={cn('flex justify-center mb-1', activeTab === tab.key ? 'text-brand' : 'text-ink-3')}>{tab.icon}</div>
              <div className={cn('text-lg font-bold', activeTab === tab.key ? 'text-brand' : 'text-ink')}>{tab.val}</div>
              <div className={cn('text-[10px] font-semibold uppercase tracking-wide', activeTab === tab.key ? 'text-brand' : 'text-ink-3')}>{tab.label}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="bg-surface border border-surface-4 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-surface-4">
          <span className="text-[13px] font-semibold text-ink">
            {activeTab === 'meat' ? 'Mięso Z/S' : activeTab === 'backs' ? 'Grzbiety' : 'Kości'}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={24} /></div>
        ) : activeTab === 'meat' ? (
          meatList.length === 0 ? (
            <EmptyState icon={<Beef size={40} />} title="Brak mięsa" message="Mięso pojawi się po rozbiorze" />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-surface-4 bg-slate-50">
                  {['Nr partii mięsa / Partia','Dostępne','Daty','Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {meatList.map(m => {
                  const batch = batches.find(b => b.id === m.rawBatchId || b.internalBatchNo === m.rawBatchNo)
                  return (
                    <tr key={m.id} className="hover:bg-surface-3/60">
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-[11px] text-ink-3">{m.lotNo}</div>
                        <div className="font-mono font-bold text-brand">{batch?.internalBatchNo || m.rawBatchNo}</div>
                        {batch?.supplierName && (
                          <div className="text-[10px] text-ink-3">{batch.supplierName}</div>
                        )}
                        {batch?.supplierBatchNo && (
                          <div className="text-[10px] text-ink-4">nr: {batch.supplierBatchNo}</div>
                        )}
                        {batch?.slaughterDate && (
                          <div className="text-[10px] text-ink-4">ubój: {fmtDatePl(batch.slaughterDate)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-bold text-success text-base">{fmtKg(m.kgAvailable, 2)} kg</div>
                        <div className="text-[10px] text-ink-3">z {fmtKg(m.kgInitial, 2)} kg</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-ink-3">Prod: {fmtDatePl(m.productionDate)}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-ink-3">Ważn:</span>
                          <ExpiryBadge date={m.expiryDate} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => openTrace('meat', m)}
                          className="p-1.5 rounded border border-surface-4 text-ink-3 hover:border-brand hover:text-brand">
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : activeTab === 'backs' ? (
          backsItems.length === 0 ? (
            <EmptyState icon={<Layers size={40} />} title="Brak grzbietów" message="Grzbiety pojawią się po rozbiorze" />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-surface-4 bg-surface-2">
                  {['Partia','Dostawca','Grzbiety kg','Data',].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backsItems.map((s, i) => {
                  const batch = batches.find(b => b.id === s.rawBatchId)
                  return (
                    <tr key={i} className="hover:bg-surface-3/60">
                      <td className="px-3 py-2 font-mono font-bold text-brand">{batch?.internalBatchNo || s.rawBatchNo}</td>
                      <td className="px-3 py-2 text-ink-3">{batch?.supplierName || '—'}</td>
                      <td className="px-3 py-2 font-bold">{fmtKg(s.kgBacks, 2)} kg</td>
                      <td className="px-3 py-2 text-ink-3">{fmtDatePl(s.createdAt?.slice(0,10) || '')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          bonesItems.length === 0 ? (
            <EmptyState icon={<Package size={40} />} title="Brak kości" message="Kości pojawią się po rozbiorze" />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-surface-4 bg-surface-2">
                  {['Partia','Dostawca','Kości kg','Data'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bonesItems.map((s, i) => {
                  const batch = batches.find(b => b.id === s.rawBatchId)
                  return (
                    <tr key={i} className="hover:bg-surface-3/60">
                      <td className="px-3 py-2 font-mono font-bold text-brand">{batch?.internalBatchNo || s.rawBatchNo}</td>
                      <td className="px-3 py-2 text-ink-3">{batch?.supplierName || '—'}</td>
                      <td className="px-3 py-2 font-bold">{fmtKg(s.kgBones, 2)} kg</td>
                      <td className="px-3 py-2 text-ink-3">{fmtDatePl(s.createdAt?.slice(0,10) || '')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      {traceItem && (
        <TraceabilityModal
          type={traceItem.type}
          item={traceItem.item}
          session={traceItem.session}
          batch={traceItem.batch}
          onClose={() => setTraceItem(null)}
        />
      )}
    </div>
  )
}
