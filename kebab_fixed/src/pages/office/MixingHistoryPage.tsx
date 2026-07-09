/**
 * MixingHistoryPage — Historia masowania.
 *
 * Płaska, gęsta tabela zleceń masowania (DataTable — wspólny standard list
 * biura): zlecenie = wiersz z datą, recepturą, partiami mięsa/przyprawionego,
 * masownicami i kg. Klik wiersza otwiera wsady (sesje masowania). Filtry:
 * status (domyślnie Zakończone) + dzień. Czysty odczyt z mixingOrdersApi.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { mixingOrdersApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { ArrowRight, CalendarDays, Cog, X } from 'lucide-react'
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
function dayKey(o: any): string { return String(o.createdAt || '').slice(0, 10) }
function uniq<T>(xs: T[]): T[] { return Array.from(new Set(xs)) }

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

// ─── Dialog: wsady zlecenia ─────────────────────────────────────────────
function OrderDetail({ o, onClose }: { o: any; onClose: () => void }) {
  const sessions: any[] = o.sessions || []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[600px] max-w-[94vw] max-h-[80vh] flex flex-col rounded-xl border border-surface-4 bg-white shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-surface-4">
          <div className="min-w-0">
            <div className="font-bold text-ink leading-tight truncate">{o.recipeName || 'Bez receptury'}</div>
            <div className="font-mono text-[11px] text-ink-3">{o.orderNo} · {fmtDatePl(dayKey(o))}</div>
          </div>
          <StatusBadge status={o.status} />
          <button onClick={onClose} className="ml-auto w-8 h-8 flex items-center justify-center rounded-md border border-surface-4 text-ink-3 hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-widest text-ink-4 font-bold mb-2">
            Wsady ({sessions.length})
          </div>
          {sessions.length === 0 ? (
            <div className="text-[13px] text-ink-4 py-4 text-center">Brak wsadów</div>
          ) : (
            <table className="w-full text-[12px] tabular-nums">
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={i} className="border-b border-surface-3 last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-ink-2">
                        <Cog size={12} className="text-ink-4" /> Masown. {s.machineId}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right text-ink-3 whitespace-nowrap">{fmtKg(s.kgMeat, 0)} kg mięsa</td>
                    <td className="py-1.5 pr-2 w-6 text-ink-5"><ArrowRight size={12} /></td>
                    <td className="py-1.5 pr-3 font-semibold text-ink-2 whitespace-nowrap">{fmtKg(s.kgOutput, 0)} kg uzysku</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-emerald-700 whitespace-nowrap">
                      {s.batchNo ? `partia ${s.batchNo}` : ''}
                    </td>
                    <td className="py-1.5 text-right text-ink-4 w-14">{String(s.completedAt || '').slice(11, 16)}</td>
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
export function MixingHistoryPage() {
  const { data, loading } = useApi<any[]>(() => mixingOrdersApi.list())
  const [status, setStatus] = useState<StatusFilter>('done')
  const [date, setDate] = useState('')
  const [detail, setDetail] = useState<any | null>(null)

  const rows = useMemo(() => (data || []).filter(o => {
    if (status === 'done' && o.status !== 'done') return false
    if (status === 'cancelled' && o.status !== 'cancelled') return false
    if (date && dayKey(o) !== date) return false
    return true
  }), [data, status, date])

  const kgOutputOf = (o: any) =>
    (o.sessions || []).reduce((s: number, x: any) => s + Number(x.kgOutput || 0), 0)

  const columns: DataColumn<any>[] = [
    {
      key: 'date', header: 'Data', sortable: true, width: 110,
      sortValue: o => `${dayKey(o)} ${String(o.daySeq ?? 999).padStart(3, '0')}`,
      cell: o => {
        const k = dayKey(o)
        const d = k ? new Date(k + 'T00:00:00') : null
        return (
          <span className="whitespace-nowrap text-ink-2">
            {k ? fmtDatePl(k) : '—'}
            {d && <span className="text-ink-4 text-[11px]"> · {DOW_SHORT[d.getDay()]}</span>}
          </span>
        )
      },
    },
    {
      key: 'orderNo', header: 'Nr zlec.', sortable: true, width: 110, sortValue: o => o.orderNo,
      cell: o => <code className="font-mono font-semibold text-ink-3 text-[11px] whitespace-nowrap">{o.orderNo}</code>,
    },
    {
      key: 'recipe', header: 'Receptura', sortable: true, sortValue: o => o.recipeName || '',
      cell: o => <span className="font-semibold text-ink">{o.recipeName || 'Bez receptury'}</span>,
    },
    {
      key: 'rawLots', header: 'Partie mięsa', width: 140,
      cell: o => {
        const b = uniq((o.meatLots || []).map((l: any) => l.rawBatchNo).filter(Boolean))
        return b.length
          ? <code className="font-mono text-[11px] font-semibold text-ink-2 truncate block max-w-[130px]" title={b.join(', ')}>{b.join(', ')}</code>
          : <span className="text-ink-4">—</span>
      },
    },
    {
      key: 'outLots', header: 'Partia przypr.', width: 130,
      cell: o => {
        const b = uniq((o.sessions || []).map((s: any) => s.batchNo).filter(Boolean))
        return b.length
          ? <code className="font-mono text-[11px] font-semibold text-emerald-700">{b.join(', ')}</code>
          : <span className="text-ink-4">—</span>
      },
    },
    {
      key: 'machines', header: 'Masownice', width: 100,
      cell: o => {
        const m = uniq((o.sessions || []).map((s: any) => s.machineId).filter(Boolean)).sort()
        return m.length
          ? <span className="text-ink-3 text-[11px]">{m.map(x => `M${x}`).join(' · ')}</span>
          : <span className="text-ink-4">—</span>
      },
    },
    {
      key: 'kg', header: 'Mięso kg', align: 'right', sortable: true, width: 110,
      sortValue: o => Number(o.kgDone || 0),
      cell: o => (
        <span className="whitespace-nowrap">
          <span className="font-bold">{fmtKg(Number(o.kgDone || 0), 0)}</span>
          <span className="text-ink-4"> / {fmtKg(Number(o.meatKg || 0), 0)}</span>
        </span>
      ),
    },
    {
      key: 'output', header: 'Uzysk', align: 'right', sortable: true, width: 90,
      sortValue: o => kgOutputOf(o),
      cell: o => <span className="font-bold text-emerald-700 whitespace-nowrap">{fmtKg(kgOutputOf(o), 0)}</span>,
    },
    {
      key: 'status', header: 'Status', width: 110,
      cell: o => <StatusBadge status={o.status} />,
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
        rowKey={o => o.id}
        columns={columns}
        searchText={o => `${o.recipeName} ${o.orderNo} ${(o.meatLots || []).map((l: any) => l.rawBatchNo).join(' ')} ${(o.sessions || []).map((s: any) => s.batchNo).join(' ')}`}
        searchPlaceholder="Szukaj: produkt, partia, nr zlecenia…"
        initialSort={{ key: 'date', dir: 'desc' }}
        onRowClick={o => setDetail(o)}
        rowClassName={o => o.status === 'cancelled' ? 'opacity-60' : ''}
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
        empty="Brak zleceń masowania — zmień filtr statusu, datę lub wyszukiwanie"
        footer={list => (
          <>
            <span>{list.length} zlec.</span>
            <span className="ml-auto">
              Razem: <span className="font-bold">{fmtKg(list.reduce((s, o) => s + Number(o.kgDone || 0), 0), 0)} kg mięsa</span>
              {' · '}
              <span className="font-bold text-emerald-700">
                {fmtKg(list.reduce((s, o) => s + kgOutputOf(o), 0), 0)} kg uzysku
              </span>
            </span>
          </>
        )}
      />
      {detail && <OrderDetail o={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
