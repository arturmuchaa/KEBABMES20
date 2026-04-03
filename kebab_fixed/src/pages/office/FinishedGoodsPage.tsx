/**
 * FinishedGoodsPage — Magazyn wyrobów gotowych
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { Eye, ShoppingBag, ChevronDown, ChevronUp, ChevronsUpDown, Search } from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function DetailModal({ item, onClose }: { item: FinishedGoodsItem; onClose: () => void }) {
  const subEntries: any[] = (item as any).subEntries ?? []
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Szczegóły — {item.batchNo}</DialogTitle>
          <DialogDescription>Pełne dane partii wyrobu gotowego</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Podsumowanie */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Produkt',   val: item.productTypeName },
              { label: 'Receptura', val: item.recipeName },
              { label: 'Tuleja',    val: item.packagingName ?? '—' },
              { label: 'Klient',    val: item.clientName ?? '—' },
              { label: 'Łącznie',   val: `${item.qty} szt · ${fmtKg(item.totalKg)} kg` },
              { label: 'Data',      val: fmtDatePl(item.producedDate) },
            ].map(r => (
              <div key={r.label}>
                <CardDescription className="text-[10px] font-bold uppercase mb-0.5">{r.label}</CardDescription>
                <CardTitle className="text-sm font-semibold">{r.val}</CardTitle>
              </div>
            ))}
          </div>

          {/* Partie mięsa */}
          {item.seasonedBatchNos.length > 0 && (
            <div className="space-y-1.5">
              <CardDescription className="text-[10px] font-bold uppercase">Partie mięsa (traceability)</CardDescription>
              <div className="flex gap-1.5 flex-wrap">
                {item.seasonedBatchNos.map(n => (
                  <code key={n} className="font-mono text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded font-bold">
                    {n}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Per session */}
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

          {/* Workers */}
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

type SortCol = 'batchNo' | 'productTypeName' | 'clientName' | 'qty' | 'totalKg' | 'producedDate'

export function FinishedGoodsPage() {
  const { data: items, loading } = useApi(() => finishedGoodsApi.list())
  const [detailItem, setDetailItem] = useState<FinishedGoodsItem | null>(null)
  const [filter,   setFilter]   = useState('')
  const [sortCol,  setSortCol]  = useState<SortCol>('producedDate')
  const [sortDir,  setSortDir]  = useState<'asc'|'desc'>('desc')

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30"/>

  const rawList = items ?? []

  const list = useMemo(() => {
    const q = filter.toLowerCase()
    const filtered = q
      ? rawList.filter(i =>
          i.batchNo.toLowerCase().includes(q) ||
          (i.clientName || '').toLowerCase().includes(q) ||
          (i.productTypeName || '').toLowerCase().includes(q) ||
          (i.recipeName || '').toLowerCase().includes(q)
        )
      : rawList
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'batchNo')        cmp = a.batchNo.localeCompare(b.batchNo)
      if (sortCol === 'productTypeName')cmp = (a.productTypeName||'').localeCompare(b.productTypeName||'')
      if (sortCol === 'clientName')     cmp = (a.clientName||'').localeCompare(b.clientName||'')
      if (sortCol === 'qty')            cmp = a.qtyAvailable - b.qtyAvailable
      if (sortCol === 'totalKg')        cmp = (a.qtyAvailable * a.kgPerUnit) - (b.qtyAvailable * b.kgPerUnit)
      if (sortCol === 'producedDate')   cmp = (a.producedDate||'').localeCompare(b.producedDate||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawList, filter, sortCol, sortDir])

  const totalQty = rawList.reduce((s, i) => s + i.qtyAvailable, 0)
  const totalKg  = rawList.reduce((s, i) => s + i.qtyAvailable * i.kgPerUnit, 0)

  return (
    <div className="space-y-5 animate-fade-in">

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pozycje',      val: rawList.length,       accent: '' },
          { label: 'Dostępne szt', val: totalQty,             accent: '' },
          { label: 'Łącznie kg',   val: fmtKg(totalKg),       accent: 'text-green-700' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <CardDescription className="text-xs font-semibold uppercase tracking-wide mb-1">{k.label}</CardDescription>
              <CardTitle className={`text-2xl font-black tabular-nums ${k.accent}`}>{k.val}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">{list.length} partii wyrobów gotowych</CardTitle>
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Filtruj klienta, produkt…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0,1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : rawList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShoppingBag size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak wyrobów</CardTitle>
              <CardDescription>Wyroby pojawią się po zakończeniu dnia produkcji</CardDescription>
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Search size={28} className="text-muted-foreground opacity-20" />
              <CardDescription>Brak wyników dla &ldquo;{filter}&rdquo;</CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort('batchNo')}
                  >
                    <div className="flex items-center gap-1">Nr partii <SortIcon col="batchNo"/></div>
                  </TableHead>
                  <TableHead
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort('productTypeName')}
                  >
                    <div className="flex items-center gap-1">Produkt · Receptura <SortIcon col="productTypeName"/></div>
                  </TableHead>
                  <TableHead
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort('clientName')}
                  >
                    <div className="flex items-center gap-1">Klient <SortIcon col="clientName"/></div>
                  </TableHead>
                  <TableHead
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort('qty')}
                  >
                    <div className="flex items-center gap-1">Szt <SortIcon col="qty"/></div>
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wide whitespace-nowrap">kg/szt</TableHead>
                  <TableHead
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort('totalKg')}
                  >
                    <div className="flex items-center gap-1">Łącznie <SortIcon col="totalKg"/></div>
                  </TableHead>
                  <TableHead
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort('producedDate')}
                  >
                    <div className="flex items-center gap-1">Data <SortIcon col="producedDate"/></div>
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wide whitespace-nowrap">Partie mięsa</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map(item => {
                  const subCount = ((item as any).subEntries ?? []).length
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <code className="font-mono font-bold text-primary text-sm">{item.batchNo}</code>
                        <CardDescription className="text-[10px]">{item.planNo}</CardDescription>
                      </TableCell>
                      <TableCell>
                        <CardTitle className="text-sm font-semibold">{item.productTypeName}</CardTitle>
                        <CardDescription className="text-xs">{item.recipeName}</CardDescription>
                        {item.packagingName && <CardDescription className="text-[10px]">{item.packagingName}</CardDescription>}
                      </TableCell>
                      <TableCell><CardDescription>{item.clientName || '—'}</CardDescription></TableCell>
                      <TableCell>
                        <CardTitle className="text-sm font-bold tabular-nums">{item.qtyAvailable} szt</CardTitle>
                        {subCount > 1 && <CardDescription className="text-[10px]">{subCount} sesji</CardDescription>}
                      </TableCell>
                      <TableCell><CardDescription className="tabular-nums">{item.kgPerUnit} kg</CardDescription></TableCell>
                      <TableCell>
                        <CardTitle className="text-sm font-bold text-green-700 tabular-nums">
                          {fmtKg(item.qtyAvailable * item.kgPerUnit)}
                        </CardTitle>
                      </TableCell>
                      <TableCell><CardDescription className="text-xs">{fmtDatePl(item.producedDate)}</CardDescription></TableCell>
                      <TableCell>
                        <div className="flex gap-0.5 flex-wrap">
                          {[...new Set(item.seasonedBatchNos)].map(n => (
                            <code key={n} className="text-[10px] font-mono bg-green-50 text-green-700 px-1 py-0.5 rounded font-bold">{n}</code>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailItem(item)}>
                          <Eye size={13} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  )
}
