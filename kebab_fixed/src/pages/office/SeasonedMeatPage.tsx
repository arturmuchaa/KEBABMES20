/**
 * SeasonedMeatPage — Magazyn mięsa przyprawionego
 * FEFO, pełna traceability RAW→CUTTING→SEASONED
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { seasonedMeatApi } from '@/lib/apiClient'
import { Spinner, EmptyState, Modal } from '@/components/ui/Card'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Beef, AlertTriangle, ChevronRight, Eye, ChevronDown, ChevronUp } from 'lucide-react'
import type { SeasonedMeatBatch } from '@/lib/mockApi'

function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  if (daysLeft < 0)   return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700">Wygasło</span>
  if (daysLeft === 0) return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700">Dziś!</span>
  if (daysLeft <= 1)  return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Jutro</span>
  return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700">{daysLeft}d</span>
}

// Panel pełnej traceability dla jednej partii
function TracePanel({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { data, loading } = useApi(
    () => (seasonedMeatApi as any).getFullTrace(batchId),
    [batchId]
  )

  if (loading) return (
    <Modal open title="Traceability" onClose={onClose} size="lg">
      <div className="flex justify-center py-10"><Spinner size={24} /></div>
    </Modal>
  )
  if (!data) return null

  const { seasoned, meatLots, summary } = data

  return (
    <Modal open title={`Traceability — ${seasoned.batchNo}`}
      subtitle="Pełny łańcuch: Dostawca → Ćwiartka → Rozbiór → Masowanie → Mięso przyprawione"
      onClose={onClose} size="lg">
      <div className="space-y-4">

        {/* Podsumowanie */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label:'Surowiec (ćwiartka)', val:`${fmtKg(summary.totalRawKg)} kg`, color:'text-ink' },
            { label:'Mięso Z/S',           val:`${fmtKg(summary.totalMeatKg)} kg`, color:'text-blue-700' },
            { label:'Produkt gotowy',       val:`${fmtKg(summary.totalOutputKg)} kg`, color:'text-green-700' },
          ].map(k => (
            <div key={k.label} className="bg-surface-2 border border-surface-4 rounded-lg p-3 text-center">
              <div className="text-[10px] font-bold text-ink-4 uppercase mb-0.5">{k.label}</div>
              <div className={`text-base font-black ${k.color}`}>{k.val}</div>
            </div>
          ))}
        </div>

        {/* Łańcuch graficzny */}
        <div className="bg-surface-2 border border-surface-4 p-3 text-[12px]">
          <div className="font-bold text-ink-3 uppercase text-[10px] tracking-wide mb-2">Łańcuch partii</div>
          <div className="flex items-center gap-1 flex-wrap">
            {summary.rawBatchNos.map((n: string) => (
              <span key={n} className="font-mono font-black text-blue-700 bg-blue-50 px-2 py-1 rounded">{n}</span>
            ))}
            <ChevronRight size={14} className="text-ink-4" />
            {seasoned.meatLots.map((l: any) => (
              <span key={l.meatLotId} className="font-mono font-bold text-green-700 bg-green-50 px-2 py-1 rounded">{l.meatLotNo}</span>
            ))}
            <ChevronRight size={14} className="text-ink-4" />
            <span className="font-mono font-black text-brand bg-blue-100 px-2 py-1 rounded">{seasoned.batchNo}</span>
          </div>
        </div>

        {/* Szczegóły per lot */}
        <div>
          <div className="font-bold text-[12px] text-ink mb-2">Szczegóły partii mięsa</div>
          <div className="space-y-2">
            {meatLots.map((t: any, i: number) => (
              <div key={i} className="border border-surface-4 rounded-lg overflow-hidden">
                {/* Nagłówek lotu */}
                <div className="bg-surface-2 px-3 py-2 flex items-center gap-3">
                  <span className="font-mono font-bold text-green-700">
                    {t.meatStock?.lotNo ?? '—'}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    {fmtKg(seasoned.meatLots[i]?.kgPlanned ?? 0)} kg
                  </span>
                  <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    t.meatStock ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {t.meatStock ? 'Znaleziono' : '⚠ Brak danych'}
                  </span>
                </div>

                {/* Łańcuch: MeatStock → DeboningEntry → RawBatch → Supplier */}
                <div className="divide-y divide-surface-4">
                  {/* Wpis rozbioru */}
                  <div className="px-3 py-2 grid grid-cols-[120px_1fr] gap-2 text-[12px]">
                    <span className="text-ink-3 font-semibold">Wpis rozbioru</span>
                    {t.deboningEntry ? (
                      <div>
                        <span className="font-mono text-brand">{t.deboningEntry.sessionNo}</span>
                        <span className="text-ink-3 ml-2">
                          {fmtKg(t.deboningEntry.kgTaken)} kg ćwiartki → {fmtKg(t.deboningEntry.kgMeat)} kg mięsa
                        </span>
                        <span className="text-ink-4 ml-2">· {t.deboningEntry.workerName}</span>
                      </div>
                    ) : <span className="text-red-600">⚠ Brak wpisu rozbioru</span>}
                  </div>

                  {/* Ćwiartka */}
                  <div className="px-3 py-2 grid grid-cols-[120px_1fr] gap-2 text-[12px]">
                    <span className="text-ink-3 font-semibold">Ćwiartka</span>
                    {t.rawBatch ? (
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-blue-700">{t.rawBatch.internalBatchNo}</span>
                        <span className="text-ink-3">{fmtKg(t.rawBatch.kgReceived)} kg przyjęte</span>
                        <span className="text-ink-4">ubój: {fmtDatePl(t.rawBatch.slaughterDate)}</span>
                        <span className="text-ink-4">ważność: {fmtDatePl(t.rawBatch.expiryDate)}</span>
                      </div>
                    ) : <span className="text-red-600">⚠ Brak danych ćwiartki</span>}
                  </div>

                  {/* Dostawca */}
                  <div className="px-3 py-2 grid grid-cols-[120px_1fr] gap-2 text-[12px]">
                    <span className="text-ink-3 font-semibold">Dostawca</span>
                    {t.supplier ? (
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-ink">{t.supplier.name}</span>
                        {t.supplier.vetNumber && <span className="text-ink-4">wet.: {t.supplier.vetNumber}</span>}
                        {t.rawBatch?.supplierBatchNo && (
                          <span className="text-ink-4">nr partii dostawcy: {t.rawBatch.supplierBatchNo}</span>
                        )}
                      </div>
                    ) : <span className="text-red-600">⚠ Brak danych dostawcy</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Info masowanie */}
        <div className="border border-surface-4 rounded-lg p-3 text-[12px]">
          <div className="font-bold text-ink-3 uppercase text-[10px] tracking-wide mb-2">Masowanie</div>
          <div className="grid grid-cols-3 gap-2">
            <div><span className="text-ink-3">Zlecenie: </span><span className="font-mono font-bold text-brand">{seasoned.mixingOrderNo}</span></div>
            <div><span className="text-ink-3">Receptura: </span><span className="font-semibold">{seasoned.recipeName}</span></div>
            <div><span className="text-ink-3">Masownica: </span><span className="font-semibold">{seasoned.machineId}</span></div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function SeasonedMeatPage() {
  const { data, loading }     = useApi(() => seasonedMeatApi.list())
  const { data: all }         = useApi(() => seasonedMeatApi.all())
  const [traceId, setTraceId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const batches = data ?? []
  const allBatches = all ?? []
  const totalAvail = batches.reduce((s, b) => s + b.kgAvailable, 0)
  const critical   = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 1)

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>

  return (
    <div className="space-y-4 animate-fade-in">

      {critical.length > 0 && (
        <div className="border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-red-700 mb-1">
            <AlertTriangle size={13} /> {critical.length} partii wygasa dziś lub jutro
          </div>
          {critical.map(b => (
            <div key={b.id} className="text-[12px] text-red-600">
              {b.batchNo} · {b.recipeName} · {fmtKg(b.kgAvailable)} kg · do: {fmtDatePl(b.expiryDate)}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label:'Partie dostępne', val: batches.length, color:'text-ink' },
          { label:'Łącznie kg',      val: `${fmtKg(totalAvail)} kg`, color:'text-green-700' },
          { label:'Alerty',          val: critical.length, color: critical.length > 0 ? 'text-red-600' : 'text-ink-4' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-surface-4 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">{k.label}</div>
            <div className={`text-xl font-bold ${k.color}`}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Tabela FEFO */}
      <div className="bg-white border border-surface-4 shadow-card">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center gap-2">
          <Beef size={13} className="text-ink-3" />
          <span className="text-[13px] font-semibold text-ink">Dostępne partie (FEFO)</span>
        </div>

        {batches.length === 0 ? (
          <EmptyState icon={<Beef size={32} />} title="Brak mięsa przyprawionego"
            message="Zrealizuj zlecenia masowania" />
        ) : (
          <div className="divide-y divide-surface-4">
            {batches.map(b => {
              const isExp = expanded === b.id
              return (
                <div key={b.id}>
                  {/* Wiersz główny */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 cursor-pointer"
                    onClick={() => setExpanded(isExp ? null : b.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-brand">{b.batchNo}</span>
                        <span className="text-[11px] text-ink-3">{b.recipeName}</span>
                        {b.productTypeName && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{b.productTypeName}</span>
                        )}
                      </div>
                      {/* Mini traceability */}
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {b.rawBatchNos.map(n => (
                          <span key={n} className="text-[10px] font-mono bg-surface-3 text-ink-3 px-1.5 py-0.5 rounded">{n}</span>
                        ))}
                        {b.rawBatchNos.length > 0 && <ChevronRight size={10} className="text-ink-5" />}
                        {b.meatLots.map(l => (
                          <span key={l.meatLotId} className="text-[10px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{l.meatLotNo}</span>
                        ))}
                        {b.meatLots.length > 0 && <ChevronRight size={10} className="text-ink-5" />}
                        <span className="text-[10px] font-mono font-bold bg-blue-100 text-brand px-1.5 py-0.5 rounded">{b.batchNo}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="font-bold text-green-700">{fmtKg(b.kgAvailable)} kg</div>
                        <ExpiryBadge date={b.expiryDate} />
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setTraceId(b.id) }}
                        className="flex items-center gap-1 text-[11px] font-medium text-brand border border-brand/30 px-2 py-1 rounded hover:bg-blue-50"
                        title="Pełna traceability"
                      >
                        <Eye size={12} /> Trace
                      </button>
                      {isExp ? <ChevronUp size={14} className="text-ink-4" /> : <ChevronDown size={14} className="text-ink-4" />}
                    </div>
                  </div>

                  {/* Rozwinięte szczegóły */}
                  {isExp && (
                    <div className="px-4 pb-3 bg-surface-2 border-t border-surface-4">
                      <div className="grid grid-cols-2 gap-3 mt-2 text-[12px]">
                        <div>
                          <div className="text-[10px] font-bold text-ink-4 uppercase mb-1">Masowanie</div>
                          <div>Zlecenie: <span className="font-mono font-bold text-brand">{b.mixingOrderNo}</span></div>
                          <div>Masownica: {b.machineId}</div>
                          <div>Wyprodukowano: {fmtKg(b.kgProduced)} kg</div>
                          <div>Ukończono: {fmtDatePl(b.completedAt.slice(0,10))}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-ink-4 uppercase mb-1">Ćwiartki (surowiec)</div>
                          {(b.rawBatchNos?.length > 0
                            ? b.rawBatchNos
                            : [...new Set(b.meatLots.map((l: any) => l.rawBatchNo).filter(Boolean))]
                          ).map((n: string) => (
                            <div key={n} className="font-mono font-bold text-blue-700">{n}</div>
                          ))}
                          {b.rawBatchNos?.length === 0 && b.meatLots.every((l: any) => !l.rawBatchNo) && <div className="text-ink-4">—</div>}
                          {b.slaughterDates.length > 0 && (
                            <div className="text-ink-3 mt-1">
                              Data uboju: {b.slaughterDates.map(d => fmtDatePl(d)).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Historia */}
      {allBatches.filter(b => b.status === 'depleted').length > 0 && (
        <div className="bg-white border border-surface-4 shadow-card">
          <div className="px-4 py-2.5 border-b border-surface-4">
            <span className="text-[13px] font-semibold text-ink">Historia — wykorzystane partie</span>
          </div>
          <table className="w-full text-[12px]">
            <tbody className="divide-y divide-surface-4">
              {allBatches.filter(b => b.status === 'depleted').map(b => (
                <tr key={b.id} className="opacity-60">
                  <td className="px-3 py-2 font-mono text-ink-3">{b.batchNo}</td>
                  <td className="px-3 py-2">{b.recipeName}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-4">
                    {b.rawBatchNos.join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-ink-4">{fmtKg(b.kgProduced)} kg</td>
                  <td className="px-3 py-2">
                    <button onClick={() => setTraceId(b.id)}
                      className="text-[11px] text-ink-3 border border-surface-4 px-1.5 py-0.5 rounded hover:text-brand">
                      <Eye size={11} className="inline mr-1" />Trace
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel traceability */}
      {traceId && <TracePanel batchId={traceId} onClose={() => setTraceId(null)} />}
    </div>
  )
}
