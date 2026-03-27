/**
 * TraceabilityPage — pełne end-to-end traceability partii
 * /office/traceability/:batchId
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Search, ChevronDown, ChevronRight, Package, Beef,
  FlaskConical, ShoppingBag, Truck, FileText, AlertTriangle,
  RefreshCw, ArrowLeft, Clock, User, Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Card'

// ─── API ──────────────────────────────────────────────────────

const API = (import.meta as any).env?.VITE_API_URL || ''

async function fetchTrace(batchId: string) {
  const res = await fetch(`${API}/api/traceability/${encodeURIComponent(batchId)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as any).detail || 'Błąd pobierania traceability')
  }
  return res.json()
}

async function fetchRecall(batchId: string) {
  const res = await fetch(`${API}/api/traceability/${encodeURIComponent(batchId)}/recall`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as any).detail || 'Błąd symulacji recall')
  }
  return res.json()
}

// ─── Types ────────────────────────────────────────────────────

interface TraceResult {
  batchId: string
  entityType: string
  rawBatch?: Record<string, any>
  supplier?: Record<string, any>
  invoice?: Record<string, any>
  deboningEntries?: Record<string, any>[]
  byproducts?: Record<string, any>[]
  meatLots?: Record<string, any>[]
  mixingOrders?: Record<string, any>[]
  seasonedMeat?: Record<string, any>[]
  finishedGoods?: Record<string, any>[]
  events?: Record<string, any>[]
}

interface RecallResult {
  batchId: string
  entityType: string
  rawBatch?: Record<string, any>
  supplier?: Record<string, any>
  affectedFinishedGoods?: Record<string, any>[]
  affectedSeasonedMeat?: Record<string, any>[]
  summary?: Record<string, any>
}

// ─── helpers ──────────────────────────────────────────────────

function fmt(v: any) {
  if (v == null || v === '') return '—'
  return String(v)
}

function fmtKg(v: any) {
  if (v == null) return '—'
  return `${Number(v).toFixed(3)} kg`
}

function fmtDate(v: any) {
  if (!v) return '—'
  return String(v).substring(0, 10)
}

function entityLabel(t: string) {
  const m: Record<string, string> = {
    raw_batch:      'Partia surowca',
    meat_lot:       'Partia mięsa (lot)',
    seasoned_meat:  'Mięso przyprawione',
    finished_goods: 'Wyrób gotowy',
  }
  return m[t] || t
}

function entityBadgeClass(t: string) {
  const m: Record<string, string> = {
    raw_batch:      'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/25',
    meat_lot:       'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/25',
    seasoned_meat:  'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25',
    finished_goods: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25',
  }
  return m[t] || 'bg-surface-4 text-ink-3 ring-1 ring-surface-5'
}

// ─── Sub-components ───────────────────────────────────────────

function SectionCard({ title, icon, count, children, defaultOpen = true }: {
  title: string
  icon: React.ReactNode
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-surface-4 rounded-xl overflow-hidden mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface hover:bg-surface-3 text-left transition-colors"
      >
        <span className="text-brand">{icon}</span>
        <span className="font-semibold text-ink text-sm flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-xs bg-surface-4 text-ink-3 px-2 py-0.5 rounded-full mr-2">
            {count}
          </span>
        )}
        {open
          ? <ChevronDown size={14} className="text-ink-4" />
          : <ChevronRight size={14} className="text-ink-4" />}
      </button>
      {open && <div className="p-4 bg-surface-3">{children}</div>}
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-ink-3 min-w-[140px]">{label}:</span>
      <span className="text-ink font-medium">{value}</span>
    </div>
  )
}

function FlowArrow() {
  return <div className="flex items-center justify-center py-1 text-ink-4 text-lg">↓</div>
}

function FlowNode({ label, icon, items, emptyText }: {
  label: string
  icon: React.ReactNode
  items: any[]
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) {
    return (
      <div className="border border-surface-4 rounded-lg p-3 text-sm text-ink-4 italic">
        {emptyText || `Brak danych: ${label}`}
      </div>
    )
  }
  return (
    <div className="border border-surface-4 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-3 text-left transition-colors"
      >
        <span className="text-brand">{icon}</span>
        <span className="text-sm font-semibold text-ink flex-1">
          {label}
          <span className="ml-2 text-xs text-ink-4 font-normal">({items.length} szt.)</span>
        </span>
        {open ? <ChevronDown size={12} className="text-ink-4" /> : <ChevronRight size={12} className="text-ink-4" />}
      </button>
      {open && (
        <div className="divide-y divide-surface-4">
          {items.map((item, i) => (
            <div key={item.id || i} className="px-3 py-2 text-xs font-mono text-ink-2">
              {JSON.stringify(item, null, 0).substring(0, 160)}…
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export function TraceabilityPage() {
  const { batchId: paramBatchId } = useParams<{ batchId?: string }>()
  const navigate = useNavigate()

  const [searchInput, setSearchInput] = useState(paramBatchId || '')
  const [batchId, setBatchId]         = useState(paramBatchId || '')
  const [trace, setTrace]             = useState<TraceResult | null>(null)
  const [recall, setRecall]           = useState<RecallResult | null>(null)
  const [loading, setLoading]         = useState(false)
  const [recallLoading, setRecallLoading] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [showRecall, setShowRecall]   = useState(false)

  useEffect(() => {
    if (paramBatchId) {
      setSearchInput(paramBatchId)
      setBatchId(paramBatchId)
    }
  }, [paramBatchId])

  useEffect(() => {
    if (!batchId) return
    setLoading(true)
    setError(null)
    setTrace(null)
    setRecall(null)
    setShowRecall(false)
    fetchTrace(batchId)
      .then(setTrace)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [batchId])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchInput.trim()
    if (!q) return
    if (q !== batchId) {
      navigate(`/office/traceability/${encodeURIComponent(q)}`)
      setBatchId(q)
    }
  }

  async function handleRecall() {
    if (!batchId) return
    setRecallLoading(true)
    try {
      const r = await fetchRecall(batchId)
      setRecall(r)
      setShowRecall(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRecallLoading(false)
    }
  }

  const rb       = trace?.rawBatch
  const sup      = trace?.supplier
  const inv      = trace?.invoice
  const entries  = trace?.deboningEntries || []
  const lots     = trace?.meatLots || []
  const orders   = trace?.mixingOrders || []
  const seasoned = trace?.seasonedMeat || []
  const finished = trace?.finishedGoods || []
  const events   = trace?.events || []
  const byprods  = trace?.byproducts || []

  return (
    <div className="animate-fade-in">
      {/* ── SEARCH BAR ─────────────────────────────────────────── */}
      <div className="mb-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Nr partii (R171, M171, PW-2024-001…)"
              className="w-full h-9 bg-surface-3 border border-surface-4 rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-ink-5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-colors"
            />
          </div>
          <button
            type="submit"
            className="h-9 px-4 bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Search size={13} /> Szukaj
          </button>
        </form>
      </div>

      {/* ── LOADING ─────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-3">
          <div className="bg-surface border border-surface-4 rounded-xl p-5">
            <div className="space-y-3">
              <Skeleton className="h-7 w-48" />
              <div className="grid grid-cols-4 gap-3">
                {[0,1,2,3].map(i => <Skeleton key={i} className="h-14" />)}
              </div>
            </div>
          </div>
          {[0,1,2].map(i => (
            <div key={i} className="bg-surface border border-surface-4 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface border-b border-surface-4">
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="p-4 space-y-2">
                {[0,1,2].map(j => <Skeleton key={j} className="h-4 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ERROR ──────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 mb-4">
          <AlertTriangle size={15} className="inline mr-2" />
          {error}
        </div>
      )}

      {/* ── EMPTY STATE ────────────────────────────────────────── */}
      {!loading && !trace && !error && (
        <div className="text-center py-20 text-ink-4">
          <Search size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium text-ink-3">Wpisz numer partii aby wyświetlić traceability</p>
          <p className="text-xs mt-1">Przykłady: R171 · M171 · PW-2024-001 · P5</p>
        </div>
      )}

      {trace && !loading && (
        <>
          {/* ── 1. HEADER ────────────────────────────────────── */}
          <div className="bg-surface border border-surface-4 rounded-xl p-5 mb-4 flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h1 className="text-xl font-bold text-ink">{batchId}</h1>
                <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', entityBadgeClass(trace.entityType))}>
                  {entityLabel(trace.entityType)}
                </span>
                {rb?.status && (
                  <span className="text-xs bg-surface-4 text-ink-3 px-2 py-0.5 rounded-full">
                    {rb.status}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-surface-3 border border-surface-4 rounded-lg p-2.5 text-center">
                  <div className="text-[10px] text-ink-4 uppercase tracking-wider mb-1">Partia surowca</div>
                  <div className="text-sm font-bold text-brand">{rb?.internal_batch_no || '—'}</div>
                </div>
                <div className="bg-surface-3 border border-surface-4 rounded-lg p-2.5 text-center">
                  <div className="text-[10px] text-ink-4 uppercase tracking-wider mb-1">Dostawca</div>
                  <div className="text-sm font-bold text-ink">{rb?.supplier_name || sup?.name || '—'}</div>
                </div>
                <div className="bg-surface-3 border border-surface-4 rounded-lg p-2.5 text-center">
                  <div className="text-[10px] text-ink-4 uppercase tracking-wider mb-1">Masa przyjęta</div>
                  <div className="text-sm font-bold text-ink">{fmtKg(rb?.kg_received)}</div>
                </div>
                <div className="bg-surface-3 border border-surface-4 rounded-lg p-2.5 text-center">
                  <div className="text-[10px] text-ink-4 uppercase tracking-wider mb-1">Data uboju</div>
                  <div className="text-sm font-bold text-ink">{fmtDate(rb?.slaughter_date)}</div>
                </div>
              </div>
            </div>
            <button
              onClick={handleRecall}
              disabled={recallLoading}
              className="bg-danger hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 shrink-0 disabled:opacity-50 transition-colors"
            >
              {recallLoading
                ? <RefreshCw size={13} className="animate-spin" />
                : <AlertTriangle size={13} />}
              Recall
            </button>
          </div>

          {/* ── RECALL RESULT ────────────────────────────────── */}
          {showRecall && recall && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 mb-4">
              <h2 className="text-red-400 font-bold text-base mb-3 flex items-center gap-2">
                <AlertTriangle size={16} /> Symulacja Recall — {batchId}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {Object.entries(recall.summary || {}).map(([k, v]) => (
                  <div key={k} className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-center">
                    <div className="text-[10px] text-red-400 uppercase tracking-wider mb-1">{k}</div>
                    <div className="text-sm font-bold text-ink">{String(v)}</div>
                  </div>
                ))}
              </div>
              {(recall.affectedFinishedGoods?.length || 0) > 0 && (
                <div>
                  <div className="text-sm text-red-400 font-semibold mb-2">
                    Wyroby gotowe do wycofania ({recall.affectedFinishedGoods!.length}):
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-red-400/70">
                          <th className="text-left py-1.5 pr-3">Nr partii</th>
                          <th className="text-left py-1.5 pr-3">Receptura</th>
                          <th className="text-right py-1.5 pr-3">Ilość</th>
                          <th className="text-right py-1.5 pr-3">Kg</th>
                          <th className="text-left py-1.5">Data prod.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recall.affectedFinishedGoods!.map((fg: any, i: number) => (
                          <tr key={fg.id || i} className="text-ink-2 border-t border-red-500/20">
                            <td className="py-1.5 pr-3 font-mono">{fg.batch_no}</td>
                            <td className="py-1.5 pr-3">{fg.recipe_name}</td>
                            <td className="py-1.5 pr-3 text-right">{fg.qty_available} szt.</td>
                            <td className="py-1.5 pr-3 text-right">{fmtKg(fg.total_kg)}</td>
                            <td className="py-1.5">{fmtDate(fg.produced_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 2. BACKWARD TRACEABILITY ────────────────────── */}
          <SectionCard title="Źródło (Backward Traceability)" icon={<Truck size={14} />}>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-[10px] text-ink-4 font-semibold uppercase tracking-wider mb-2">Dostawca</div>
                <div className="space-y-1">
                  <KV label="Nazwa"          value={fmt(rb?.supplier_name || sup?.name)} />
                  <KV label="NIP"            value={fmt(sup?.nip)} />
                  <KV label="Nr wet."        value={fmt(sup?.vet_number)} />
                  <KV label="Kontakt"        value={fmt(sup?.contact_name)} />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-ink-4 font-semibold uppercase tracking-wider mb-2">Faktura / Dostawa</div>
                <div className="space-y-1">
                  <KV label="Nr faktury"     value={fmt(rb?.invoice_no || inv?.invoice_no)} />
                  <KV label="Nr partii dost." value={fmt(rb?.supplier_batch_no)} />
                  <KV label="Data uboju"     value={fmtDate(rb?.slaughter_date)} />
                  <KV label="Data przyjęcia" value={fmtDate(rb?.received_date)} />
                  <KV label="Data ważności"  value={fmtDate(rb?.expiry_date)} />
                  <KV label="Masa przyjęta"  value={fmtKg(rb?.kg_received)} />
                  <KV label="Cena/kg"        value={rb?.price_per_kg ? `${rb.price_per_kg} PLN` : '—'} />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* ── 3. PROCESS FLOW ─────────────────────────────── */}
          <SectionCard title="Przepływ procesu (Process Flow)" icon={<Tag size={14} />}>
            <div className="max-w-lg">
              {/* RAW BATCH */}
              <div className="border border-blue-500/30 rounded-lg bg-blue-500/10 p-3 mb-1">
                <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm mb-1">
                  <Package size={14} /> Partia surowca
                </div>
                <div className="text-xs text-ink-2">
                  {rb?.internal_batch_no} · {fmtKg(rb?.kg_received)} · {fmtDate(rb?.received_date)}
                </div>
              </div>

              <FlowArrow />

              {/* DEBONING */}
              <FlowNode label="Wpisy rozbioru" icon={<Beef size={12} />} items={entries} emptyText="Brak wpisów rozbioru" />
              {entries.length > 0 && (
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-ink-4">
                        <th className="text-left py-1.5 pr-3">Sesja</th>
                        <th className="text-left py-1.5 pr-3">Pracownik</th>
                        <th className="text-right py-1.5 pr-3">Kg pobrane</th>
                        <th className="text-right py-1.5 pr-3">Kg mięso</th>
                        <th className="text-right py-1.5 pr-3">Yield%</th>
                        <th className="text-left py-1.5">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e: any, i) => (
                        <tr key={e.id || i} className="text-ink-2 border-t border-surface-4">
                          <td className="py-1.5 pr-3 font-mono">{e.sessionNo || e.sessionId?.substring(0, 8)}</td>
                          <td className="py-1.5 pr-3">{e.workerName}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtKg(e.kgTaken)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtKg(e.kgMeat)}</td>
                          <td className="py-1.5 pr-3 text-right">{e.yieldPct}%</td>
                          <td className="py-1.5 text-ink-4">{fmtDate(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <FlowArrow />

              {/* MEAT LOTS */}
              <div className="border border-orange-500/30 rounded-lg bg-orange-500/10 p-3">
                <div className="flex items-center gap-2 text-orange-400 font-semibold text-sm mb-1">
                  <Beef size={14} /> Partie mięsa (Meat Lots)
                </div>
                {lots.length === 0
                  ? <div className="text-xs text-ink-4">Brak partii mięsa</div>
                  : lots.map((m: any, i) => (
                    <div key={m.id || i} className="text-xs text-ink-2">
                      {m.lot_no} · dostępne: {fmtKg(m.kg_available)} · status: {m.status}
                    </div>
                  ))}
              </div>

              <FlowArrow />

              {/* MIXING ORDERS */}
              <FlowNode label="Zlecenia masowania" icon={<FlaskConical size={12} />} items={orders} emptyText="Brak zleceń masowania" />
              {orders.length > 0 && (
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-ink-4">
                        <th className="text-left py-1.5 pr-3">Nr zlecenia</th>
                        <th className="text-left py-1.5 pr-3">Receptura</th>
                        <th className="text-right py-1.5 pr-3">Mięso kg</th>
                        <th className="text-right py-1.5 pr-3">Wyjście kg</th>
                        <th className="text-left py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o: any, i) => (
                        <tr key={o.id || i} className="text-ink-2 border-t border-surface-4">
                          <td className="py-1.5 pr-3 font-mono">{o.orderNo}</td>
                          <td className="py-1.5 pr-3">{o.recipeName}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtKg(o.meatKg)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtKg(o.plannedOutputKg)}</td>
                          <td className="py-1.5">{o.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <FlowArrow />

              {/* SEASONED MEAT */}
              <div className="border border-amber-500/30 rounded-lg bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm mb-1">
                  <FlaskConical size={14} /> Mięso przyprawione
                </div>
                {seasoned.length === 0
                  ? <div className="text-xs text-ink-4">Brak partii mięsa przyprawionego</div>
                  : seasoned.map((sm: any, i) => (
                    <div key={sm.id || i} className="text-xs text-ink-2">
                      {sm.batch_no} · {fmtKg(sm.kg_produced)} · ważne do: {fmtDate(sm.expiry_date)}
                    </div>
                  ))}
              </div>

              <FlowArrow />

              {/* FINISHED GOODS */}
              <div className="border border-green-500/30 rounded-lg bg-green-500/10 p-3">
                <div className="flex items-center gap-2 text-green-400 font-semibold text-sm mb-1">
                  <ShoppingBag size={14} /> Wyroby gotowe
                </div>
                {finished.length === 0
                  ? <div className="text-xs text-ink-4">Brak wyrobów gotowych</div>
                  : finished.map((fg: any, i) => (
                    <div key={fg.id || i} className="text-xs text-ink-2">
                      {fg.batch_no} · {fg.recipe_name} · {fg.qty} szt. · {fmtKg(fg.total_kg)}
                    </div>
                  ))}
              </div>
            </div>
          </SectionCard>

          {/* ── 4. FORWARD TRACEABILITY ─────────────────────── */}
          <SectionCard title="Produkty końcowe (Forward Traceability)" icon={<ShoppingBag size={14} />} count={finished.length}>
            {finished.length === 0 ? (
              <div className="text-ink-4 text-sm italic">Brak wyrobów gotowych z tej partii</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-ink-4 text-xs">
                      <th className="text-left py-1.5 pr-4">Nr partii</th>
                      <th className="text-left py-1.5 pr-4">Receptura / Produkt</th>
                      <th className="text-left py-1.5 pr-4">Klient</th>
                      <th className="text-right py-1.5 pr-4">Ilość</th>
                      <th className="text-right py-1.5 pr-4">Kg</th>
                      <th className="text-right py-1.5 pr-4">Dostępne</th>
                      <th className="text-left py-1.5">Data prod.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finished.map((fg: any, i) => (
                      <tr key={fg.id || i} className="border-t border-surface-4 text-ink-2">
                        <td className="py-2 pr-4 font-mono text-green-400 text-xs">{fg.batch_no}</td>
                        <td className="py-2 pr-4">
                          <div>{fg.recipe_name}</div>
                          <div className="text-xs text-ink-4">{fg.product_type_name}</div>
                        </td>
                        <td className="py-2 pr-4 text-sm">{fg.client_name || '—'}</td>
                        <td className="py-2 pr-4 text-right">{fg.qty} szt.</td>
                        <td className="py-2 pr-4 text-right">{fmtKg(fg.total_kg)}</td>
                        <td className="py-2 pr-4 text-right text-green-400">{fg.qty_available} szt.</td>
                        <td className="py-2 text-xs text-ink-4">{fmtDate(fg.produced_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ── 5. BYPRODUCTS ───────────────────────────────── */}
          {byprods.length > 0 && (
            <SectionCard title="Produkty uboczne (kości / grzbiety)" icon={<Tag size={14} />} count={byprods.length} defaultOpen={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-ink-4 text-xs">
                      <th className="text-left py-1.5 pr-4">Typ</th>
                      <th className="text-right py-1.5 pr-4">Masa</th>
                      <th className="text-left py-1.5">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byprods.map((bp: any, i) => (
                      <tr key={bp.id || i} className="border-t border-surface-4 text-ink-2">
                        <td className="py-1.5 pr-4">
                          <span className={cn(
                            'text-xs px-2 py-0.5 rounded-full font-semibold ring-1',
                            bp.type === 'BONES'
                              ? 'bg-surface-4 text-ink-3 ring-surface-5'
                              : 'bg-amber-500/15 text-amber-400 ring-amber-500/25'
                          )}>
                            {bp.type === 'BONES' ? 'Kości' : 'Grzbiety'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-right">{fmtKg(bp.weight)}</td>
                        <td className="py-1.5 text-xs text-ink-4">{fmtDate(bp.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* ── 6. EVENT HISTORY ────────────────────────────── */}
          <SectionCard title="Historia zdarzeń (Event Log)" icon={<Clock size={14} />} count={events.length} defaultOpen={false}>
            {events.length === 0 ? (
              <div className="text-ink-4 text-sm italic">Brak zdarzeń w logu</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-ink-4">
                      <th className="text-left py-1.5 pr-4">Czas</th>
                      <th className="text-left py-1.5 pr-4">Akcja</th>
                      <th className="text-left py-1.5 pr-4">Typ</th>
                      <th className="text-left py-1.5 pr-4">ID</th>
                      <th className="text-left py-1.5">Szczegóły</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev: any, i) => (
                      <tr key={ev.id || i} className="border-t border-surface-4 text-ink-2">
                        <td className="py-1.5 pr-4 whitespace-nowrap text-ink-4">
                          {String(ev.created_at || ev.timestamp || '').substring(0, 19).replace('T', ' ')}
                        </td>
                        <td className="py-1.5 pr-4">
                          <span className={cn('px-1.5 py-0.5 rounded text-xs font-semibold ring-1', {
                            'bg-green-500/15 text-green-400 ring-green-500/25':   ev.action === 'CREATE',
                            'bg-blue-500/15 text-blue-400 ring-blue-500/25':     ev.action === 'UPDATE',
                            'bg-orange-500/15 text-orange-400 ring-orange-500/25': ev.action === 'CONSUME',
                            'bg-surface-4 text-ink-3 ring-surface-5': !['CREATE','UPDATE','CONSUME'].includes(ev.action),
                          })}>
                            {ev.action}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4">{ev.entity_type}</td>
                        <td className="py-1.5 pr-4 font-mono text-ink-4 text-xs">
                          {String(ev.entity_id).substring(0, 12)}…
                        </td>
                        <td className="py-1.5 text-ink-4 max-w-xs truncate">
                          {typeof ev.metadata === 'object'
                            ? JSON.stringify(ev.metadata).substring(0, 80)
                            : String(ev.metadata || '').substring(0, 80)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
