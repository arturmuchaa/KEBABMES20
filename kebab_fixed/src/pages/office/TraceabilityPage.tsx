/**
 * TraceabilityPage — pełne end-to-end traceability partii
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Search, ChevronDown, ChevronRight, Package, Beef,
  FlaskConical, ShoppingBag, Truck, AlertTriangle,
  RefreshCw, ArrowLeft, Clock, Tag,
} from 'lucide-react'
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
  batchId: string; entityType: string
  rawBatch?: Record<string, any>; supplier?: Record<string, any>; invoice?: Record<string, any>
  deboningEntries?: Record<string, any>[]; byproducts?: Record<string, any>[]
  meatLots?: Record<string, any>[]; mixingOrders?: Record<string, any>[]
  seasonedMeat?: Record<string, any>[]; finishedGoods?: Record<string, any>[]
  events?: Record<string, any>[]
}
interface RecallResult {
  batchId: string; entityType: string
  rawBatch?: Record<string, any>; supplier?: Record<string, any>
  affectedFinishedGoods?: Record<string, any>[]; affectedSeasonedMeat?: Record<string, any>[]
  summary?: Record<string, any>
}

// ─── Helpers ──────────────────────────────────────────────────
const fmt = (v: any) => (v == null || v === '') ? '—' : String(v)
const fmtKg = (v: any) => v == null ? '—' : `${Number(v).toFixed(3)} kg`
const fmtDate = (v: any) => !v ? '—' : String(v).substring(0, 10)

function entityLabel(t: string) {
  const m: Record<string, string> = {
    raw_batch: 'Partia surowca', meat_lot: 'Partia mięsa',
    seasoned_meat: 'Mięso przypr.', finished_goods: 'Wyrób gotowy',
  }
  return m[t] || t
}

function entityBadge(t: string) {
  const m: Record<string, string> = {
    raw_batch:      'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    meat_lot:       'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
    seasoned_meat:  'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200',
    finished_goods: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  }
  return m[t] || 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
}

// ─── Sub-components ───────────────────────────────────────────
function SectionCard({ title, icon, count, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; count?: number
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-surface-4 rounded-xl overflow-hidden mb-3 shadow-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface-3 hover:bg-surface-4/50 text-left transition-colors"
      >
        <span className="text-brand">{icon}</span>
        <span className="font-semibold text-ink text-sm flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-xs bg-surface-4 text-ink-3 px-2 py-0.5 rounded-full mr-2 font-medium">{count}</span>
        )}
        {open
          ? <ChevronDown size={14} className="text-ink-4" />
          : <ChevronRight size={14} className="text-ink-4" />}
      </button>
      {open && <div className="p-4 bg-white">{children}</div>}
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
  return <div className="flex items-center justify-center py-1 text-ink-4 text-lg select-none">↓</div>
}

function FlowNode({ label, icon, items, emptyText }: {
  label: string; icon: React.ReactNode; items: any[]; emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) {
    return (
      <div className="border border-surface-4 rounded-lg p-3 text-sm text-ink-4 italic bg-surface-2">
        {emptyText || `Brak danych: ${label}`}
      </div>
    )
  }
  return (
    <div className="border border-surface-4 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-3 hover:bg-surface-4/50 text-left transition-colors"
      >
        <span className="text-brand">{icon}</span>
        <span className="text-sm font-semibold text-ink flex-1">
          {label}
          <span className="ml-2 text-xs text-ink-3 font-normal">({items.length} szt.)</span>
        </span>
        {open ? <ChevronDown size={12} className="text-ink-4" /> : <ChevronRight size={12} className="text-ink-4" />}
      </button>
      {open && (
        <div className="divide-y divide-slate-100">
          {items.map((item, i) => (
            <div key={item.id || i} className="px-3 py-2 text-xs font-mono text-ink-2 bg-white">
              {JSON.stringify(item, null, 0).substring(0, 160)}…
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Table header helper ──────────────────────────────────────
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-3 bg-slate-50 border-b border-slate-200">
      {children}
    </th>
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
    if (paramBatchId) { setSearchInput(paramBatchId); setBatchId(paramBatchId) }
  }, [paramBatchId])

  useEffect(() => {
    if (!batchId) return
    setLoading(true); setError(null); setTrace(null); setRecall(null); setShowRecall(false)
    fetchTrace(batchId).then(setTrace).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [batchId])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchInput.trim()
    if (!q) return
    if (q !== batchId) { navigate(`/office/traceability/${encodeURIComponent(q)}`); setBatchId(q) }
  }

  async function handleRecall() {
    if (!batchId) return
    setRecallLoading(true)
    try { const r = await fetchRecall(batchId); setRecall(r); setShowRecall(true) }
    catch (e: any) { setError(e.message) }
    finally { setRecallLoading(false) }
  }

  const rb      = trace?.rawBatch
  const sup     = trace?.supplier
  const inv     = trace?.invoice
  const entries = trace?.deboningEntries || []
  const lots    = trace?.meatLots || []
  const orders  = trace?.mixingOrders || []
  const seasoned  = trace?.seasonedMeat || []
  const finished  = trace?.finishedGoods || []
  const events    = trace?.events || []
  const byprods   = trace?.byproducts || []

  return (
    <div className="space-y-0 animate-fade-in">

      {/* Search bar */}
      <div className="bg-white border border-surface-4 rounded-xl p-4 mb-4 shadow-card">
        <form onSubmit={handleSearch} className="flex items-center gap-3">
          <Link to="/office/dashboard" className="text-ink-4 hover:text-ink transition-colors flex-shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Nr partii (R171, M171, PW-2024-001…)"
              autoFocus
              className="w-full pl-9 pr-3 h-9 rounded-lg border border-surface-4 bg-white text-sm text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand transition-colors"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-dark transition-colors flex-shrink-0"
          >
            <Search size={13} /> Szukaj
          </button>
        </form>
        <p className="text-[11px] text-ink-4 mt-2 ml-7">
          Przykłady: <span className="font-mono">R171</span> · <span className="font-mono">M171</span> · <span className="font-mono">PW-2024-001</span> · <span className="font-mono">P5</span>
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white border border-surface-4 rounded-xl p-6 space-y-3 shadow-card">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-2 text-red-700 shadow-card">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !trace && !error && (
        <div className="bg-white border border-surface-4 rounded-xl py-20 text-center shadow-card">
          <Search size={36} className="mx-auto mb-3 text-ink-5 opacity-40" />
          <p className="text-ink-3 text-sm font-medium">Wpisz numer partii aby wyświetlić traceability</p>
          <p className="text-xs text-ink-4 mt-1">Obsługuje: partie surowca, loty mięsa, mięso przyprawione, wyroby gotowe</p>
        </div>
      )}

      {trace && !loading && (
        <>
          {/* Header */}
          <div className="bg-white border border-surface-4 rounded-xl p-5 mb-4 shadow-card">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <h1 className="text-xl font-bold text-ink">{batchId}</h1>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${entityBadge(trace.entityType)}`}>
                    {entityLabel(trace.entityType)}
                  </span>
                  {rb?.status && (
                    <span className="text-xs bg-slate-100 text-slate-600 ring-1 ring-slate-200 px-2 py-0.5 rounded-full font-medium">
                      {rb.status}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Partia surowca', value: rb?.internal_batch_no || '—', cls: 'text-brand' },
                    { label: 'Dostawca',       value: rb?.supplier_name || sup?.name || '—', cls: '' },
                    { label: 'Masa przyjęta',  value: fmtKg(rb?.kg_received), cls: '' },
                    { label: 'Data uboju',     value: fmtDate(rb?.slaughter_date), cls: '' },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="bg-surface-3 rounded-lg p-2.5 text-center border border-surface-4">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-4 mb-1">{label}</div>
                      <div className={`text-sm font-bold text-ink ${cls}`}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={handleRecall}
                disabled={recallLoading}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-danger text-white text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 flex-shrink-0"
              >
                {recallLoading ? <RefreshCw size={13} className="animate-spin" /> : <AlertTriangle size={13} />}
                Recall
              </button>
            </div>
          </div>

          {/* Recall result */}
          {showRecall && recall && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-4 shadow-card">
              <h2 className="text-red-700 font-bold text-base mb-3 flex items-center gap-2">
                <AlertTriangle size={16} /> Symulacja Recall — {batchId}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {Object.entries(recall.summary || {}).map(([k, v]) => (
                  <div key={k} className="bg-red-100/70 rounded-lg p-2.5 text-center border border-red-200">
                    <div className="text-[10px] font-semibold uppercase text-red-500 mb-1">{k}</div>
                    <div className="text-sm font-bold text-red-800">{String(v)}</div>
                  </div>
                ))}
              </div>
              {(recall.affectedFinishedGoods?.length || 0) > 0 && (
                <div>
                  <div className="text-sm text-red-700 font-semibold mb-2">
                    Wyroby gotowe do wycofania ({recall.affectedFinishedGoods!.length}):
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-red-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-red-100 border-b border-red-200">
                          {['Nr partii', 'Receptura', 'Ilość', 'Kg', 'Data prod.'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-red-600 font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {recall.affectedFinishedGoods!.map((fg: any, i: number) => (
                          <tr key={fg.id || i} className="border-t border-red-100 hover:bg-red-50/50 transition-colors">
                            <td className="px-3 py-2 font-mono text-red-700">{fg.batch_no}</td>
                            <td className="px-3 py-2 text-red-800">{fg.recipe_name}</td>
                            <td className="px-3 py-2 text-right">{fg.qty_available} szt.</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtKg(fg.total_kg)}</td>
                            <td className="px-3 py-2 text-ink-3">{fmtDate(fg.produced_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Backward traceability */}
          <SectionCard title="Źródło (Backward Traceability)" icon={<Truck size={14} />}>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-4 mb-2">Dostawca</div>
                <div className="space-y-1.5">
                  <KV label="Nazwa"   value={fmt(rb?.supplier_name || sup?.name)} />
                  <KV label="NIP"     value={fmt(sup?.nip)} />
                  <KV label="Nr wet." value={fmt(sup?.vet_number)} />
                  <KV label="Kontakt" value={fmt(sup?.contact_name)} />
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-4 mb-2">Faktura / Dostawa</div>
                <div className="space-y-1.5">
                  <KV label="Nr faktury"      value={fmt(rb?.invoice_no || inv?.invoice_no)} />
                  <KV label="Nr partii dost." value={fmt(rb?.supplier_batch_no)} />
                  <KV label="Data uboju"      value={fmtDate(rb?.slaughter_date)} />
                  <KV label="Data przyjęcia"  value={fmtDate(rb?.received_date)} />
                  <KV label="Data ważności"   value={fmtDate(rb?.expiry_date)} />
                  <KV label="Masa przyjęta"   value={fmtKg(rb?.kg_received)} />
                  <KV label="Cena/kg"         value={rb?.price_per_kg ? `${rb.price_per_kg} PLN` : '—'} />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Process flow */}
          <SectionCard title="Przepływ procesu (Process Flow)" icon={<Tag size={14} />}>
            <div className="max-w-lg">
              <div className="border border-blue-200 rounded-lg bg-blue-50 p-3 mb-1">
                <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm mb-1">
                  <Package size={13} /> Partia surowca
                </div>
                <div className="text-xs text-ink-2">{rb?.internal_batch_no} · {fmtKg(rb?.kg_received)} · {fmtDate(rb?.received_date)}</div>
              </div>
              <FlowArrow />
              <FlowNode label="Wpisy rozbioru" icon={<Beef size={12} />} items={entries} emptyText="Brak wpisów rozbioru" />
              {entries.length > 0 && (
                <div className="mt-1 overflow-x-auto rounded-lg border border-surface-4">
                  <table className="w-full text-xs">
                    <thead><tr>{['Sesja','Pracownik','Kg pobrane','Kg mięso','Yield%','Data'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
                    <tbody>
                      {entries.map((e: any, i) => (
                        <tr key={e.id || i} className="border-t border-surface-4 hover:bg-surface-2 transition-colors">
                          <td className="px-3 py-1.5 font-mono text-brand">{e.sessionNo || e.sessionId?.substring(0,8)}</td>
                          <td className="px-3 py-1.5 text-ink-2">{e.workerName}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmtKg(e.kgTaken)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmtKg(e.kgMeat)}</td>
                          <td className="px-3 py-1.5 text-right">{e.yieldPct}%</td>
                          <td className="px-3 py-1.5 text-ink-3">{fmtDate(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <FlowArrow />
              <div className="border border-orange-200 rounded-lg bg-orange-50 p-3">
                <div className="flex items-center gap-2 text-orange-700 font-semibold text-sm mb-1"><Beef size={13} /> Partie mięsa</div>
                {lots.length === 0 ? <div className="text-xs text-ink-4">Brak partii mięsa</div>
                  : lots.map((m: any, i) => <div key={m.id||i} className="text-xs text-ink-2">{m.lot_no} · {fmtKg(m.kg_available)} · {m.status}</div>)}
              </div>
              <FlowArrow />
              <FlowNode label="Zlecenia masowania" icon={<FlaskConical size={12} />} items={orders} emptyText="Brak zleceń masowania" />
              {orders.length > 0 && (
                <div className="mt-1 overflow-x-auto rounded-lg border border-surface-4">
                  <table className="w-full text-xs">
                    <thead><tr>{['Nr zlecenia','Receptura','Mięso kg','Wyjście kg','Status'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
                    <tbody>
                      {orders.map((o: any, i) => (
                        <tr key={o.id||i} className="border-t border-surface-4 hover:bg-surface-2 transition-colors">
                          <td className="px-3 py-1.5 font-mono text-brand">{o.orderNo}</td>
                          <td className="px-3 py-1.5 text-ink-2">{o.recipeName}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmtKg(o.meatKg)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmtKg(o.plannedOutputKg)}</td>
                          <td className="px-3 py-1.5">{o.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <FlowArrow />
              <div className="border border-yellow-200 rounded-lg bg-yellow-50 p-3">
                <div className="flex items-center gap-2 text-yellow-700 font-semibold text-sm mb-1"><FlaskConical size={13} /> Mięso przyprawione</div>
                {seasoned.length === 0 ? <div className="text-xs text-ink-4">Brak</div>
                  : seasoned.map((sm: any, i) => <div key={sm.id||i} className="text-xs text-ink-2">{sm.batch_no} · {fmtKg(sm.kg_produced)} · {fmtDate(sm.expiry_date)}</div>)}
              </div>
              <FlowArrow />
              <div className="border border-green-200 rounded-lg bg-green-50 p-3">
                <div className="flex items-center gap-2 text-green-700 font-semibold text-sm mb-1"><ShoppingBag size={13} /> Wyroby gotowe</div>
                {finished.length === 0 ? <div className="text-xs text-ink-4">Brak</div>
                  : finished.map((fg: any, i) => <div key={fg.id||i} className="text-xs text-ink-2">{fg.batch_no} · {fg.recipe_name} · {fg.qty} szt. · {fmtKg(fg.total_kg)}</div>)}
              </div>
            </div>
          </SectionCard>

          {/* Forward traceability */}
          <SectionCard title="Produkty końcowe (Forward Traceability)" icon={<ShoppingBag size={14} />} count={finished.length}>
            {finished.length === 0 ? (
              <div className="text-ink-4 text-sm italic">Brak wyrobów gotowych z tej partii</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-surface-4">
                <table className="w-full text-sm">
                  <thead><tr>{['Nr partii','Receptura / Produkt','Klient','Ilość','Kg','Dostępne','Data prod.'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
                  <tbody>
                    {finished.map((fg: any, i) => (
                      <tr key={fg.id||i} className="border-t border-surface-4 hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 font-mono text-green-700 text-xs">{fg.batch_no}</td>
                        <td className="px-3 py-2"><div className="font-medium text-ink text-[13px]">{fg.recipe_name}</div><div className="text-xs text-ink-3">{fg.product_type_name}</div></td>
                        <td className="px-3 py-2 text-ink-2">{fg.client_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">{fg.qty} szt.</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtKg(fg.total_kg)}</td>
                        <td className="px-3 py-2 text-right font-mono text-green-700 font-semibold">{fg.qty_available} szt.</td>
                        <td className="px-3 py-2 text-xs text-ink-3">{fmtDate(fg.produced_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Byproducts */}
          {byprods.length > 0 && (
            <SectionCard title="Produkty uboczne (kości / grzbiety)" icon={<Tag size={14} />} count={byprods.length} defaultOpen={false}>
              <div className="overflow-x-auto rounded-lg border border-surface-4">
                <table className="w-full text-sm">
                  <thead><tr>{['Typ','Masa','Data'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
                  <tbody>
                    {byprods.map((bp: any, i) => (
                      <tr key={bp.id||i} className="border-t border-surface-4 hover:bg-surface-2 transition-colors">
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ring-1 ${
                            bp.type === 'BONES' ? 'bg-slate-100 text-slate-600 ring-slate-200' : 'bg-amber-50 text-amber-700 ring-amber-200'
                          }`}>{bp.type === 'BONES' ? 'Kości' : 'Grzbiety'}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{fmtKg(bp.weight)}</td>
                        <td className="px-3 py-2 text-xs text-ink-3">{fmtDate(bp.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Event history */}
          <SectionCard title="Historia zdarzeń (Event Log)" icon={<Clock size={14} />} count={events.length} defaultOpen={false}>
            {events.length === 0 ? (
              <div className="text-ink-4 text-sm italic">Brak zdarzeń w logu</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-surface-4">
                <table className="w-full text-xs">
                  <thead><tr>{['Czas','Akcja','Typ','ID','Szczegóły'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
                  <tbody>
                    {events.map((ev: any, i) => (
                      <tr key={ev.id||i} className="border-t border-surface-4 hover:bg-surface-2 transition-colors">
                        <td className="px-3 py-1.5 whitespace-nowrap text-ink-3 font-mono">
                          {String(ev.created_at || ev.timestamp || '').substring(0,19).replace('T',' ')}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ${
                            ev.action === 'CREATE'  ? 'bg-green-50 text-green-700 ring-green-200'  :
                            ev.action === 'UPDATE'  ? 'bg-blue-50 text-blue-700 ring-blue-200'     :
                            ev.action === 'CONSUME' ? 'bg-orange-50 text-orange-700 ring-orange-200' :
                            'bg-slate-100 text-slate-600 ring-slate-200'
                          }`}>{ev.action}</span>
                        </td>
                        <td className="px-3 py-1.5 text-ink-2">{ev.entity_type}</td>
                        <td className="px-3 py-1.5 font-mono text-ink-3">{String(ev.entity_id).substring(0,12)}…</td>
                        <td className="px-3 py-1.5 text-ink-3 max-w-xs truncate">
                          {typeof ev.metadata === 'object' ? JSON.stringify(ev.metadata).substring(0,80) : String(ev.metadata||'').substring(0,80)}
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
