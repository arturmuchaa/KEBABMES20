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
  const { data, loading, error } = useApi(
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
                <CardDescription className="text-[10px] font-bold uppercase tracking-wide mb-2">Łańcuch partii</CardDescription>
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
                <CardDescription className="text-[10px] font-bold uppercase tracking-wide mb-2">Masowanie</CardDescription>
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
  const [filter,    setFilter]  = useState('')
  const [sortCol,   setSortCol] = useState<SortCol>('expiryDate')
  const [sortDir,   setSortDir] = useState<'asc'|'desc'>('asc')
  const [showHistory, setShowHistory] = useState(false)

  const raw        = data ?? []
  const allBatches = all  ?? []

  const list = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = raw
    if (q) {
      result = raw.filter(b =>
        (b.batchNo || '').toLowerCase().includes(q) ||
        (b.recipeName || '').toLowerCase().includes(q) ||
        (b.productTypeName || '').toLowerCase().includes(q) ||
        (b.mixingOrderNo || '').toLowerCase().includes(q) ||
        (b.machineId || '').toLowerCase().includes(q) ||
        (b.rawBatchNos || []).some((n: string) => n.toLowerCase().includes(q))
      )
    }
    return [...result].sort((a, b) => {
      const cmp = compareRows(sortCol, a, b)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [raw, filter, sortCol, sortDir])

  const totalFree     = list.reduce((s, b) => s + kgFreeOf(b), 0)
  const totalReserved = list.reduce((s, b) => s + Number(b.kgReserved || 0), 0)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  const depleted = allBatches.filter(b => b.status === 'depleted')

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Toolbar */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-md">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 pr-8 text-xs"
                placeholder="Filtruj: nr partii, receptura, rodzaj, masownica, partia surowca…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                autoFocus
              />
              {filter && (
                <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                  <X size={13}/>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-[11px] tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[10px] font-bold uppercase tracking-wide">Partii:</CardDescription>
              <span className="font-bold">{list.length}{list.length !== raw.length && <span className="text-muted-foreground">/{raw.length}</span>}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[10px] font-bold uppercase tracking-wide">Wolne kg:</CardDescription>
              <span className="font-bold text-emerald-700">{fmtKg(totalFree, 0)}</span>
            </div>
            {totalReserved > 0 && (
              <>
                <div className="w-px h-4 bg-surface-4" />
                <div className="flex items-center gap-1.5">
                  <CardDescription className="text-[10px] font-bold uppercase tracking-wide">Rezerwacja:</CardDescription>
                  <span className="font-bold text-amber-700">{fmtKg(totalReserved, 0)}</span>
                </div>
              </>
            )}
            <div className="w-px h-4 bg-surface-4" />
            <button onClick={() => exportCsv(list)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-surface-4 hover:bg-surface-2 text-[11px] font-medium" title="Eksportuj CSV">
              <Download size={11}/> CSV
            </button>
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : raw.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <Beef size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak mięsa przyprawionego</CardTitle>
            <CardDescription>Partie pojawią się po zrealizowaniu zleceń masowania</CardDescription>
          </CardContent>
        ) : list.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników dla „{filter}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-[11px] tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  {[
                    { col: 'batchNo'         as SortCol, label: 'Nr partii',  align: 'left'  },
                    { col: 'recipeName'      as SortCol, label: 'Receptura',  align: 'left'  },
                    { col: 'productTypeName' as SortCol, label: 'Rodzaj',     align: 'left'  },
                    { col: 'kgAvailable'     as SortCol, label: 'Wolne kg',   align: 'right' },
                    { col: 'kgReserved'      as SortCol, label: 'Rezerwacja', align: 'right' },
                    { col: 'expiryDate'      as SortCol, label: 'Ważność',    align: 'left'  },
                    { col: 'completedAt'     as SortCol, label: 'Ukończono',  align: 'left'  },
                  ].map(h => (
                    <th
                      key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className={cn(
                        'group cursor-pointer select-none px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                        h.align === 'right' && 'text-right',
                      )}
                    >
                      <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                        {h.label}
                        <SortIcon col={h.col} />
                      </span>
                    </th>
                  ))}
                  <th className="text-left px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-2 whitespace-nowrap">
                    Łańcuch
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {list.map((b, idx) => {
                  const kgFree = kgFreeOf(b)
                  const kgReserved = Number(b.kgReserved || 0)
                  return (
                    <tr
                      key={b.id}
                      onClick={() => setTraceId(b.id)}
                      className={cn(
                        'cursor-pointer border-b border-surface-3 transition-colors',
                        idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                        'hover:bg-blue-50/60'
                      )}
                    >
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <code className="font-mono font-bold text-primary text-[12px]">{b.batchNo}</code>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-ink font-medium max-w-[200px] truncate" title={b.recipeName}>
                        {b.recipeName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">
                        {b.productTypeName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-right font-bold text-emerald-700">
                        {fmtKg(kgFree, 1)}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-right">
                        {kgReserved > 0
                          ? <span className="font-bold text-amber-700">{fmtKg(kgReserved, 1)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-ink-2">{fmtDatePl(b.expiryDate)}</span>
                          {b.expiryDate && <ExpiryBadge date={b.expiryDate} />}
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">
                        {b.completedAt ? fmtDatePl(b.completedAt.slice(0, 10)) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1 flex-nowrap overflow-hidden max-w-[260px]">
                          {(b.rawBatchNos || []).slice(0, 2).map((n: string) => (
                            <code key={n} className="font-mono text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{n}</code>
                          ))}
                          {(b.rawBatchNos || []).length > 2 && (
                            <span className="text-[10px] text-muted-foreground">+{(b.rawBatchNos || []).length - 2}</span>
                          )}
                          {(b.rawBatchNos || []).length > 0 && <ChevronRight size={10} className="text-muted-foreground flex-shrink-0" />}
                          <code className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{b.batchNo}</code>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setTraceId(b.id) }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Łańcuch partii (traceability)"
                        >
                          <Eye size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                <tr>
                  <td colSpan={3} className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-2">
                    Suma · {list.length} partii
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                    {fmtKg(totalFree, 0)} kg
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-amber-700">
                    {totalReserved > 0 ? `${fmtKg(totalReserved, 0)} kg` : '—'}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

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
              <table className="w-full text-[11px] tabular-nums">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                  <tr>
                    {['Nr partii','Receptura','Wyprodukowano','Ukończono','Źródło'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-2 text-left whitespace-nowrap">{h}</th>
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
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <code className="font-mono font-bold text-muted-foreground text-[12px]">{b.batchNo}</code>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">{b.recipeName || '—'}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">{fmtKg(b.kgProduced, 1)} kg</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">
                        {b.completedAt ? fmtDatePl(b.completedAt.slice(0, 10)) : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
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
