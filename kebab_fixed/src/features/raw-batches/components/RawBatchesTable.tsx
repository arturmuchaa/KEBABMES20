/**
 * RawBatchesTable — kompaktowa tabela ERP
 * Czysto prezentacyjny komponent. Zero logiki — tylko render.
 */
import { ExpiryBadge, StatusBadge, computeDisplayStatus } from '@/components/ui/Badge'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
import { Spinner, EmptyState } from '@/components/ui/Card'
import type { RawBatch } from '@/types'
import { Package } from 'lucide-react'

interface RawBatchesTableProps {
  batches: RawBatch[]
  loading: boolean
}

export function RawBatchesTable({ batches, loading }: RawBatchesTableProps) {
  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Spinner size={24} />
    </div>
  )

  if (batches.length === 0) return (
    <EmptyState
      icon={<Package size={32} />}
      title="Brak partii"
      message="Przyjmij pierwszą partię ćwiartki klikając przycisk powyżej"
    />
  )

  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-surface-4 bg-surface-2">
          {['Nr partii','Dostawca','Nr dostawcy','Ubój','Ważność','Kg przyjęto','Kg dostępne','Cena/kg','Status'].map(h => (
            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4 whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-4">
        {batches.map(b => {
          // computeDisplayStatus — zawsze z danych, nie z pola status
          const displayStatus = computeDisplayStatus(b.expiryDate, Number(b.kgAvailable))
          return (
            <tr key={b.id} className="hover:bg-surface-2 transition-colors">
              <td className="px-3 py-2 font-mono font-bold text-ink">{b.internalBatchNo}</td>
              <td className="px-3 py-2 text-ink-2 max-w-[140px] truncate">{b.supplierName ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-ink-3 text-[11px]">{b.supplierBatchNo}</td>
              <td className="px-3 py-2 text-ink-3 whitespace-nowrap">{fmtDatePl(b.slaughterDate)}</td>
              <td className="px-3 py-2">
                <ExpiryBadge dateStr={b.expiryDate} />
              </td>
              <td className="px-3 py-2 text-right font-semibold">{fmtKg(b.kgReceived)} kg</td>
              <td className="px-3 py-2 text-right font-bold text-ink">{fmtKg(b.kgAvailable)} kg</td>
              <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtPln(b.pricePerKg)}</td>
              <td className="px-3 py-2">
                <StatusBadge status={displayStatus} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
