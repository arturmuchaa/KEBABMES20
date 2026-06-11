/**
 * RecallPage — Wycofanie partii (Recall)
 * Kompletny widok recall z sekcjami po polsku
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search, AlertTriangle, Package, FlaskConical, ShoppingBag,
  Users, ChevronDown, ChevronRight, Loader2, Clock, FileText, Layers
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { recallApi } from '@/lib/api'
import { useClientNames } from '@/lib/clientNames'

interface RecallResult {
  batchId:          string
  raw_batches:      any[]
  deboning:         any[]
  deboning_summary: { totalKgMeat: number; totalKgBones: number; totalKgBacks: number; entryCount: number }
  seasoned:         any[]
  mixing_orders:    any[]
  production:       any[]
  finished:         any[]
  clients:          any[]
  suppliers:        any[]
  total_kg:         number
  total_units:      number
  timeline:         { stage: string; batchNo: string; date: string; details: string }[]
  documents:        { type: string; number: string; date: string; value: number }[]
}

// ─── Sekcja składana ──────────────────────────────────────────
function Section({ title, count, icon, color, children, defaultOpen = false }: {
  title: string; count: number; icon: React.ReactNode
  color: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white border border-surface-4 rounded-xl overflow-hidden shadow-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', color)}>{icon}</div>
          <span className="font-bold text-ink text-sm">{title}</span>
          <span className="bg-surface-3 text-ink-3 text-xs font-bold px-2 py-0.5 rounded-full">{count}</span>
        </div>
        {open ? <ChevronDown size={16} className="text-ink-3"/> : <ChevronRight size={16} className="text-ink-3"/>}
      </button>
      {open && <div className="border-t border-surface-3 px-4 py-3">{children}</div>}
    </div>
  )
}

// ─── Tabela danych ─────────────────────────────────────────────
function DataTable({ rows, columns }: {
  rows: any[]
  columns: { key: string; label: string; render?: (v: any, row: any) => React.ReactNode }[]
}) {
  if (rows.length === 0) return <p className="text-sm text-ink-3 py-2">Brak danych</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-surface-3">
            {columns.map(c => (
              <th key={c.key} className="text-left py-2 pr-4 font-bold text-ink-3 uppercase tracking-wide whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-2">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-surface-2/50">
              {columns.map(c => (
                <td key={c.key} className="py-2 pr-4 text-ink font-medium">
                  {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Karta KPI ─────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className={cn('rounded-xl border p-4 text-center', color)}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">{label}</div>
      <div className="text-2xl font-black tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11px] text-ink-3 font-semibold mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Główny komponent ──────────────────────────────────────────
export function RecallPage() {
  const clientDisplay = useClientNames()
  const [searchParams] = useSearchParams()
  const [query,   setQuery]   = useState(searchParams.get('batch') ?? '')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<RecallResult | null>(null)
  const [error,   setError]   = useState('')

  async function doSearch(qOverride?: string) {
    const q = (qOverride ?? query).trim()
    if (!q) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const data = await recallApi.get(q)
      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Błąd wyszukiwania')
    } finally {
      setLoading(false)
    }
  }

  // Prefill z parametru ?batch= (wejście z panelu Śledzenie surowca)
  useEffect(() => {
    const b = searchParams.get('batch')
    if (b) doSearch(b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Nagłówek */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
          <AlertTriangle size={20} className="text-red-600"/>
        </div>
        <div>
          <h1 className="text-xl font-black text-ink">Wycofanie partii (Recall)</h1>
          <p className="text-sm text-ink-3">Wpisz numer partii surowca, mięsa, produktu lub wyrobu gotowego</p>
        </div>
      </div>

      {/* Wyszukiwarka */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"/>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="np. R172, M172, PW-2025-001, P5…"
            className="w-full pl-9 pr-4 h-11 border-2 border-surface-4 rounded-xl text-sm font-semibold focus:outline-none focus:border-brand transition-colors"
          />
        </div>
        <button
          onClick={() => doSearch()}
          disabled={loading || !query.trim()}
          className="h-11 px-6 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 disabled:opacity-40 flex items-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin"/> : <Search size={16}/>}
          Szukaj
        </button>
      </div>

      {/* Błąd */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4 flex items-center gap-2">
          <AlertTriangle size={14}/>
          {error}
        </div>
      )}

      {/* Wyniki */}
      {result && (
        <div className="space-y-4">
          {/* 1. Podsumowanie */}
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-red-600"/>
              <span className="font-black text-red-800 text-sm uppercase tracking-wide">Podsumowanie wycofania</span>
              <a
                href={`/office/partia/${encodeURIComponent(result.batchId)}/raport`}
                target="_blank" rel="noreferrer"
                className="ml-auto rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >Raport partii (PDF)</a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="Łączna masa wycofana (kg)" value={Number(result.total_kg).toFixed(1)} color="bg-white border-red-200"/>
              <KpiCard label="Łączna liczba sztuk" value={result.total_units} color="bg-white border-red-200"/>
              <KpiCard label="Partie surowca" value={result.raw_batches.length} color="bg-white border-surface-4"/>
              <KpiCard label="Produkty gotowe" value={result.finished.length} color="bg-white border-surface-4"/>
            </div>
            {result.deboning_summary && result.deboning_summary.entryCount > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <KpiCard label="Mięso z rozbioru (kg)" value={Number(result.deboning_summary.totalKgMeat).toFixed(1)} color="bg-amber-50 border-amber-200"/>
                <KpiCard label="Kości (kg)" value={Number(result.deboning_summary.totalKgBones).toFixed(1)} color="bg-amber-50 border-amber-200"/>
                <KpiCard label="Grzbiety (kg)" value={Number(result.deboning_summary.totalKgBacks).toFixed(1)} color="bg-amber-50 border-amber-200"/>
              </div>
            )}
            {result.clients.length > 0 && (
              <div className="mt-3 pt-3 border-t border-red-200">
                <div className="text-xs font-bold text-red-700 uppercase mb-2">Dotknięci klienci:</div>
                <div className="flex flex-wrap gap-2">
                  {result.clients.map((c, i) => (
                    <span key={i} className="bg-red-100 text-red-800 text-xs font-semibold px-2 py-1 rounded-lg border border-red-200">
                      {clientDisplay(c.clientName)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. Partie surowca */}
          <Section
            title="Partie surowca"
            count={result.raw_batches.length}
            icon={<Package size={14} className="text-amber-700"/>}
            color="bg-amber-100"
            defaultOpen
          >
            <DataTable
              rows={result.raw_batches}
              columns={[
                { key: 'internal_batch_no', label: 'Nr partii' },
                { key: 'supplier_name',     label: 'Dostawca' },
                { key: 'slaughter_date',    label: 'Data uboju' },
                { key: 'kg_received',       label: 'Kg przyjęte', render: v => v ? `${Number(v).toFixed(1)} kg` : '—' },
                { key: 'expiry_date',       label: 'Ważność' },
                { key: 'status',            label: 'Status', render: v => (
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase',
                    v === 'active' ? 'bg-success-light text-success' : 'bg-surface-3 text-ink-3')}>{v}</span>
                )},
              ]}
            />
          </Section>

          {/* 3. Partie zamarynowane */}
          <Section
            title="Partie zamarynowane"
            count={result.seasoned.length}
            icon={<FlaskConical size={14} className="text-blue-700"/>}
            color="bg-blue-100"
            defaultOpen={result.seasoned.length > 0}
          >
            <DataTable
              rows={result.seasoned}
              columns={[
                { key: 'batch_no',     label: 'Nr partii' },
                { key: 'recipe_name',  label: 'Receptura' },
                { key: 'kg_produced',  label: 'Kg wyprod.',  render: v => v ? `${Number(v).toFixed(1)} kg` : '—' },
                { key: 'expiry_date',  label: 'Ważność' },
                { key: 'status',       label: 'Status', render: v => (
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase',
                    v === 'available' ? 'bg-success-light text-success' : 'bg-surface-3 text-ink-3')}>{v}</span>
                )},
              ]}
            />
          </Section>

          {/* 4. Zlecenia mieszania */}
          {result.mixing_orders.length > 0 && (
            <Section
              title="Partie mięsa (zlecenia)"
              count={result.mixing_orders.length}
              icon={<Layers size={14} className="text-teal-700"/>}
              color="bg-teal-100"
              defaultOpen={false}
            >
              <DataTable
                rows={result.mixing_orders}
                columns={[
                  { key: 'order_no',    label: 'Nr zlecenia' },
                  { key: 'recipe_name', label: 'Receptura' },
                  { key: 'kg_total',    label: 'Kg łącznie', render: v => v ? `${Number(v).toFixed(1)} kg` : '—' },
                  { key: 'status',      label: 'Status' },
                  { key: 'created_at',  label: 'Data', render: v => v ? String(v).slice(0, 10) : '—' },
                ]}
              />
            </Section>
          )}

          {/* 5. Produkty gotowe */}
          <Section
            title="Produkty gotowe"
            count={result.finished.length}
            icon={<ShoppingBag size={14} className="text-green-700"/>}
            color="bg-green-100"
            defaultOpen={result.finished.length > 0}
          >
            <DataTable
              rows={result.finished}
              columns={[
                { key: 'batch_no',       label: 'Nr partii' },
                { key: 'recipe_name',    label: 'Receptura' },
                { key: 'qty',            label: 'Sztuki' },
                { key: 'total_kg',       label: 'Masa', render: v => v ? `${Number(v).toFixed(1)} kg` : '—' },
                { key: 'client_name',    label: 'Klient' },
                { key: 'client_order_no', label: 'Nr zamówienia' },
                { key: 'produced_date',  label: 'Data prod.' },
              ]}
            />
          </Section>

          {/* 6. Klienci */}
          <Section
            title="Klienci"
            count={result.clients.length}
            icon={<Users size={14} className="text-purple-700"/>}
            color="bg-purple-100"
            defaultOpen={result.clients.length > 0}
          >
            {result.clients.length === 0 ? (
              <p className="text-sm text-ink-3 py-2">Brak powiązanych klientów</p>
            ) : (
              <div className="space-y-2">
                {result.clients.map((c, i) => (
                  <div key={i} className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2.5 border border-surface-3">
                    <div>
                      <div className="font-bold text-ink text-sm">{clientDisplay(c.clientName)}</div>
                      {c.clientOrderNo && (
                        <div className="text-xs text-ink-3 font-mono">{c.clientOrderNo}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-black text-ink text-sm">{c.qty} szt</div>
                      {c.totalKg && (
                        <div className="text-xs text-ink-3">{Number(c.totalKg).toFixed(1)} kg</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 7. Oś czasu */}
          {result.timeline.length > 0 && (
            <Section
              title="Oś czasu zdarzeń"
              count={result.timeline.length}
              icon={<Clock size={14} className="text-slate-700"/>}
              color="bg-slate-100"
              defaultOpen={false}
            >
              <div className="space-y-2">
                {result.timeline.map((ev, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <div className="text-ink-3 font-mono whitespace-nowrap pt-0.5 min-w-[80px]">
                      {ev.date ? String(ev.date).slice(0, 10) : '—'}
                    </div>
                    <div className="flex-1">
                      <span className="font-bold text-ink">{ev.stage}</span>
                      {ev.batchNo && (
                        <span className="ml-2 bg-surface-3 text-ink-3 font-mono text-[10px] px-1.5 py-0.5 rounded">
                          {ev.batchNo}
                        </span>
                      )}
                      <div className="text-ink-3 mt-0.5">{ev.details}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 8. Dokumenty */}
          {result.documents.length > 0 && (
            <Section
              title="Dokumenty powiązane"
              count={result.documents.length}
              icon={<FileText size={14} className="text-gray-700"/>}
              color="bg-gray-100"
              defaultOpen={false}
            >
              <DataTable
                rows={result.documents}
                columns={[
                  { key: 'type',   label: 'Typ dokumentu' },
                  { key: 'number', label: 'Numer' },
                  { key: 'date',   label: 'Data', render: v => v ? String(v).slice(0, 10) : '—' },
                  { key: 'value',  label: 'Wartość', render: v => v ? `${Number(v).toFixed(2)}` : '—' },
                ]}
              />
            </Section>
          )}
        </div>
      )}

      {/* Instrukcja gdy brak wyników */}
      {!result && !loading && !error && (
        <div className="text-center py-12 text-ink-3">
          <AlertTriangle size={40} className="mx-auto mb-3 text-ink-5"/>
          <p className="font-bold text-ink-2 mb-1">Wpisz numer partii do wyszukania</p>
          <p className="text-sm">
            Akceptowane formaty: <code className="bg-surface-3 px-1 rounded">R172</code> (surowiec),{' '}
            <code className="bg-surface-3 px-1 rounded">M172</code> (mięso),{' '}
            <code className="bg-surface-3 px-1 rounded">PW-2025-001</code> (zamarynowane),{' '}
            <code className="bg-surface-3 px-1 rounded">P5</code> (wyrób gotowy)
          </p>
        </div>
      )}
    </div>
  )
}
