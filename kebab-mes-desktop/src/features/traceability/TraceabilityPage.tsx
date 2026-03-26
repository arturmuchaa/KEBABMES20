/**
 * TraceabilityPage — desktop-native batch tracing.
 * Shows full chain: RAW → DEBONING → MEAT LOT → MIXING → SEASONED → FINISHED
 * with a searchable batch picker on the left and detail tree on the right.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, GitBranch, Package, Beef, FlaskConical, ShoppingBag,
  ChevronRight, ChevronDown, AlertTriangle, RefreshCw,
  Truck, FileText, Scale, Clock,
} from 'lucide-react'
import { fetchTraceability, fetchRecall, fetchAllRawBatches } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SkeletonTable } from '@/components/ui/skeleton'
import { cn, fmtKg, fmtDate, fmtDatetime } from '@/lib/utils'
import { toast } from '@/components/ui/toast-utils'

// ─── Types ────────────────────────────────────────────────────

interface TraceResult {
  batchId: string
  entityType: string
  rawBatch?: Record<string, any>
  supplier?: Record<string, any>
  invoice?: Record<string, any>
  deboningEntries?: any[]
  byproducts?: any[]
  meatLots?: any[]
  mixingOrders?: any[]
  seasonedMeat?: any[]
  finishedGoods?: any[]
  events?: any[]
}

// ─── Main ─────────────────────────────────────────────────────

export function TraceabilityPage() {
  const [query,      setQuery]      = useState('')
  const [batchId,    setBatchId]    = useState<string | null>(null)
  const [showRecall, setShowRecall] = useState(false)

  // All batches for quick picker
  const { data: allBatches = [], isLoading: loadBatches } = useQuery({
    queryKey: ['raw-batches-all'],
    queryFn:  fetchAllRawBatches,
    staleTime: 30_000,
  })

  // Traceability chain
  const {
    data: trace,
    isLoading: loadTrace,
    error: traceError,
    isFetching,
  } = useQuery({
    queryKey: ['trace', batchId],
    queryFn:  () => fetchTraceability(batchId!) as unknown as Promise<TraceResult>,
    enabled:  !!batchId,
    retry:    false,
  })

  // Recall
  const { data: recall, isLoading: loadRecall } = useQuery({
    queryKey: ['recall', batchId],
    queryFn:  () => fetchRecall(batchId!),
    enabled:  !!batchId && showRecall,
  })

  // Filtered batch list
  const filtered = allBatches.filter(b =>
    b.internal_batch_no.toLowerCase().includes(query.toLowerCase()) ||
    b.supplier_name?.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 30)

  function selectBatch(id: string) {
    setBatchId(id)
    setShowRecall(false)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) setBatchId(query.trim())
  }

  return (
    <div className="flex h-full gap-4 -m-6 p-6 overflow-hidden">
      {/* ── LEFT: batch picker ─────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Szukaj partii…"
              className="w-full h-9 pl-8 pr-3 bg-mes-elevated border border-mes-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-mes-accent"
            />
          </div>
          <Button type="submit" size="icon" variant="outline">
            <Search size={13} />
          </Button>
        </form>

        <div className="flex-1 overflow-y-auto space-y-1">
          {loadBatches
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-mes-elevated animate-pulse" />
              ))
            : filtered.map(b => (
                <button
                  key={b.id}
                  onClick={() => selectBatch(b.internal_batch_no)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-all',
                    batchId === b.internal_batch_no
                      ? 'bg-mes-accent/10 border-mes-accent/30 text-white'
                      : 'bg-mes-surface border-mes-border hover:bg-mes-elevated text-slate-300'
                  )}
                >
                  <div className="font-mono font-semibold text-mes-accent-l">
                    {b.internal_batch_no}
                  </div>
                  <div className="text-slate-500 truncate">{b.supplier_name}</div>
                  <div className="text-slate-600">{fmtDate(b.expiry_date)} · {fmtKg(b.kg_available)}</div>
                </button>
              ))
          }
        </div>
      </div>

      {/* ── RIGHT: trace view ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!batchId && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
            <GitBranch size={40} className="opacity-30" />
            <p className="text-sm">Wybierz partię z listy lub wpisz numer w polu wyszukiwania</p>
          </div>
        )}

        {batchId && loadTrace && (
          <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
            <RefreshCw size={16} className="animate-spin" /> Ładowanie łańcucha…
          </div>
        )}

        {traceError && (
          <div className="bg-red-950/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            <AlertTriangle size={14} className="inline mr-2" />
            {(traceError as any).response?.data?.detail || 'Partia nie znaleziona'}
          </div>
        )}

        {trace && !loadTrace && (
          <div className="space-y-4 animate-fade-in">
            {/* ── Header ─────────────────────────────── */}
            <div className="bg-mes-surface border border-mes-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-xl font-bold text-white font-mono">{batchId}</h1>
                    <EntityBadge type={trace.entityType} />
                    {isFetching && <RefreshCw size={12} className="animate-spin text-slate-500" />}
                  </div>
                  <p className="text-xs text-slate-500">
                    {trace.rawBatch?.supplier_name} ·
                    Data uboju: {fmtDate(trace.rawBatch?.slaughter_date)} ·
                    Ważność: {fmtDate(trace.rawBatch?.expiry_date)}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowRecall(r => !r)}
                  loading={loadRecall}
                >
                  <AlertTriangle size={13} />
                  {showRecall ? 'Ukryj Recall' : 'Symulacja Recall'}
                </Button>
              </div>

              {/* Recall panel */}
              {showRecall && recall && (
                <div className="mt-4 pt-4 border-t border-mes-border">
                  <div className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
                    Recall — zakres
                  </div>
                  <div className="grid grid-cols-4 gap-3 mb-3">
                    {Object.entries((recall as any).summary || {}).map(([k, v]) => (
                      <div key={k} className="bg-red-950/30 border border-red-800/30 rounded-lg p-2 text-center">
                        <div className="text-xs text-red-400">{k}</div>
                        <div className="text-sm font-bold text-white">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                  {((recall as any).affectedFinishedGoods?.length ?? 0) > 0 && (
                    <div className="space-y-1">
                      {((recall as any).affectedFinishedGoods as any[]).map((fg: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-xs text-slate-300 bg-red-950/20 px-3 py-2 rounded">
                          <span className="font-mono text-red-300">{fg.batch_no}</span>
                          <span className="flex-1">{fg.recipe_name}</span>
                          <span>{fg.qty_available} szt. · {fmtKg(fg.total_kg)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Process tree ───────────────────────── */}
            <div className="grid md:grid-cols-2 gap-4">
              <TraceSection
                title="Zakup / Dostawa"
                icon={<Truck size={14} />}
                color="blue"
              >
                <KV l="Dostawca"     v={trace.rawBatch?.supplier_name} />
                <KV l="Nr faktury"   v={trace.rawBatch?.invoice_no} />
                <KV l="Nr partii d." v={trace.rawBatch?.supplier_batch_no} />
                <KV l="Data uboju"   v={fmtDate(trace.rawBatch?.slaughter_date)} />
                <KV l="Przyjęto"     v={fmtDate(trace.rawBatch?.received_date)} />
                <KV l="Masa"         v={fmtKg(trace.rawBatch?.kg_received)} />
                <KV l="Cena/kg"      v={trace.rawBatch?.price_per_kg ? `${trace.rawBatch.price_per_kg} PLN` : undefined} />
              </TraceSection>

              <TraceSection
                title="Partie mięsa"
                icon={<Beef size={14} />}
                color="orange"
                count={trace.meatLots?.length}
              >
                {(trace.meatLots ?? []).map((m: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-mes-border/30 last:border-0">
                    <span className="font-mono text-orange-400">{m.lot_no}</span>
                    <span className="text-slate-300">{fmtKg(m.kg_available)}</span>
                    <span className="text-slate-500">{m.status}</span>
                  </div>
                ))}
                {!trace.meatLots?.length && <Empty />}
              </TraceSection>

              <TraceSection
                title="Rozbiór"
                icon={<Scale size={14} />}
                color="cyan"
                count={trace.deboningEntries?.length}
              >
                {(trace.deboningEntries ?? []).map((e: any, i: number) => (
                  <div key={i} className="text-xs space-y-0.5 pb-2 border-b border-mes-border/30 last:border-0 last:pb-0">
                    <div className="flex justify-between">
                      <span className="text-slate-400">{e.workerName}</span>
                      <span className="font-mono text-cyan-400">{e.sessionNo}</span>
                    </div>
                    <div className="flex gap-3 text-slate-500">
                      <span>Pobr.: {fmtKg(e.kgTaken)}</span>
                      <span>Mięso: {fmtKg(e.kgMeat)}</span>
                      <span>Yield: {e.yieldPct}%</span>
                    </div>
                  </div>
                ))}
                {!trace.deboningEntries?.length && <Empty />}
              </TraceSection>

              <TraceSection
                title="Masowanie"
                icon={<FlaskConical size={14} />}
                color="yellow"
                count={trace.mixingOrders?.length}
              >
                {(trace.mixingOrders ?? []).map((o: any, i: number) => (
                  <div key={i} className="text-xs space-y-0.5 pb-2 border-b border-mes-border/30 last:border-0">
                    <div className="flex justify-between">
                      <span className="font-mono text-yellow-400">{o.orderNo}</span>
                      <span className="text-slate-400">{o.status}</span>
                    </div>
                    <div className="text-slate-500">{o.recipeName}</div>
                    <div className="text-slate-500">Mięso: {fmtKg(o.meatKg)} · Wyjście: {fmtKg(o.plannedOutputKg)}</div>
                  </div>
                ))}
                {!trace.mixingOrders?.length && <Empty />}
              </TraceSection>

              <TraceSection
                title="Mięso przyprawione"
                icon={<FlaskConical size={14} />}
                color="amber"
                count={trace.seasonedMeat?.length}
              >
                {(trace.seasonedMeat ?? []).map((sm: any, i: number) => (
                  <div key={i} className="text-xs flex justify-between py-1 border-b border-mes-border/30 last:border-0">
                    <span className="font-mono text-amber-400">{sm.batch_no}</span>
                    <span className="text-slate-300">{fmtKg(sm.kg_produced)}</span>
                    <span className="text-slate-500">waż. {fmtDate(sm.expiry_date)}</span>
                  </div>
                ))}
                {!trace.seasonedMeat?.length && <Empty />}
              </TraceSection>

              <TraceSection
                title="Wyroby gotowe"
                icon={<ShoppingBag size={14} />}
                color="green"
                count={trace.finishedGoods?.length}
              >
                {(trace.finishedGoods ?? []).map((fg: any, i: number) => (
                  <div key={i} className="text-xs space-y-0.5 pb-2 border-b border-mes-border/30 last:border-0">
                    <div className="flex justify-between">
                      <span className="font-mono text-emerald-400">{fg.batch_no}</span>
                      <span className="text-slate-400">{fmtDate(fg.produced_date)}</span>
                    </div>
                    <div className="flex gap-3 text-slate-500">
                      <span>{fg.recipe_name}</span>
                      <span>{fg.qty} szt. · {fmtKg(fg.total_kg)}</span>
                    </div>
                  </div>
                ))}
                {!trace.finishedGoods?.length && <Empty />}
              </TraceSection>
            </div>

            {/* ── Event log ──────────────────────────── */}
            {(trace.events?.length ?? 0) > 0 && (
              <EventLog events={trace.events!} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────

const colorMap: Record<string, string> = {
  blue:   'border-blue-500/20 text-blue-400',
  orange: 'border-orange-500/20 text-orange-400',
  cyan:   'border-cyan-500/20 text-cyan-400',
  yellow: 'border-yellow-500/20 text-yellow-400',
  amber:  'border-amber-500/20 text-amber-400',
  green:  'border-emerald-500/20 text-emerald-400',
}

function TraceSection({ title, icon, color, count, children }: {
  title: string
  icon: React.ReactNode
  color: string
  count?: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const c = colorMap[color] || colorMap.blue
  return (
    <div className={cn('bg-mes-surface border rounded-xl overflow-hidden', c.split(' ')[0])}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-mes-elevated/40 transition-colors"
      >
        <span className={c.split(' ')[1]}>{icon}</span>
        <span className="font-semibold text-sm text-slate-200 flex-1 text-left">{title}</span>
        {count !== undefined && (
          <span className="text-xs text-slate-600 bg-mes-muted px-1.5 py-0.5 rounded-full">{count}</span>
        )}
        {open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

function KV({ l, v }: { l: string; v?: string | number | null }) {
  return (
    <div className="flex gap-2 text-xs py-0.5">
      <span className="text-slate-500 min-w-[120px]">{l}</span>
      <span className="text-slate-200">{v ?? '—'}</span>
    </div>
  )
}

function Empty() {
  return <p className="text-xs text-slate-600 italic py-1">Brak danych</p>
}

function EntityBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; v: 'blue' | 'cyan' | 'amber' | 'green' }> = {
    raw_batch:      { label: 'Partia surowca',      v: 'blue'  },
    meat_lot:       { label: 'Partia mięsa',         v: 'cyan'  },
    seasoned_meat:  { label: 'Mięso przyprawione',   v: 'amber' },
    finished_goods: { label: 'Wyrób gotowy',         v: 'green' },
  }
  const m = map[type]
  if (!m) return <Badge>{type}</Badge>
  return <Badge variant={m.v}>{m.label}</Badge>
}

function EventLog({ events }: { events: any[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-mes-elevated/40"
      >
        <Clock size={14} className="text-slate-500" />
        <span className="font-semibold text-sm text-slate-200 flex-1 text-left">Historia zdarzeń</span>
        <span className="text-xs text-slate-600 bg-mes-muted px-1.5 py-0.5 rounded-full">{events.length}</span>
        {open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {events.map((ev: any, i) => (
            <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-mes-border/30 last:border-0">
              <span className="text-slate-600 font-mono w-36 shrink-0">
                {fmtDatetime(ev.created_at)}
              </span>
              <ActionBadge action={ev.action} />
              <span className="text-slate-400 shrink-0">{ev.entity_type}</span>
              <span className="text-slate-600 truncate flex-1">
                {typeof ev.metadata === 'object'
                  ? JSON.stringify(ev.metadata).substring(0, 60)
                  : String(ev.metadata ?? '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const v = action === 'CREATE'  ? 'green'
    : action === 'UPDATE'  ? 'blue'
    : action === 'CONSUME' ? 'amber'
    : 'default'
  return <Badge variant={v as any} className="shrink-0">{action}</Badge>
}
