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
  if (daysLeft < 0)   return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Wygasło</span>
  if (daysLeft === 0) return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Dziś!</span>
  if (daysLeft <= 1)  return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Jutro</span>
  return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">{daysLeft}d</span>
}

// Panel śledzenia partii — używa danych już załadowanych z listy (bez dodatkowego API call)
function SledzPanel({ batch, onClose }: { batch: SeasonedMeatBatch; onClose: () => void }) {
  return (
    <Modal open title={`Śledzenie — ${batch.batchNo}`}
      subtitle="Łańcuch: Ćwiartka → Rozbiór → Masowanie → Mięso przyprawione"
      onClose={onClose} size="lg">
      <div className="space-y-4">

        {/* KPI */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Wyprodukowano', val: `${fmtKg(batch.kgProduced)} kg`, color: 'text-green-700' },
            { label: 'Dostępne',      val: `${fmtKg(batch.kgAvailable)} kg`, color: 'text-ink' },
            { label: 'Ważność',       val: fmtDatePl(batch.expiryDate), color: 'text-ink' },
          ].map(k => (
            <div key={k.label} className="bg-surface-3 border border-surface-4 rounded-lg p-3 text-center">
              <div className="text-[10px] font-bold text-ink-4 uppercase mb-0.5">{k.label}</div>
              <div className={`text-sm font-black ${k.color}`}>{k.val}</div>
            </div>
          ))}
        </div>

        {/* Łańcuch */}
        <div className="bg-surface-3 border border-surface-4 rounded-lg p-3">
          <div className="text-[10px] font-bold text-ink-4 uppercase mb-2">Łańcuch partii</div>
          <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
            {batch.rawBatchNos.length > 0 ? batch.rawBatchNos.map(n => (
              <span key={n} className="font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1 rounded">{n}</span>
            )) : <span className="text-ink-4">—</span>}
            <ChevronRight size={13} className="text-ink-4"/>
            {batch.meatLots.map(l => (
              <span key={l.meatLotId} className="font-mono font-bold text-green-400 bg-green-500/15 border border-green-200 px-2 py-1 rounded">{l.meatLotNo}</span>
            ))}
            <ChevronRight size={13} className="text-ink-4"/>
            <span className="font-mono font-black text-brand bg-brand-light border border-brand-border px-2 py-1 rounded">{batch.batchNo}</span>
          </div>
        </div>

        {/* Masowanie */}
        <div className="border border-surface-4 rounded-lg divide-y divide-surface-4 text-[12px]">
          {[
            { label: 'Zlecenie masowania', val: batch.mixingOrderNo || '—', mono: true },
            { label: 'Receptura',          val: batch.recipeName,           mono: false },
            { label: 'Masownica',          val: batch.machineId ? `Masownica ${batch.machineId}` : '—', mono: false },
            { label: 'Ukończono',          val: batch.completedAt ? fmtDatePl(batch.completedAt.slice(0,10)) : '—', mono: false },
          ].map(r => (
            <div key={r.label} className="grid grid-cols-[140px_1fr] gap-2 px-3 py-2.5">
              <span className="text-ink-3 font-semibold">{r.label}</span>
              <span className={r.mono ? 'font-mono font-bold text-brand' : 'font-semibold text-ink'}>{r.val}</span>
            </div>
          ))}
        </div>

        {/* Partie mięsa Z/S */}
        {batch.meatLots.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-ink-4 uppercase mb-2">Partie mięsa (Z/S)</div>
            <div className="border border-surface-4 rounded-lg divide-y divide-surface-4">
              {batch.meatLots.map(l => (
                <div key={l.meatLotId} className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
                  <span className="font-mono font-bold text-green-700">{l.meatLotNo || '—'}</span>
                  {l.rawBatchNo && <span className="text-ink-3">← {l.rawBatchNo}</span>}
                  <span className="ml-auto font-semibold text-ink">{fmtKg(l.kgPlanned)} kg</span>
                  {l.expiryDate && <span className="text-[11px] text-ink-4">do: {fmtDatePl(l.expiryDate)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data uboju */}
        {batch.slaughterDates.length > 0 && (
          <div className="text-[12px] text-ink-3">
            <span className="font-semibold">Data uboju: </span>
            {batch.slaughterDates.map(d => fmtDatePl(d)).join(', ')}
          </div>
        )}
      </div>
    </Modal>
  )
}

export function SeasonedMeatPage() {
  const { data, loading }     = useApi(() => seasonedMeatApi.list())
  const { data: all }         = useApi(() => seasonedMeatApi.all())
  const [traceBatch, setTraceBatch] = useState<SeasonedMeatBatch | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const batches = data ?? []
  const allBatches = all ?? []
  const totalAvail = batches.reduce((s, b) => s + b.kgAvailable, 0)
  const critical   = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 1)

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>

  return (
    <div className="space-y-4 animate-fade-in">

      {critical.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3">
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
          <div key={k.label} className="bg-surface-3 border border-surface-4 p-3 rounded-lg">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">{k.label}</div>
            <div className={`text-xl font-bold ${k.color}`}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Tabela FEFO */}
      <div className="bg-surface border border-surface-4 rounded-xl">
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
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3/60 cursor-pointer"
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
                          <span key={l.meatLotId} className="text-[10px] font-mono bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded">{l.meatLotNo}</span>
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
                        onClick={e => { e.stopPropagation(); setTraceBatch(b) }}
                        className="flex items-center gap-1 text-[11px] font-medium text-brand border border-brand/30 px-2 py-1 rounded hover:bg-blue-50"
                        title="Śledzenie partii"
                      >
                        <Eye size={12} /> Śledzenie
                      </button>
                      {isExp ? <ChevronUp size={14} className="text-ink-4" /> : <ChevronDown size={14} className="text-ink-4" />}
                    </div>
                  </div>

                  {/* Rozwinięte szczegóły */}
                  {isExp && (
                    <div className="px-4 pb-3 bg-surface-3 border-t border-surface-4">
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
        <div className="bg-surface border border-surface-4 rounded-xl">
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
                    <button onClick={() => setTraceBatch(b)}
                      className="text-[11px] text-ink-3 border border-surface-4 px-1.5 py-0.5 rounded hover:text-brand">
                      <Eye size={11} className="inline mr-1" />Śledzenie
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {traceBatch && <SledzPanel batch={traceBatch} onClose={() => setTraceBatch(null)} />}
    </div>
  )
}
