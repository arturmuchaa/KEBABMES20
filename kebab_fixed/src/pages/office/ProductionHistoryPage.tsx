/**
 * ProductionHistoryPage — Historia produkcji.
 *
 * Płaska, gęsta tabela linii produkcji (DataTable — wspólny standard list
 * biura): każda linia planu = jeden wiersz z datą, produktem, partią
 * przyprawionego, klientem i postępem szt/kg. Klik wiersza otwiera wpisy
 * operatorów. Filtry: status (domyślnie Zakończone) + dzień; wyszukiwarka
 * i sortowanie z DataTable. Czysty odczyt z productionPlansApi.list().
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { productionPlansApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { CalendarDays, User, X } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type DataColumn } from '@/components/DataTable'

type StatusFilter = 'done' | 'all' | 'cancelled'
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'done', label: 'Zakończone' },
  { key: 'all', label: 'Wszystkie' },
  { key: 'cancelled', label: 'Anulowane' },
]

const DOW_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb']
function uniq<T>(xs: T[]): T[] { return Array.from(new Set(xs)) }
// Status efektywny linii: anulowany plan ma priorytet nad statusem linii.
function effStatus(line: any): string {
  return line.planStatus === 'cancelled' ? 'cancelled' : (line.lineStatus || 'PLANNED')
}

function SegFilter({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-3 border border-surface-4">
      {STATUS_TABS.map(t => (
        <button key={t.key} type="button" aria-pressed={value === t.key} onClick={() => onChange(t.key)}
          className={cn('h-7 px-3 rounded-md text-[12px] font-semibold transition-colors cursor-pointer',
            value === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Dialog: wpisy operatorów linii ─────────────────────────────────────
function LineDetail({ line, onClose }: { line: any; onClose: () => void }) {
  const workers: any[] = line.workerEntries || []
  const productName = line.recipeName || line.productTypeName || 'Bez produktu'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[560px] max-w-[94vw] max-h-[80vh] flex flex-col rounded-xl border border-surface-4 bg-white shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-surface-4">
          <div className="min-w-0">
            <div className="font-bold text-ink leading-tight truncate">{productName}</div>
            <div className="font-mono text-[11px] text-ink-3">
              {line.planNo} · {fmtDatePl(line.planDate)}{line.clientName ? ` · ${line.clientName}` : ''}
            </div>
          </div>
          <StatusBadge status={effStatus(line)} />
          <button onClick={onClose} className="ml-auto w-8 h-8 flex items-center justify-center rounded-md border border-surface-4 text-ink-3 hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-widest text-ink-4 font-bold mb-2">
            Wpisy operatorów ({workers.length})
          </div>
          {workers.length === 0 ? (
            <div className="text-[13px] text-ink-4 py-4 text-center">Brak wpisów operatorów</div>
          ) : (
            <table className="w-full text-[12px] tabular-nums">
              <tbody>
                {workers.map((w, i) => (
                  <tr key={i} className="border-b border-surface-3 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-ink-2">
                        <User size={12} className="text-ink-4" /> {w.workerName || w.worker_name || w.name || 'Operator'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-semibold text-ink-2">{Number(w.qty ?? w.qtyDone ?? 0)} szt</td>
                    <td className="py-1.5 text-right text-ink-4 w-14">{String(w.at || w.createdAt || '').slice(11, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Strona ─────────────────────────────────────────────────────────────
export function ProductionHistoryPage() {
  const { data, loading } = useApi<any[]>(() => productionPlansApi.list())
  const [status, setStatus] = useState<StatusFilter>('done')
  const [date, setDate] = useState('')
  const [detail, setDetail] = useState<any | null>(null)

  const rows = useMemo(() => {
    const lines: any[] = []
    for (const p of data || []) {
      const day = String(p.planDate || p.createdAt || '').slice(0, 10)
      for (const ln of p.lines || []) {
        lines.push({ ...ln, planNo: p.planNo, planDate: day, planStatus: p.status })
      }
    }
    return lines.filter(ln => {
      const es = effStatus(ln)
      if (status === 'done' && es !== 'DONE') return false
      if (status === 'cancelled' && es !== 'cancelled') return false
      if (date && ln.planDate !== date) return false
      return true
    })
  }, [data, status, date])

  const columns: DataColumn<any>[] = [
    {
      key: 'planDate', header: 'Data', sortable: true, width: 110,
      sortValue: r => `${r.planDate} ${r.planNo}`,
      cell: r => {
        const d = r.planDate ? new Date(r.planDate + 'T00:00:00') : null
        return (
          <span className="whitespace-nowrap text-ink-2">
            {r.planDate ? fmtDatePl(r.planDate) : '—'}
            {d && <span className="text-ink-4 text-[11px]"> · {DOW_SHORT[d.getDay()]}</span>}
          </span>
        )
      },
    },
    {
      key: 'planNo', header: 'Plan', sortable: true, width: 120, sortValue: r => r.planNo,
      cell: r => <code className="font-mono font-semibold text-ink-3 text-[11px] whitespace-nowrap">{r.planNo}</code>,
    },
    {
      key: 'product', header: 'Produkt', sortable: true,
      sortValue: r => r.recipeName || r.productTypeName || '',
      cell: r => (
        <span className="font-semibold text-ink">
          {r.recipeName || r.productTypeName || 'Bez produktu'}
          {r.productTypeName && r.recipeName && (
            <span className="font-normal text-ink-3 text-[11px]"> · {r.productTypeName}</span>
          )}
        </span>
      ),
    },
    {
      key: 'seasoned', header: 'Partia przypr.', width: 130,
      cell: r => {
        const s = uniq([...(r.seasonedBatchNos || []), r.seasonedBatchNo].filter(Boolean))
        return s.length
          ? <code className="font-mono text-[11px] font-semibold text-ink-2">{s.join(', ')}</code>
          : <span className="text-ink-4">—</span>
      },
    },
    {
      key: 'client', header: 'Klient', sortable: true, sortValue: r => r.clientName || r.clientOrderNo || '',
      cell: r => (r.clientName || r.clientOrderNo)
        ? <span className="text-ink-2 truncate block max-w-[180px]" title={r.clientName || r.clientOrderNo}>{r.clientName || r.clientOrderNo}</span>
        : <span className="text-ink-4">—</span>,
    },
    {
      key: 'packaging', header: 'Opak.', width: 110,
      cell: r => r.packagingName
        ? <span className="text-ink-3 text-[11px] truncate block max-w-[100px]" title={r.packagingName}>{r.packagingName}</span>
        : <span className="text-ink-4">—</span>,
    },
    {
      key: 'qty', header: 'Szt', align: 'right', sortable: true, width: 90,
      sortValue: r => Number(r.qtyDone || 0),
      cell: r => (
        <span className="whitespace-nowrap">
          <span className="font-bold">{Number(r.qtyDone || 0)}</span>
          <span className="text-ink-4">/{Number(r.qty || 0)}</span>
        </span>
      ),
    },
    {
      key: 'kg', header: 'Kg', align: 'right', sortable: true, width: 90,
      sortValue: r => Number(r.totalKg || 0),
      cell: r => <span className="font-bold text-emerald-700 whitespace-nowrap">{fmtKg(Number(r.totalKg || 0), 0)}</span>,
    },
    {
      key: 'status', header: 'Status', width: 110,
      cell: r => <StatusBadge status={effStatus(r)} />,
    },
  ]

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-lg" />)}
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <DataTable
        rows={rows}
        rowKey={r => r.id}
        columns={columns}
        searchText={r => `${r.recipeName} ${r.productTypeName} ${r.planNo} ${r.clientName} ${r.clientOrderNo} ${(r.seasonedBatchNos || []).join(' ')}`}
        searchPlaceholder="Szukaj: produkt, klient, partia, nr planu…"
        initialSort={{ key: 'planDate', dir: 'desc' }}
        onRowClick={r => setDetail(r)}
        rowClassName={r => effStatus(r) === 'cancelled' ? 'opacity-60' : ''}
        toolbarLeft={
          <>
            <SegFilter value={status} onChange={setStatus} />
            <div className="flex items-center gap-1.5">
              <CalendarDays size={14} className="text-ink-4" />
              <Input type="date" value={date} onChange={e => setDate(e.target.value)}
                aria-label="Filtruj po dacie" className="h-9 w-40 bg-white text-[12px]" />
              {date && (
                <button onClick={() => setDate('')} className="text-[12px] text-ink-3 hover:text-ink underline">
                  wyczyść
                </button>
              )}
            </div>
          </>
        }
        empty="Brak linii produkcji — zmień filtr statusu, datę lub wyszukiwanie"
        footer={list => (
          <>
            <span>{list.length} poz.</span>
            <span className="ml-auto">
              Razem: <span className="font-bold">{list.reduce((s, r) => s + Number(r.qtyDone || 0), 0)} szt</span>
              {' · '}
              <span className="font-bold text-emerald-700">
                {fmtKg(list.reduce((s, r) => s + Number(r.totalKg || 0), 0), 0)} kg
              </span>
            </span>
          </>
        )}
      />
      {detail && <LineDetail line={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
