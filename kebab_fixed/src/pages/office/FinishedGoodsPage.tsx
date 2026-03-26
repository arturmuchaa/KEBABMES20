/**
 * FinishedGoodsPage — Magazyn wyrobów gotowych
 * - Scalanie identycznych produktów (receptura+tuleja+klient+kg/szt)
 * - Podgląd: szczegóły per sesja produkcyjna (subEntries)
 */
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { Spinner, EmptyState, Modal } from '@/components/ui/Card'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  ShoppingBag,
  CheckCircle,
} from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

function DetailModal({ item, onClose }: { item: FinishedGoodsItem; onClose: () => void }) {
  const subEntries: any[] = (item as any).subEntries ?? []
  return (
    <Modal open title={`Szczegóły — ${item.batchNo}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Nagłówek */}
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          {[
            { label:'Produkt',   val: item.productTypeName },
            { label:'Receptura', val: item.recipeName },
            { label:'Tuleja',    val: item.packagingName ?? '—' },
            { label:'Klient',    val: item.clientName ?? '—' },
            { label:'Łącznie',   val: `${item.qty} szt · ${fmtKg(item.totalKg)} kg` },
            { label:'Data',      val: fmtDatePl(item.producedDate) },
          ].map(r => (
            <div key={r.label}>
              <div className="text-[10px] font-bold text-ink-4 uppercase">{r.label}</div>
              <div className="font-semibold text-ink">{r.val}</div>
            </div>
          ))}
        </div>

        {/* Partie mięsa */}
        {item.seasonedBatchNos.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-ink-4 uppercase mb-1.5">Partie mięsa (traceability)</div>
            <div className="flex gap-1.5 flex-wrap">
              {item.seasonedBatchNos.map(n => (
                <span key={n} className="font-mono text-[11px] bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded font-bold">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Szczegóły per sesja */}
        {subEntries.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-ink-4 uppercase mb-1.5">
              Wyprodukowano w {subEntries.length} sesji
            </div>
            <div className="border border-surface-4 rounded-lg divide-y divide-surface-4">
              {subEntries.map((s: any, i: number) => (
                <div key={i} className="px-3 py-2.5 text-[12px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-ink">{s.qty} szt</span>
                      <span className="text-ink-3">{fmtKg(s.totalKg)} kg</span>
                      {(s.seasonedBatchNos??[]).length > 0 && (
                        <div className="flex gap-1">
                          {(s.seasonedBatchNos??[]).map((n:string) => (
                            <span key={n} className="font-mono text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{n}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-3">
                      {(s.workerNames??[]).join(', ')}
                      <span className="text-ink-4">{s.addedAt?.slice(11,16)??''}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pracownicy */}
        {item.producedBy.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-ink-4 uppercase mb-1">Pracownicy</div>
            <div className="text-[12px] text-ink">{item.producedBy.join(', ')}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function FinishedGoodsPage() {
  const location = useLocation()
  const { data: items, loading } = useApi(() => finishedGoodsApi.list())
  const [detailItem,   setDetailItem]   = useState<FinishedGoodsItem | null>(null)
  const [groupByRecipe, setGroupByRecipe] = useState(false)
  const [successBanner, setSuccessBanner] = useState<{ count: number } | null>(null)

  useEffect(() => {
    const state = location.state as { justFinished?: boolean; count?: number } | null
    if (state?.justFinished) {
      setSuccessBanner({ count: state.count ?? 0 })
      const t = setTimeout(() => setSuccessBanner(null), 5000)
      return () => clearTimeout(t)
    }
  }, [location.state])

  const list     = items ?? []
  const totalQty = list.reduce((s,i)=>s+i.qtyAvailable,0)
  const totalKg  = list.reduce((s,i)=>s+i.qtyAvailable*i.kgPerUnit,0)

  return (
    <div className="space-y-4 animate-fade-in">
      {successBanner && (
        <div className="flex items-center gap-3 bg-success-light border border-success-border text-success px-4 py-3 rounded-xl font-semibold text-sm">
          <CheckCircle size={18}/>
          Produkcja zakończona — zapisano <strong>{successBanner.count} szt</strong> do magazynu wyrobów gotowych.
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-surface-4 p-3">
          <div className="text-[10px] font-semibold uppercase text-ink-4">Pozycje</div>
          <div className="text-xl font-bold text-ink">{list.length}</div>
        </div>
        <div className="bg-white border border-surface-4 p-3">
          <div className="text-[10px] font-semibold uppercase text-ink-4">Dostępne szt</div>
          <div className="text-xl font-bold text-ink">{totalQty}</div>
        </div>
        <div className="bg-white border border-surface-4 p-3">
          <div className="text-[10px] font-semibold uppercase text-ink-4">Łącznie kg</div>
          <div className="text-xl font-bold text-green-700">{fmtKg(totalKg)}</div>
        </div>
      </div>

      <div className="bg-white border border-surface-4 shadow-card">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">{list.length} partii wyrobów gotowych</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={20}/></div>
        ) : list.length === 0 ? (
          <EmptyState icon={<ShoppingBag size={32}/>} title="Brak wyrobów"
            message="Wyroby pojawią się po zakończeniu dnia produkcji"/>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 bg-surface-2">
                {['Nr partii','Produkt · Receptura','Klient','Szt','kg/szt','Łącznie','Data','Partie mięsa',''].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {list.map(item => {
                const subCount = ((item as any).subEntries ?? []).length
                return (
                  <tr key={item.id} className="hover:bg-surface-2">
                    <td className="px-3 py-2.5">
                      <div className="font-mono font-bold text-brand">{item.batchNo}</div>
                      <div className="text-[10px] text-ink-4">{item.planNo}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-ink">{item.productTypeName}</div>
                      <div className="text-[11px] text-ink-3">{item.recipeName}</div>
                      {item.packagingName && <div className="text-[10px] text-ink-4">{item.packagingName}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">{item.clientName||'—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-ink">{item.qtyAvailable} szt</div>
                      {subCount > 1 && (
                        <div className="text-[10px] text-ink-4">{subCount} sesji</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">{item.kgPerUnit} kg</td>
                    <td className="px-3 py-2.5 font-bold text-green-700">{fmtKg(item.qtyAvailable*item.kgPerUnit)}</td>
                    <td className="px-3 py-2.5 text-ink-3">{fmtDatePl(item.producedDate)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-0.5 flex-wrap">
                        {[...new Set(item.seasonedBatchNos)].map(n=>(
                          <span key={n} className="text-[10px] font-mono bg-green-50 text-green-700 px-1 py-0.5 rounded font-bold">{n}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={()=>setDetailItem(item)}
                        className="p-1.5 rounded border border-surface-4 text-ink-3 hover:border-brand hover:text-brand">
                        <Eye size={13}/>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailItem && <DetailModal item={detailItem} onClose={()=>setDetailItem(null)}/>}
    </div>
  )
}
