/**
 * DataTable — jeden komponent listy dla biura: styl „Subiekt pro" + wbudowane
 * WYSZUKIWANIE i SORTOWANIE kolumn. Cel: każda lista (i każda nowa) ma ten sam
 * wygląd i te same funkcje bez powielania logiki.
 *
 * Użycie:
 *   <DataTable
 *     rows={list} rowKey={r => r.id}
 *     searchText={r => `${r.name} ${r.nip}`}         // włącza pole szukania
 *     initialSort={{ key: 'name' }}
 *     onRowClick={r => ...}
 *     actions={<Button>Dodaj</Button>}
 *     columns={[
 *       { key:'name', header:'Nazwa', cell:r=>r.name, sortable:true, sortValue:r=>r.name },
 *       { key:'kg', header:'Kg', align:'right', cell:r=>fmt(r.kg), sortable:true, sortValue:r=>r.kg },
 *     ]}
 *   />
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Search, X, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DataColumn<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right'
  sortable?: boolean
  /** Wartość do sortowania (liczba sortuje numerycznie, tekst „naturalnie"). */
  sortValue?: (row: T) => string | number | null | undefined
  cell: (row: T) => ReactNode
  className?: string
  headClassName?: string
  width?: number | string
}

interface Props<T> {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Zwróć tekst do przeszukania; podanie tego włącza pole wyszukiwania. */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  initialSort?: { key: string; dir?: 'asc' | 'desc' }
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  /** Elementy po prawej w pasku (przyciski akcji). */
  actions?: ReactNode
  /** Dodatkowe filtry po lewej, obok wyszukiwarki. */
  toolbarLeft?: ReactNode
  empty?: ReactNode
  /** Kolumna Lp. */
  lp?: boolean
  /** Pasek podsumowania pod tabelą (dostaje aktualnie przefiltrowane wiersze). */
  footer?: (rows: T[]) => ReactNode
  className?: string
}

function compareValues(a: unknown, b: unknown): number {
  const an = a == null ? '' : a
  const bn = b == null ? '' : b
  if (typeof an === 'number' && typeof bn === 'number') return an - bn
  return String(an).localeCompare(String(bn), 'pl', { numeric: true, sensitivity: 'base' })
}

export function DataTable<T>({
  columns, rows, rowKey, searchText, searchPlaceholder = 'Szukaj…',
  initialSort, onRowClick, rowClassName, actions, toolbarLeft, empty, lp, footer, className,
}: Props<T>) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort?.dir ?? 'asc')

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const processed = useMemo(() => {
    const q = query.toLowerCase().trim()
    let out = searchText && q
      ? rows.filter(r => searchText(r).toLowerCase().includes(q))
      : rows.slice()
    const col = columns.find(c => c.key === sortKey)
    if (col) {
      const val = col.sortValue ?? ((r: T) => String(col.cell(r) ?? ''))
      out.sort((a, b) => {
        const c = compareValues(val(a), val(b))
        return sortDir === 'asc' ? c : -c
      })
    }
    return out
  }, [rows, query, sortKey, sortDir, columns, searchText])

  const gridCols = (lp ? '48px ' : '') + columns.map(c =>
    c.width ? (typeof c.width === 'number' ? `${c.width}px` : c.width) : 'minmax(80px,1fr)'
  ).join(' ')

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(searchText || toolbarLeft || actions) && (
        <div className="flex items-center gap-3 flex-wrap">
          {searchText && (
            <div className="relative flex-1 max-w-md min-w-[220px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
              <input
                className="h-9 w-full pl-9 pr-8 text-sm rounded-md border border-surface-4 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                placeholder={searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {toolbarLeft}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      )}

      <div className="rounded-lg border border-surface-4 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full [font-variant-numeric:tabular-nums] text-[13px]">
            <thead>
              <tr>
                {lp && <th className="sticky top-0 z-10 h-10 px-3 bg-surface-2 border-b border-surface-4 text-[11px] font-bold uppercase tracking-wide text-ink-4 text-right w-12">Lp.</th>}
                {columns.map(col => (
                  <th key={col.key}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                    className={cn(
                      'sticky top-0 z-10 h-10 px-3 bg-surface-2 border-b border-surface-4 text-[11px] font-bold uppercase tracking-wide text-ink-3 align-middle',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      col.sortable && 'cursor-pointer select-none hover:text-ink',
                      col.headClassName,
                    )}>
                    <span className={cn('inline-flex items-center gap-1', col.align === 'right' && 'flex-row-reverse')}>
                      {col.header}
                      {col.sortable && (
                        sortKey === col.key
                          ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                          : <ChevronsUpDown size={12} className="text-ink-5" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processed.length === 0 ? (
                <tr><td colSpan={columns.length + (lp ? 1 : 0)} className="px-3 py-10 text-center text-sm text-ink-4">
                  {empty ?? (query ? 'Brak wyników dla filtra' : 'Brak danych')}
                </td></tr>
              ) : processed.map((row, i) => (
                <tr key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-surface-3 even:bg-[#F4F7FB] hover:bg-brand-light/70 transition-colors',
                    onRowClick && 'cursor-pointer',
                    rowClassName?.(row),
                  )}>
                  {lp && <td className="px-3 py-2 text-right text-ink-4 font-mono text-[11px] align-middle">{i + 1}</td>}
                  {columns.map(col => (
                    <td key={col.key} className={cn('px-3 py-2 align-middle', col.align === 'right' && 'text-right', col.className)}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footer && processed.length > 0 && (
          <div className="border-t border-surface-4 bg-surface-2 px-3 py-2 text-[12px] font-semibold text-ink-2 flex items-center gap-4 flex-wrap [font-variant-numeric:tabular-nums]">
            {footer(processed)}
          </div>
        )}
      </div>
    </div>
  )
}
