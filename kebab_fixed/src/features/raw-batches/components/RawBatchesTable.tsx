/**
 * RawBatchesTable — shadcn/ui Table
 */
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/badge'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import type { RawBatch } from '@/types'
import { Package } from 'lucide-react'

interface RawBatchesTableProps {
  batches: RawBatch[]
  loading: boolean
}

const HEADERS = [
  'Nr partii', 'Dostawca', 'Nr dostawcy', 'Ubój', 'Ważność',
  'Kg przyjęto', 'Kg dostępne', 'Cena/kg', 'Status',
]

export function RawBatchesTable({ batches, loading }: RawBatchesTableProps) {
  if (loading) {
    return (
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {HEADERS.map(h => (
              <TableHead key={h} className="text-xs uppercase tracking-wide whitespace-nowrap">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2, 3].map(i => (
            <TableRow key={i} className="hover:bg-transparent">
              {HEADERS.map(h => (
                <TableCell key={h}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {HEADERS.map(h => (
            <TableHead key={h} className="text-xs uppercase tracking-wide whitespace-nowrap">
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map(b => {
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
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
