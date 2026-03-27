import { cn } from '@/lib/utils'
import { SkeletonTable } from './Card'

export interface Column<T> {
  key: string; header: string; render: (row: T) => React.ReactNode; className?: string
}

export function Table<T>({ columns, data, loading, keyFn, onRowClick, empty = 'Brak danych' }: {
  columns: Column<T>[]; data: T[]; loading?: boolean; keyFn: (r: T) => string
  onRowClick?: (r: T) => void; empty?: string
}) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className={cn(
                'bg-surface-3 px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[.6px] text-ink-4 border-b border-surface-4 whitespace-nowrap first:rounded-tl-lg last:rounded-tr-lg',
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
              <td colSpan={columns.length} className="p-0">
                <SkeletonTable rows={5} cols={columns.length} />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-14 text-center text-sm text-ink-4">{empty}</td>
            </tr>
          ) : data.map(row => (
            <tr key={keyFn(row)}
              className={cn(
                'border-b border-surface-4 last:border-b-0 transition-colors',
                onRowClick && 'cursor-pointer hover:bg-surface-3/70'
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map(c => (
                <td key={c.key} className={cn('px-4 py-3 text-[13px] text-ink-2 align-middle', c.className)}>
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
