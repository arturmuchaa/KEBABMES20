/**
 * FinishedGoodsPage — Magazyn wyrobów gotowych (lista, styl Subiekt GT).
 *
 * Gęsta tabela z stickyheader, sortowaniem i szybkim filtrem. Klik wiersza
 * → modal ze szczegółami i pełnym łańcuchem traceability.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { useClientNames } from '@/lib/clientNames'
import { fmtKg, cn } from '@/lib/utils'
import {
  Eye, Search, ChevronDown, ChevronUp, ChevronsUpDown, X, Download, ShoppingBag,
} from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import { DetailModal } from '@/features/finished-goods/components/DetailModal'

// ─── Sort ────────────────────────────────────────────────────
type SortCol =
  | 'qty' | 'kgPerUnit' | 'totalKg'
  | 'productTypeName' | 'recipeName' | 'packagingName' | 'clientName'

function compareRows(col: SortCol) {
  return (a: FinishedGoodsItem, b: FinishedGoodsItem) => {
    switch (col) {
      case 'qty':             return a.qtyAvailable - b.qtyAvailable
      case 'kgPerUnit':       return a.kgPerUnit - b.kgPerUnit
      case 'totalKg':         return (a.qtyAvailable * a.kgPerUnit) - (b.qtyAvailable * b.kgPerUnit)
      case 'productTypeName': return (a.productTypeName || '').localeCompare(b.productTypeName || '')
      case 'recipeName':      return (a.recipeName      || '').localeCompare(b.recipeName      || '')
      case 'packagingName':   return (a.packagingName   || '').localeCompare(b.packagingName   || '')
      case 'clientName':      return (a.clientName      || '').localeCompare(b.clientName      || '')
    }
  }
}

// ─── CSV export ──────────────────────────────────────────────
function exportCsv(rows: FinishedGoodsItem[]) {
  const headers = ['Ilość','kg','Rodzaj','Receptura','Tuleja','Klient','Razem kg']
  const csv = [headers.join(';')]
    .concat(rows.map(r => [
      r.qtyAvailable,
      String(r.kgPerUnit).replace('.', ','),
      r.productTypeName || '',
      r.recipeName || '',
      r.packagingName || '',
      r.clientName || '',
      String(r.qtyAvailable * r.kgPerUnit).replace('.', ','),
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')))
    .join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const today = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `magazyn-wyrobow-gotowych-${today}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Strona ─────────────────────────────────────────────────
export function FinishedGoodsPage() {
  const clientDisplay = useClientNames()
  const { data: items, loading } = useApi(() => finishedGoodsApi.list())
  const [detailItem, setDetailItem] = useState<FinishedGoodsItem | null>(null)
  const [filter,   setFilter]   = useState('')
  const [sortCol,  setSortCol]  = useState<SortCol>('productTypeName')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('asc')

  const rawList = items ?? []

  const list = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = rawList
    if (q) {
      result = rawList.filter(i =>
        (i.batchNo         || '').toLowerCase().includes(q) ||
        (i.clientName      || '').toLowerCase().includes(q) ||
        (i.clientOrderNo   || '').toLowerCase().includes(q) ||
        (i.productTypeName || '').toLowerCase().includes(q) ||
        (i.recipeName      || '').toLowerCase().includes(q) ||
        (i.packagingName   || '').toLowerCase().includes(q) ||
        String(i.kgPerUnit).includes(q)
      )
    }
    const cmp = compareRows(sortCol)
    return [...result].sort((a, b) => sortDir === 'asc' ? cmp(a, b) : -cmp(a, b))
  }, [rawList, filter, sortCol, sortDir])

  const totalQty = list.reduce((s, i) => s + i.qtyAvailable, 0)
  const totalKg  = list.reduce((s, i) => s + i.qtyAvailable * i.kgPerUnit, 0)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  return (
    <div className="space-y-3 animate-fade-in">

      {/* ── Toolbar ─────────────────────────────────────── */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 pr-8 text-sm"
                placeholder="Filtruj: nr partii, klient, receptura, tuleja, kg…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                autoFocus
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink"
                  title="Wyczyść"
                >
                  <X size={14}/>
                </button>
              )}
            </div>
          </div>

          {/* Inline KPI — kompaktowe, magazynowo (Subiekt GT style) */}
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Pozycji:</CardDescription>
              <span className="font-bold">{list.length}{list.length !== rawList.length && <span className="text-muted-foreground">/{rawList.length}</span>}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Szt:</CardDescription>
              <span className="font-bold">{totalQty}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Kg:</CardDescription>
              <span className="font-bold text-emerald-700">{fmtKg(totalKg, 0)}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <button
              onClick={() => exportCsv(list)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-surface-4 hover:bg-surface-2 text-xs font-medium"
              title="Eksportuj CSV"
            >
              <Download size={12}/> CSV
            </button>
          </div>
        </div>
      </Card>

      {/* ── Tabela ─────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <ShoppingBag size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak wyrobów gotowych</CardTitle>
            <CardDescription>Wyroby pojawią się po potwierdzeniu produkcji przez biuro.</CardDescription>
          </CardContent>
        ) : list.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników dla „{filter}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  {[
                    { col: 'qty'             as SortCol, label: 'Ilość',     align: 'right' },
                    { col: 'kgPerUnit'       as SortCol, label: 'kg',        align: 'right' },
                    { col: 'productTypeName' as SortCol, label: 'Rodzaj',    align: 'left'  },
                    { col: 'recipeName'      as SortCol, label: 'Receptura', align: 'left'  },
                    { col: 'packagingName'   as SortCol, label: 'Tuleja',    align: 'left'  },
                    { col: 'clientName'      as SortCol, label: 'Klient',    align: 'left'  },
                    { col: 'totalKg'         as SortCol, label: 'Razem kg',  align: 'right' },
                  ].map(h => (
                    <th
                      key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className={cn(
                        'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                        h.align === 'right' && 'text-right',
                      )}
                    >
                      <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                        {h.label}
                        <SortIcon col={h.col} />
                      </span>
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {list.map((item, idx) => {
                  const totalRowKg = item.qtyAvailable * item.kgPerUnit
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setDetailItem(item)}
                      className={cn(
                        'cursor-pointer border-b border-surface-3 transition-colors',
                        idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                        'hover:bg-blue-50/60'
                      )}
                    >
                      <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold">
                        {item.qtyAvailable}
                        <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-right text-ink-2">
                        {item.kgPerUnit}<span className="text-muted-foreground font-normal text-[11px]"> kg</span>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink">
                        {item.productTypeName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[200px] truncate" title={item.recipeName}>
                        {item.recipeName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                        {item.packagingName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[220px]">
                        {item.clientName ? (
                          <span className="truncate inline-block max-w-full align-bottom" title={item.clientName}>
                            {clientDisplay(item.clientName)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold text-emerald-700">
                        {fmtKg(totalRowKg, 0)}<span className="font-normal text-[11px]"> kg</span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDetailItem(item) }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Szczegóły / łańcuch partii"
                        >
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                <tr>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-ink">
                    {totalQty}
                    <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                  </td>
                  <td colSpan={5} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2">
                    Suma · {list.length} pozycji
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                    {fmtKg(totalKg, 0)} kg
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  )
}
