import { cn } from '@/lib/utils'
import { Spinner } from './Card'

export interface Column<T> {
  key: string; header: string; render: (row: T) => React.ReactNode; className?: string
}

export function Table<T>({ columns, data, loading, keyFn, onRowClick, empty = 'Brak danych' }: {
  columns: Column<T>[]; data: T[]; loading?: boolean; keyFn: (r: T) => string
  onRowClick?: (r: T) => void; empty?: string
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-4">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className={cn(
                'bg-surface-2 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[.5px] text-ink-4 border-b border-surface-4 whitespace-nowrap',
                c.className
              )}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="py-16 text-center">
                <div className="flex justify-center"><Spinner size={28} /></div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-12 text-center text-sm text-ink-4">{empty}</td>
            </tr>
          ) : data.map(row => (
            <tr
              key={keyFn(row)}
              className={cn(
                'border-b border-surface-3 last:border-b-0 transition-colors',
                onRowClick && 'cursor-pointer hover:bg-surface-2/70'
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map(c => (
                <td key={c.key} className={cn('px-4 py-3 text-sm text-ink-2 align-middle', c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
