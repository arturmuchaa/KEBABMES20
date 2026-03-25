import { cn, fmtKg, fmtDatePl, getExpiryStatus, getExpiryUi } from '@/lib/utils'
import type { RawBatch } from '@/types'

const EXPIRY_STYLE: Record<string, string> = {
  green: 'border-success/40 bg-success-light',
  amber: 'border-warn/60 bg-warn-light',
  red:   'border-danger/60 bg-danger-light',
}

const EXPIRY_DOT: Record<string, string> = {
  green: 'bg-success', amber: 'bg-warn', red: 'bg-danger',
}

interface TabletBatchCardProps {
  batch:    RawBatch
  selected: boolean
  onSelect: () => void
}

export function TabletBatchCard({ batch, selected, onSelect }: TabletBatchCardProps) {
  const { level, daysLeft } = getExpiryStatus(batch.expiryDate)
  const exp = getExpiryUi(level, daysLeft)

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left p-5 rounded-2xl border-2 transition-all duration-150 active:scale-[.98]',
        selected
          ? 'border-brand bg-brand shadow-md'
          : cn('border-2', EXPIRY_STYLE[(['CRITICAL','EXPIRED'].includes(level) ? 'red' : level === 'WARNING' ? 'amber' : 'green')], 'hover:shadow-md'),
      )}
    >
      {/* Batch number */}
      <div className={cn('text-2xl font-black font-mono mb-1', selected ? 'text-white' : 'text-ink')}>
        {batch.internalBatchNo}
      </div>

      {/* Supplier */}
      <div className={cn('text-sm font-medium mb-3 truncate', selected ? 'text-blue-100' : 'text-ink-3')}>
        {batch.supplierName ?? '—'}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between gap-2">
        <div className={cn('text-base font-bold', selected ? 'text-white' : 'text-ink')}>
          {fmtKg(batch.kgAvailable)} kg
        </div>
        <div className={cn('flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full',
          selected ? 'bg-white/20 text-white' : cn('bg-white/60', 'text-' + (['CRITICAL','EXPIRED'].includes(level) ? 'red' : level === 'WARNING' ? 'amber' : 'green'))
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', selected ? 'bg-white' : EXPIRY_DOT[(['CRITICAL','EXPIRED'].includes(level) ? 'red' : level === 'WARNING' ? 'amber' : 'green')])} />
          {exp.label} · {fmtDatePl(batch.expiryDate)}
        </div>
      </div>
    </button>
  )
}
