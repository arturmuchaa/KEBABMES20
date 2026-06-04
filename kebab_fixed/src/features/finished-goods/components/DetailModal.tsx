/**
 * DetailModal — szczegóły partii wyrobu gotowego + pełny łańcuch traceability.
 *
 * Współdzielony między listą (grid kart) a stroną szczegółów rodzaju produktu.
 */
import { useState, useEffect } from 'react'
import { traceabilityApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { useClientNames } from '@/lib/clientNames'
import { GitBranch, Beef, Soup, Package, Factory } from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

import {
  CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

export function LineageChain({ batchId }: { batchId: string }) {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    traceabilityApi.backward(batchId)
      .then(r => { if (!cancelled) { setData(r); setError(null); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Błąd ładowania'); setLoading(false) } })
    return () => { cancelled = true }
  }, [batchId])

  if (loading) return <CardDescription className="text-xs italic">Wczytuję łańcuch partii...</CardDescription>
  if (error) return <CardDescription className="text-xs text-red-600">Błąd: {error}</CardDescription>
  if (!data) return null

  const rawBatches: any[]      = data.rawBatches      ?? []
  const deboning: any[]        = data.deboning        ?? []
  const mixingOrders: any[]    = data.mixingOrders    ?? []
  const seasonedBatches: any[] = data.seasonedBatches ?? []
  const suppliers: any[]       = data.suppliers       ?? []

  const supplierByBatch = new Map<string, string>()
  rawBatches.forEach((rb: any) => {
    const sup = suppliers.find((s: any) => s.id === rb.supplier_id)
    if (sup) supplierByBatch.set(rb.id, sup.display_name || sup.name || '')
  })

  const Box = ({ icon, color, label, items, extractKey, extractLabel, extractSub }: {
    icon: React.ReactNode; color: string; label: string; items: any[]
    extractKey: (i: any) => string; extractLabel: (i: any) => string; extractSub?: (i: any) => string | null
  }) => (
    <div className="flex-1 min-w-[160px]">
      <div className={cn('flex items-center gap-1.5 mb-1.5', color)}>
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic px-2 py-1.5 rounded bg-gray-50 border border-gray-200">brak</div>
      ) : (
        <div className="space-y-1">
          {items.map(i => (
            <div key={extractKey(i)} className="px-2 py-1.5 rounded border bg-white">
              <code className="font-mono font-bold text-xs block">{extractLabel(i)}</code>
              {extractSub && extractSub(i) && (
                <div className="text-[10px] text-muted-foreground mt-0.5">{extractSub(i)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <GitBranch size={13} className="text-primary"/>
        <CardDescription className="text-[10px] font-bold uppercase">Pełny łańcuch partii (traceability)</CardDescription>
      </div>
      <div className="flex flex-wrap gap-2 items-stretch bg-gradient-to-br from-blue-50/30 to-white border rounded-xl p-3">
        <Box
          icon={<Beef size={11}/>}
          color="text-blue-700"
          label="Ćwiartka"
          items={rawBatches}
          extractKey={(rb) => rb.id}
          extractLabel={(rb) => rb.internal_batch_no || rb.id.slice(0,8)}
          extractSub={(rb) => supplierByBatch.get(rb.id) || rb.supplier_name || null}
        />
        <div className="self-center text-muted-foreground text-lg leading-none">→</div>
        <Box
          icon={<Package size={11}/>}
          color="text-green-700"
          label="Rozbiór · mięso z/s"
          items={deboning}
          extractKey={(d) => d.id}
          extractLabel={(d) => d.rawBatchNo || d.raw_batch_no || d.meatLotNo || d.meat_lot_no || d.id.slice(0,8)}
          extractSub={(d) => {
            const kg = Number(d.kgMeat ?? d.kg_meat ?? 0)
            return kg > 0 ? `${fmtKg(kg, 1)} kg` : null
          }}
        />
        <div className="self-center text-muted-foreground text-lg leading-none">→</div>
        <Box
          icon={<Soup size={11}/>}
          color="text-purple-700"
          label="Masowanie · zlecenie"
          items={mixingOrders}
          extractKey={(mo) => mo.id}
          extractLabel={(mo) => mo.order_no || mo.id.slice(0,8)}
          extractSub={(mo) => mo.recipe_name || null}
        />
        <div className="self-center text-muted-foreground text-lg leading-none">→</div>
        <Box
          icon={<Beef size={11}/>}
          color="text-amber-700"
          label="Mięso przyprawione"
          items={seasonedBatches}
          extractKey={(sm) => sm.id}
          extractLabel={(sm) => sm.batch_no || sm.id.slice(0,8)}
          extractSub={(sm) => {
            const kg = Number(sm.kg_produced ?? 0)
            return kg > 0 ? `${fmtKg(kg, 1)} kg` : null
          }}
        />
        <div className="self-center text-muted-foreground text-lg leading-none">→</div>
        <div className="flex-1 min-w-[140px]">
          <div className="flex items-center gap-1.5 mb-1.5 text-red-700">
            <Factory size={11}/>
            <span className="text-[10px] font-bold uppercase tracking-wide">Wyrób gotowy</span>
          </div>
          <div className="px-2 py-1.5 rounded border-2 border-red-300 bg-red-50">
            <code className="font-mono font-bold text-xs text-red-700 block">
              {(data.finishedGoods ?? [])[0]?.batch_no || batchId}
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DetailModal({ item, onClose }: { item: FinishedGoodsItem; onClose: () => void }) {
  const clientDisplay = useClientNames()
  const subEntries: any[] = (item as any).subEntries ?? []
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Szczegóły — {item.batchNo}</DialogTitle>
          <DialogDescription>Pełne dane partii wyrobu gotowego</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Produkt',   val: item.productTypeName },
              { label: 'Receptura', val: item.recipeName },
              { label: 'Tuleja',    val: item.packagingName ?? '—' },
              { label: 'Klient',    val: item.clientName ? clientDisplay(item.clientName) : '—' },
              { label: 'Łącznie',   val: `${item.qty} szt · ${fmtKg(item.totalKg)} kg` },
              { label: 'Data',      val: fmtDatePl(item.producedDate) },
            ].map(r => (
              <div key={r.label}>
                <CardDescription className="text-[10px] font-bold uppercase mb-0.5">{r.label}</CardDescription>
                <CardTitle className="text-sm font-semibold">{r.val}</CardTitle>
              </div>
            ))}
          </div>

          <LineageChain batchId={item.id} />

          {subEntries.length > 0 && (
            <div className="space-y-2">
              <CardDescription className="text-[10px] font-bold uppercase">
                Wyprodukowano w {subEntries.length} sesji
              </CardDescription>
              <div className="divide-y border rounded-xl overflow-hidden">
                {subEntries.map((s: any, i: number) => (
                  <div key={i} className="px-3 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-sm font-bold">{s.qty} szt</CardTitle>
                      <CardDescription className="text-xs">{fmtKg(s.totalKg)} kg</CardDescription>
                      {(s.seasonedBatchNos ?? []).length > 0 && (
                        <div className="flex gap-1">
                          {(s.seasonedBatchNos ?? []).map((n: string) => (
                            <code key={n} className="font-mono text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{n}</code>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CardDescription className="text-xs">{(s.workerNames ?? []).join(', ')}</CardDescription>
                      <CardDescription className="text-xs">{s.addedAt?.slice(11, 16) ?? ''}</CardDescription>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.producedBy.length > 0 && (
            <div className="space-y-1">
              <CardDescription className="text-[10px] font-bold uppercase">Pracownicy</CardDescription>
              <CardTitle className="text-sm font-medium">{item.producedBy.join(', ')}</CardTitle>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
