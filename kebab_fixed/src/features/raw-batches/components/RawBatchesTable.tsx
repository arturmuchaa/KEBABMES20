/**
 * RawBatchesTable — shadcn/ui Table with sort + filter
 */
import { useState, useMemo } from 'react'
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/badge'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import type { RawBatch } from '@/types'
import { Package, ChevronDown, ChevronUp, ChevronsUpDown, Search, Pencil } from 'lucide-react'

interface RawBatchesTableProps {
  batches:  RawBatch[]
  loading:  boolean
  onEdit?:  (batch: RawBatch) => void
}

type SortCol = 'internalBatchNo' | 'supplierName' | 'slaughterDate' | 'expiryDate' | 'kgReceived' | 'kgAvailable'

export function RawBatchesTable({ batches, loading, onEdit }: RawBatchesTableProps) {
  const [filter,  setFilter]  = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('expiryDate')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30"/>

  const displayed = useMemo(() => {
    const q = filter.toLowerCase()
    const filtered = q
      ? batches.filter(b =>
          (b.internalBatchNo||'').toLowerCase().includes(q) ||
          (b.supplierName||'').toLowerCase().includes(q) ||
          (b.supplierBatchNo||'').toLowerCase().includes(q)
        )
      : batches
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'internalBatchNo') cmp = (a.internalBatchNo||'').localeCompare(b.internalBatchNo||'')
      if (sortCol === 'supplierName')    cmp = (a.supplierName||'').localeCompare(b.supplierName||'')
      if (sortCol === 'slaughterDate')   cmp = (a.slaughterDate||'').localeCompare(b.slaughterDate||'')
      if (sortCol === 'expiryDate')      cmp = (a.expiryDate||'').localeCompare(b.expiryDate||'')
      if (sortCol === 'kgReceived')      cmp = Number(a.kgReceived) - Number(b.kgReceived)
      if (sortCol === 'kgAvailable')     cmp = Number(a.kgAvailable) - Number(b.kgAvailable)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [batches, filter, sortCol, sortDir])

  const HEADERS: { col: SortCol | null; label: string }[] = [
    { col: 'internalBatchNo', label: 'Nr partii' },
    { col: 'supplierName',    label: 'Dostawca' },
    { col: null,              label: 'Nr dostawcy' },
    { col: 'slaughterDate',   label: 'Ubój' },
    { col: 'expiryDate',      label: 'Ważność' },
    { col: 'kgReceived',      label: 'Kg przyjęto' },
    { col: 'kgAvailable',     label: 'Kg dostępne' },
    { col: null,              label: 'Cena/kg' },
    { col: null,              label: 'Status' },
    { col: null,              label: '' },
  ]

  if (loading) {
    return (
      <div>
        <div className="px-4 py-2 border-b">
          <Skeleton className="h-8 w-52" />
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {HEADERS.map(h => (
                <TableHead key={h.label} className="text-xs uppercase tracking-wide whitespace-nowrap">
                  {h.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2, 3].map(i => (
              <TableRow key={i} className="hover:bg-transparent">
                {HEADERS.map(h => (
                  <TableCell key={h.label}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <div className="text-muted-foreground opacity-20 mb-1"><Package size={40} /></div>
        <CardTitle className="text-sm font-medium text-muted-foreground">Brak partii</CardTitle>
        <CardDescription className="text-xs text-center max-w-xs">
          Przyjmij pierwszą partię ćwiartki klikając przycisk powyżej
        </CardDescription>
      </div>
    )
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-3">
        <div className="relative w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Filtruj partię, dostawcę…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        {filter && (
          <CardDescription className="text-xs">{displayed.length} z {batches.length}</CardDescription>
        )}
      </div>

      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Search size={28} className="text-muted-foreground opacity-20" />
          <CardDescription>Brak wyników dla &ldquo;{filter}&rdquo;</CardDescription>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {HEADERS.map(h => (
                h.col ? (
                  <TableHead
                    key={h.label}
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort(h.col as SortCol)}
                  >
                    <div className="flex items-center gap-1">
                      {h.label}
                      <SortIcon col={h.col as SortCol} />
                    </div>
                  </TableHead>
                ) : (
                  <TableHead key={h.label} className="text-xs uppercase tracking-wide whitespace-nowrap">
                    {h.label}
                  </TableHead>
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map(b => {
              const displayStatus = computeDisplayStatus(b.expiryDate, Number(b.kgAvailable))
              return (
                <TableRow key={b.id}>
                  <TableCell>
                    <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">
                      {b.internalBatchNo}
                    </code>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="max-w-[140px] truncate">{b.supplierName ?? '—'}</CardDescription>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{b.supplierBatchNo}</code>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="whitespace-nowrap">{fmtDatePl(b.slaughterDate)}</CardDescription>
                  </TableCell>
                  <TableCell><ExpiryBadge dateStr={b.expiryDate} /></TableCell>
                  <TableCell className="text-right">
                    <CardDescription className="font-semibold tabular-nums text-foreground">
                      {fmtKg(b.kgReceived)} kg
                    </CardDescription>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-bold text-foreground tabular-nums text-sm">
                      {fmtKg(b.kgAvailable)} kg
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <code className="font-mono text-xs text-muted-foreground">{fmtPln(b.pricePerKg)}</code>
                  </TableCell>
                  <TableCell><StatusBadge status={displayStatus} /></TableCell>
                  <TableCell>
                    {onEdit && Number(b.kgUsed) === 0 && b.status !== 'cancelled' && !b.isInUse && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                        onClick={() => onEdit(b)}
                      >
                        <Pencil size={13} />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
