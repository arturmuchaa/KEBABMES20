/**
 * SeasonedMeatPage — Magazyn mięsa przyprawionego (lista, styl Subiekt GT).
 *
 * Gęsta lista partii mięsa przyprawionego (po masowaniu). FEFO domyślnie:
 * najstarsza ważność na górze. Klik wiersza → modal ze szczegółami i
 * pełnym łańcuchem partii (RAW → ROZBIÓR → MASOWANIE → MPP).
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { seasonedMeatApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import {
  Beef, Eye, Search, X, ChevronDown, ChevronUp, ChevronsUpDown, Download, ChevronRight,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

// ─── Sort ────────────────────────────────────────────────────
type SortCol = 'batchNo' | 'recipeName' | 'productTypeName' | 'kgAvailable' | 'kgReserved' | 'expiryDate' | 'completedAt'

// ─── Helpers ─────────────────────────────────────────────────
function kgFreeOf(b: any): number { return Number(b.kgFree ?? b.kgAvailable) || 0 }

function compareRows(col: SortCol, a: any, b: any) {
  switch (col) {
    case 'batchNo':         return (a.batchNo || '').localeCompare(b.batchNo || '')
    case 'recipeName':      return (a.recipeName || '').localeCompare(b.recipeName || '')
    case 'productTypeName': return (a.productTypeName || '').localeCompare(b.productTypeName || '')
    case 'kgAvailable':     return kgFreeOf(a) - kgFreeOf(b)
    case 'kgReserved':      return Number(a.kgReserved || 0) - Number(b.kgReserved || 0)
    case 'expiryDate':      return (a.expiryDate || '').localeCompare(b.expiryDate || '')
    case 'completedAt':     return (a.completedAt || '').localeCompare(b.completedAt || '')
  }
}

function exportCsv(rows: any[]) {
  const headers = ['Nr partii','Receptura','Rodzaj','Dostępne kg','Rezerwacja kg','Ważność','Masownica','Ukończono']
  const csv = [headers.join(';')].concat(rows.map(r => [
    r.batchNo, r.recipeName || '', r.productTypeName || '',
    String(kgFreeOf(r)).replace('.', ','),
    String(r.kgReserved || 0).replace('.', ','),
    r.expiryDate || '',
    r.machineId || '',
    (r.completedAt || '').slice(0, 10),
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'))).join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `mieso-przyprawione-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  if (daysLeft < 0)   return <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">wygasło</Badge>
  if (daysLeft === 0) return <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">dziś</Badge>
  if (daysLeft <= 1)  return <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">jutro</Badge>
  if (daysLeft <= 3)  return <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{daysLeft}d</Badge>
  return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">{daysLeft}d</Badge>
}

// ─── TracePanel (lineage modal) ──────────────────────────────
function TracePanel({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { data, loading, error } = useApi<any>(
    () => (seasonedMeatApi as any).getFullTrace(batchId),
    [batchId]
  )

  const rawBatchNos: string[] = data
    ? [...new Set(
        (data.meatLots ?? [])
          .map((l: any) => l.rawBatch?.internal_batch_no ?? l.rawBatch?.internalBatchNo)
          .filter(Boolean) as string[]
      )]
    : []

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data ? `Śledzenie — ${data.seasoned.batchNo}` : 'Śledzenie partii'}</DialogTitle>
          <DialogDescription>Łańcuch: Przyjęcie → Rozbiór → Masowanie → Mięso przyprawione</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-4">
            {[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : error || !data ? (
          <div className="py-8 text-center text-sm text-destructive">
            Błąd ładowania danych śledzenia. Sprawdź połączenie z serwerem.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Podsumowanie kg */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Surowiec (ćwiartka)', val: `${fmtKg(data.summary.totalRawKg ?? 0)} kg`, accent: '' },
                { label: 'Mięso Z/S',           val: `${fmtKg(data.summary.totalMeatKg ?? 0)} kg`, accent: 'text-blue-700' },
                { label: 'Dostępne',             val: `${fmtKg(data.seasoned.kgAvailable ?? 0)} kg`, accent: 'text-emerald-700' },
              ].map(k => (
                <Card key={k.label} className="bg-muted/40 border-transparent text-center">
                  <CardContent className="p-3">
                    <CardDescription className="text-[10px] font-bold uppercase mb-0.5">{k.label}</CardDescription>
                    <CardTitle className={`text-base ${k.accent}`}>{k.val}</CardTitle>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Łańcuch */}
            <Card className="bg-muted/40 border-transparent">
              <CardContent className="p-3">
                <CardDescription className="text-[11px] font-bold uppercase tracking-wide mb-2">Łańcuch partii</CardDescription>
                <div className="flex items-center gap-1 flex-wrap">
                  {rawBatchNos.map(n => (
                    <code key={n} className="font-mono font-black text-blue-700 bg-blue-50 px-2 py-1 rounded text-xs">{n}</code>
                  ))}
                  {rawBatchNos.length > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
                  {(data.meatLots ?? []).map((l: any) => (
                    <code key={l.meatStockId ?? l.meatLotNo} className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-xs">{l.meatLotNo}</code>
                  ))}
                  {(data.meatLots ?? []).length > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
                  <code className="font-mono font-black text-primary bg-primary/10 px-2 py-1 rounded text-xs">{data.seasoned.batchNo}</code>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Szczegóły lotów */}
            <div className="space-y-3">
              <CardTitle className="text-sm">Szczegóły — partie mięsa</CardTitle>
              {(data.meatLots ?? []).map((t: any, i: number) => (
                <Card key={i}>
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                    <code className="font-mono font-bold text-emerald-700 text-sm">{t.meatLotNo ?? '—'}</code>
                    <div className="flex items-center gap-2">
                      <CardDescription className="text-xs">{fmtKg(t.kgPlanned ?? 0)} kg</CardDescription>
                      <Badge variant={t.rawBatch ? 'success' : 'danger'}>
                        {t.rawBatch ? 'Znaleziono' : '⚠ Brak danych'}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-0 divide-y">
                    <div className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2.5">
                      <CardDescription className="text-xs font-semibold">Wpis rozbioru</CardDescription>
                      {t.deboningEntry ? (
                        <div className="text-xs">
                          <code className="font-mono text-primary">{t.deboningEntry.sessionNo}</code>
                          <CardDescription className="text-xs ml-2 inline">
                            {fmtKg(t.deboningEntry.kgTaken)} kg ćwiartki → {fmtKg(t.deboningEntry.kgMeat)} kg mięsa
                          </CardDescription>
                          {t.deboningEntry.workerName && (
                            <CardDescription className="text-xs ml-2 inline">· {t.deboningEntry.workerName}</CardDescription>
                          )}
                        </div>
                      ) : <CardDescription className="text-xs text-destructive">⚠ Brak wpisu rozbioru</CardDescription>}
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2.5">
                      <CardDescription className="text-xs font-semibold">Ćwiartka</CardDescription>
                      {t.rawBatch ? (
                        <div className="flex items-center gap-3 text-xs flex-wrap">
                          <code className="font-mono font-bold text-blue-700">
                            {t.rawBatch.internal_batch_no ?? t.rawBatch.internalBatchNo ?? '—'}
                          </code>
                          <CardDescription className="text-xs">
                            {fmtKg(t.rawBatch.kg_received ?? t.rawBatch.kgReceived ?? 0)} kg przyjęte
                          </CardDescription>
                          <CardDescription className="text-xs">
                            ubój: {fmtDatePl(t.rawBatch.slaughter_date ?? t.rawBatch.slaughterDate ?? '')}
                          </CardDescription>
                          <CardDescription className="text-xs">
                            ważność: {fmtDatePl(t.rawBatch.expiry_date ?? t.rawBatch.expiryDate ?? '')}
                          </CardDescription>
                        </div>
                      ) : <CardDescription className="text-xs text-destructive">⚠ Brak danych ćwiartki</CardDescription>}
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2.5">
                      <CardDescription className="text-xs font-semibold">Dostawca</CardDescription>
                      {t.supplier ? (
                        <div className="flex items-center gap-3 text-xs flex-wrap">
                          <CardTitle className="text-xs">{t.supplier.name}</CardTitle>
                          {(t.supplier.vet_number ?? t.supplier.vetNumber) && (
                            <CardDescription className="text-xs">wet.: {t.supplier.vet_number ?? t.supplier.vetNumber}</CardDescription>
                          )}
                          {(t.rawBatch?.supplier_batch_no ?? t.rawBatch?.supplierBatchNo) && (
                            <CardDescription className="text-xs">nr: {t.rawBatch?.supplier_batch_no ?? t.rawBatch?.supplierBatchNo}</CardDescription>
                          )}
                        </div>
                      ) : <CardDescription className="text-xs text-destructive">⚠ Brak danych dostawcy</CardDescription>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Masowanie */}
            <Card className="bg-muted/40 border-transparent">
              <CardContent className="p-3">
                <CardDescription className="text-[11px] font-bold uppercase tracking-wide mb-2">Masowanie</CardDescription>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <CardDescription className="text-xs">Zlecenie:</CardDescription>
                    <code className="font-mono font-bold text-primary">{data.seasoned.mixingOrderNo ?? '—'}</code>
                  </div>
                  <div>
                    <CardDescription className="text-xs">Receptura:</CardDescription>
                    <CardTitle className="text-xs inline">{data.seasoned.recipeName ?? '—'}</CardTitle>
                  </div>
                  <div>
                    <CardDescription className="text-xs">Masownica:</CardDescription>
                    <CardTitle className="text-xs inline">
                      {data.mixingOrder?.machine_id ?? data.mixingOrder?.machineId ?? '—'}
                    </CardTitle>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Strona ─────────────────────────────────────────────────
export function SeasonedMeatPage() {
  const { data,      loading }  = useApi(() => seasonedMeatApi.list())
  const { data: all }           = useApi(() => seasonedMeatApi.all())
  const [traceId,   setTraceId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const raw: any[]        = data ?? []
  const allBatches: any[] = all  ?? []

  const totalFree     = raw.reduce((s, b) => s + kgFreeOf(b), 0)
  const totalReserved = raw.reduce((s, b) => s + Number(b.kgReserved || 0), 0)

  const depleted = allBatches.filter(b => b.status === 'depleted')

  usePageHeaderActions(
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Partii: <span className="text-ink font-bold">{raw.length}</span></span>
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Wolne kg: <span className="text-emerald-700 font-bold">{fmtKg(totalFree, 0)}</span></span>
      {totalReserved > 0 && <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Rezerwacja: <span className="text-amber-700 font-bold">{fmtKg(totalReserved, 0)}</span></span>}
    </div>,
    [raw.length, totalFree, totalReserved]
  )

  return (
    <div className="space-y-3 animate-fade-in">
      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 space-y-2">
          {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : raw.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <Beef size={36} className="text-muted-foreground opacity-20" />
          <div className="text-sm font-medium text-muted-foreground">Brak mięsa przyprawionego</div>
          <div className="text-xs text-muted-foreground">Partie pojawią się po zrealizowaniu zleceń masowania</div>
        </div>
      ) : (
        <DataTable
          rows={raw} rowKey={b => b.id}
          searchText={b => `${b.batchNo || ''} ${b.recipeName || ''} ${b.productTypeName || ''} ${b.mixingOrderNo || ''} ${b.machineId || ''} ${(b.rawBatchNos || []).join(' ')}`}
          searchPlaceholder="Filtruj: nr partii, receptura, rodzaj, masownica, partia surowca…"
          initialSort={{ key: 'expiryDate' }}
          onRowClick={b => setTraceId(b.id)}
          footer={rows => {
            const tf = rows.reduce((s, b) => s + kgFreeOf(b), 0)
            const tr = rows.reduce((s, b) => s + Number(b.kgReserved || 0), 0)
            return <><span>Suma · {rows.length} partii</span><span className="ml-auto">Wolne: <span className="text-emerald-700 font-bold">{fmtKg(tf, 0)} kg</span></span>{tr > 0 && <span>Rezerwacja: <span className="text-amber-700 font-bold">{fmtKg(tr, 0)} kg</span></span>}</>
          }}
          columns={[
            { key: 'batchNo', header: 'Nr partii', sortable: true, sortValue: b => b.batchNo || '',
              cell: b => <code className="font-mono font-bold text-primary text-[12px]">{b.batchNo}</code> },
            { key: 'recipeName', header: 'Receptura', sortable: true, sortValue: b => b.recipeName || '',
              cell: b => <span className="text-ink font-medium truncate block max-w-[200px]" title={b.recipeName}>{b.recipeName || <span className="text-muted-foreground">—</span>}</span> },
            { key: 'productTypeName', header: 'Rodzaj', sortable: true, sortValue: b => b.productTypeName || '',
              cell: b => b.productTypeName || <span className="text-muted-foreground">—</span> },
            { key: 'kgAvailable', header: 'Wolne kg', align: 'right', sortable: true, sortValue: b => kgFreeOf(b),
              cell: b => <span className="font-bold text-emerald-700">{fmtKg(kgFreeOf(b), 1)}</span> },
            { key: 'kgReserved', header: 'Rezerwacja', align: 'right', sortable: true, sortValue: b => Number(b.kgReserved || 0),
              cell: b => Number(b.kgReserved || 0) > 0 ? <span className="font-bold text-amber-700">{fmtKg(Number(b.kgReserved || 0), 1)}</span> : <span className="text-muted-foreground">—</span> },
            { key: 'expiryDate', header: 'Ważność', sortable: true, sortValue: b => b.expiryDate || '',
              cell: b => <div className="flex items-center gap-1.5"><span className="text-ink-2">{fmtDatePl(b.expiryDate)}</span>{b.expiryDate && <ExpiryBadge date={b.expiryDate} />}</div> },
            { key: 'completedAt', header: 'Ukończono', sortable: true, sortValue: b => b.completedAt || '',
              cell: b => b.completedAt ? fmtDatePl(b.completedAt.slice(0, 10)) : <span className="text-muted-foreground">—</span> },
            { key: 'source', header: 'Źródło',
              cell: b => (
                <div className="flex items-center gap-1 flex-nowrap overflow-hidden max-w-[260px]">
                  {(b.rawBatchNos || []).slice(0, 2).map((n: string) => <code key={n} className="font-mono text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{n}</code>)}
                  {(b.rawBatchNos || []).length > 2 && <span className="text-[10px] text-muted-foreground">+{(b.rawBatchNos || []).length - 2}</span>}
                  {(b.rawBatchNos || []).length > 0 && <ChevronRight size={10} className="text-muted-foreground flex-shrink-0" />}
                  <code className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{b.batchNo}</code>
                </div>
              ) },
            { key: 'act', header: '', align: 'right',
              cell: b => <button onClick={e => { e.stopPropagation(); setTraceId(b.id) }} className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Łańcuch partii (traceability)"><Eye size={12} /></button> },
          ]}
        />
      )}

      {/* Historia — zużyte partie */}
      {depleted.length > 0 && (
        <Card>
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold">Historia · wykorzystane partie</CardTitle>
              <Badge variant="outline" className="text-[10px]">{depleted.length}</Badge>
            </div>
            {showHistory ? <ChevronUp size={14} className="text-muted-foreground"/> : <ChevronDown size={14} className="text-muted-foreground"/>}
          </button>
          {showHistory && (
            <div className="border-t overflow-auto max-h-[40vh]">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                  <tr>
                    {['Nr partii','Receptura','Wyprodukowano','Ukończono','Źródło'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {depleted.map((b, idx) => (
                    <tr
                      key={b.id}
                      onClick={() => setTraceId(b.id)}
                      className={cn(
                        'cursor-pointer border-b border-surface-3 opacity-70',
                        idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                        'hover:bg-blue-50/60 hover:opacity-100'
                      )}
                    >
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <code className="font-mono font-bold text-muted-foreground text-[12px]">{b.batchNo}</code>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{b.recipeName || '—'}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{fmtKg(b.kgProduced, 1)} kg</td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                        {b.completedAt ? fmtDatePl(b.completedAt.slice(0, 10)) : '—'}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <code className="font-mono text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          {(b.rawBatchNos || []).join(', ') || '—'}
                        </code>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Eye size={12} className="text-muted-foreground inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {traceId && <TracePanel batchId={traceId} onClose={() => setTraceId(null)} />}
    </div>
  )
}
