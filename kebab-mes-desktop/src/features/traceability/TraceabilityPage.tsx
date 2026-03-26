/**
 * TraceabilityPage — redesign spójny z dashboardem.
 * Layout: single-column, mobile-first, card-based.
 * Sekcje: wyszukiwarka → nagłówek partii → KPI row → status/FEFO →
 *          flow SUROWIEC→ROZBIÓR→PRODUKT→MAGAZYN → tabela operacji rozbiorowych.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, GitBranch, Package, Beef, FlaskConical, ShoppingBag,
  AlertTriangle, RefreshCw, Truck, Scale, ArrowRight,
  Calendar, Weight, Building2, Hash, CheckCircle2, Clock,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { fetchTraceability, fetchRecall, fetchAllRawBatches } from '@/api'
import { KpiCard } from '@/components/ui/card'
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

  const { data: allBatches = [], isLoading: loadBatches } = useQuery({
    queryKey: ['raw-batches-all'],
    queryFn:  fetchAllRawBatches,
    staleTime: 30_000,
  })

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

  const { data: recall, isLoading: loadRecall } = useQuery({
    queryKey: ['recall', batchId],
    queryFn:  () => fetchRecall(batchId!),
    enabled:  !!batchId && showRecall,
  })

  const filtered = allBatches.filter(b =>
    b.internal_batch_no.toLowerCase().includes(query.toLowerCase()) ||
    b.supplier_name?.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 40)

  function selectBatch(id: string) {
    setBatchId(id)
    setShowRecall(false)
    setQuery('')
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) setBatchId(query.trim())
  }

  // FEFO: days remaining
  function daysUntilExpiry(expiryDate?: string): number | null {
    if (!expiryDate) return null
    const diff = new Date(expiryDate).getTime() - Date.now()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const days = daysUntilExpiry(trace?.rawBatch?.expiry_date)
  const fefoStatus = days === null ? null
    : days <= 0   ? 'expired'
    : days <= 2   ? 'critical'
    : days <= 5   ? 'warning'
    : 'ok'

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">

      {/* ── Search bar ────────────────────────────────────────── */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Wpisz numer partii lub nazwę dostawcy…"
              className="w-full h-10 pl-9 pr-3 bg-mes-surface border border-mes-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-mes-accent"
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            <Search size={13} /> Szukaj
          </Button>
        </form>

        {/* Quick batch list — shows while no batch selected or typing */}
        {(query || !batchId) && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {(loadBatches ? Array.from({ length: 8 }) : filtered).map((b: any, i) =>
              loadBatches ? (
                <div key={i} className="h-14 rounded-lg bg-mes-elevated animate-pulse" />
              ) : (
                <button
                  key={b.id}
                  onClick={() => selectBatch(b.internal_batch_no)}
                  className={cn(
                    'text-left px-3 py-2 rounded-lg border text-xs transition-all',
                    batchId === b.internal_batch_no
                      ? 'bg-mes-accent/10 border-mes-accent/40 text-white'
                      : 'bg-mes-surface border-mes-border hover:border-mes-accent/30 text-slate-300'
                  )}
                >
                  <div className="font-mono font-bold text-mes-accent-l truncate">{b.internal_batch_no}</div>
                  <div className="text-slate-500 truncate text-[11px]">{b.supplier_name}</div>
                  <div className="text-slate-600 text-[10px]">{fmtDate(b.expiry_date)} · {fmtKg(b.kg_available)}</div>
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Empty state ───────────────────────────────────────── */}
      {!batchId && !query && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-4">
          <div className="p-5 bg-mes-elevated rounded-2xl">
            <GitBranch size={36} className="opacity-40" />
          </div>
          <p className="text-sm text-center">Wybierz partię z listy powyżej lub wpisz jej numer</p>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────── */}
      {batchId && loadTrace && (
        <div className="flex items-center gap-2 text-slate-500 py-16 justify-center">
          <RefreshCw size={16} className="animate-spin" /> Ładowanie łańcucha przetwarzania…
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────── */}
      {traceError && (
        <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-4 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={15} />
          {(traceError as any).response?.data?.detail || 'Partia nie znaleziona'}
        </div>
      )}

      {/* ── Trace data ────────────────────────────────────────── */}
      {trace && !loadTrace && (
        <div className="space-y-5">

          {/* ── Header card ─────────────────────────────────── */}
          <div className="bg-mes-surface border border-mes-border rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="text-2xl font-bold font-mono text-white">{batchId}</span>
                  <EntityBadge type={trace.entityType} />
                  {isFetching && <RefreshCw size={12} className="animate-spin text-slate-500" />}
                </div>
                <p className="text-sm text-slate-400">
                  {trace.rawBatch?.supplier_name}
                  {trace.rawBatch?.invoice_no && ` · Faktura: ${trace.rawBatch.invoice_no}`}
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

            {showRecall && recall && (
              <div className="mt-4 pt-4 border-t border-mes-border">
                <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-2">Zakres recall</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {Object.entries((recall as any).summary || {}).map(([k, v]) => (
                    <div key={k} className="bg-red-950/30 border border-red-800/30 rounded-lg p-2 text-center">
                      <div className="text-[10px] text-red-400">{k}</div>
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

          {/* ── KPI row ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Nr partii"
              value={trace.rawBatch?.internal_batch_no ?? batchId ?? '—'}
              sub={trace.rawBatch?.supplier_batch_no ? `Dostawca: ${trace.rawBatch.supplier_batch_no}` : undefined}
              icon={<Hash size={18} />}
              accent="blue"
            />
            <KpiCard
              label="Dostawca"
              value={trace.rawBatch?.supplier_name ?? '—'}
              sub={trace.rawBatch?.invoice_no ? `Faktura: ${trace.rawBatch.invoice_no}` : undefined}
              icon={<Building2 size={18} />}
              accent="cyan"
            />
            <KpiCard
              label="Masa"
              value={fmtKg(trace.rawBatch?.kg_received)}
              sub={`Dostępne: ${fmtKg(trace.rawBatch?.kg_available)}`}
              icon={<Weight size={18} />}
              accent="green"
            />
            <KpiCard
              label="Data uboju"
              value={fmtDate(trace.rawBatch?.slaughter_date) ?? '—'}
              sub={`Przyjęto: ${fmtDate(trace.rawBatch?.received_date)}`}
              icon={<Calendar size={18} />}
              accent="amber"
            />
          </div>

          {/* ── Status & FEFO ────────────────────────────────── */}
          <div className="bg-mes-surface border border-mes-border rounded-xl p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Status partii</h3>
            <div className="flex flex-wrap gap-3">
              {/* Status */}
              <div className="flex items-center gap-2 bg-mes-elevated rounded-lg px-3 py-2">
                <CheckCircle2 size={14} className={cn(
                  trace.rawBatch?.status === 'active' ? 'text-emerald-400' : 'text-slate-500'
                )} />
                <span className="text-xs font-semibold text-slate-300">
                  {trace.rawBatch?.status === 'active' ? 'Aktywna' :
                   trace.rawBatch?.status === 'used'   ? 'Zużyta' :
                   trace.rawBatch?.status === 'expired'? 'Przeterminowana' :
                   trace.rawBatch?.status ?? '—'}
                </span>
              </div>

              {/* FEFO */}
              {days !== null && (
                <div className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2',
                  fefoStatus === 'expired'  ? 'bg-red-950/30' :
                  fefoStatus === 'critical' ? 'bg-red-950/20' :
                  fefoStatus === 'warning'  ? 'bg-amber-950/20' :
                  'bg-mes-elevated'
                )}>
                  <Clock size={14} className={cn(
                    fefoStatus === 'expired'  ? 'text-red-400' :
                    fefoStatus === 'critical' ? 'text-red-400' :
                    fefoStatus === 'warning'  ? 'text-amber-400' :
                    'text-emerald-400'
                  )} />
                  <span className={cn(
                    'text-xs font-semibold',
                    fefoStatus === 'expired'  ? 'text-red-300' :
                    fefoStatus === 'critical' ? 'text-red-300' :
                    fefoStatus === 'warning'  ? 'text-amber-300' :
                    'text-slate-300'
                  )}>
                    FEFO: {days <= 0 ? 'Przeterminowane' : `${days} dni do ważności`}
                  </span>
                </div>
              )}

              {/* Alert FEFO */}
              {fefoStatus && fefoStatus !== 'ok' && (
                <div className="flex items-center gap-2 bg-red-950/20 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="text-red-400" />
                  <span className="text-xs text-red-300 font-medium">
                    {fefoStatus === 'expired'  ? 'Partia przeterminowana!' :
                     fefoStatus === 'critical' ? 'Pilne — zużyj w ciągu 2 dni' :
                     'Zbliża się termin ważności'}
                  </span>
                </div>
              )}

              {/* Ważność */}
              {trace.rawBatch?.expiry_date && (
                <div className="flex items-center gap-2 bg-mes-elevated rounded-lg px-3 py-2">
                  <Calendar size={13} className="text-slate-500" />
                  <span className="text-xs text-slate-400">Ważność: {fmtDate(trace.rawBatch.expiry_date)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Traceability flow ────────────────────────────── */}
          <div className="bg-mes-surface border border-mes-border rounded-xl p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Łańcuch przetwarzania</h3>
            <div className="flex items-center gap-1 flex-wrap">
              <FlowStep
                icon={<Package size={14} />}
                label="SUROWIEC"
                count={1}
                detail={fmtKg(trace.rawBatch?.kg_received)}
                active
                color="blue"
              />
              <ArrowRight size={14} className="text-slate-600 shrink-0" />
              <FlowStep
                icon={<Scale size={14} />}
                label="ROZBIÓR"
                count={trace.deboningEntries?.length ?? 0}
                detail={`${trace.meatLots?.length ?? 0} partii`}
                active={(trace.deboningEntries?.length ?? 0) > 0}
                color="cyan"
              />
              <ArrowRight size={14} className="text-slate-600 shrink-0" />
              <FlowStep
                icon={<FlaskConical size={14} />}
                label="PRODUKT"
                count={trace.mixingOrders?.length ?? 0}
                detail={`${trace.seasonedMeat?.length ?? 0} partii`}
                active={(trace.mixingOrders?.length ?? 0) > 0}
                color="amber"
              />
              <ArrowRight size={14} className="text-slate-600 shrink-0" />
              <FlowStep
                icon={<ShoppingBag size={14} />}
                label="MAGAZYN"
                count={trace.finishedGoods?.length ?? 0}
                detail={trace.finishedGoods?.reduce((s: number, g: any) => s + (g.qty ?? 0), 0) + ' szt'}
                active={(trace.finishedGoods?.length ?? 0) > 0}
                color="green"
              />
            </div>
          </div>

          {/* ── Deboning operations table ─────────────────────── */}
          {(trace.deboningEntries?.length ?? 0) > 0 && (
            <CollapsibleSection
              title="Sesje rozbiorowe"
              icon={<Scale size={14} />}
              count={trace.deboningEntries!.length}
              defaultOpen
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-mes-border">
                      {['Sesja', 'Pracownik', 'Pobrano', 'Mięso', 'Odpady', 'Yield %'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mes-border">
                    {trace.deboningEntries!.map((e: any, i: number) => (
                      <tr key={i} className="hover:bg-mes-elevated/50">
                        <td className="px-3 py-2.5 font-mono text-cyan-400">{e.sessionNo ?? `#${i+1}`}</td>
                        <td className="px-3 py-2.5 text-slate-300">{e.workerName ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(e.kgTaken)}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(e.kgMeat)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{fmtKg(e.kgWaste)}</td>
                        <td className="px-3 py-2.5">
                          <span className={cn(
                            'font-bold',
                            (e.yieldPct ?? 0) >= 75 ? 'text-emerald-400' :
                            (e.yieldPct ?? 0) >= 60 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {e.yieldPct ?? '—'}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* ── Mixing orders ─────────────────────────────────── */}
          {(trace.mixingOrders?.length ?? 0) > 0 && (
            <CollapsibleSection
              title="Zlecenia masowania"
              icon={<FlaskConical size={14} />}
              count={trace.mixingOrders!.length}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-mes-border">
                      {['Nr zlecenia', 'Receptura', 'Mięso', 'Wyjście', 'Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mes-border">
                    {trace.mixingOrders!.map((o: any, i: number) => (
                      <tr key={i} className="hover:bg-mes-elevated/50">
                        <td className="px-3 py-2.5 font-mono text-amber-400">{o.orderNo}</td>
                        <td className="px-3 py-2.5 text-slate-300">{o.recipeName}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(o.meatKg)}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(o.plannedOutputKg)}</td>
                        <td className="px-3 py-2.5">
                          <StatusPill status={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* ── Seasoned meat ─────────────────────────────────── */}
          {(trace.seasonedMeat?.length ?? 0) > 0 && (
            <CollapsibleSection
              title="Mięso przyprawione"
              icon={<FlaskConical size={14} />}
              count={trace.seasonedMeat!.length}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-mes-border">
                      {['Nr partii', 'Kg wyprod.', 'Kg dostępne', 'Ważność', 'Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mes-border">
                    {trace.seasonedMeat!.map((sm: any, i: number) => (
                      <tr key={i} className="hover:bg-mes-elevated/50">
                        <td className="px-3 py-2.5 font-mono text-amber-400">{sm.batch_no}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(sm.kg_produced)}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(sm.kg_available)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{fmtDate(sm.expiry_date)}</td>
                        <td className="px-3 py-2.5"><StatusPill status={sm.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* ── Finished goods ────────────────────────────────── */}
          {(trace.finishedGoods?.length ?? 0) > 0 && (
            <CollapsibleSection
              title="Wyroby gotowe"
              icon={<ShoppingBag size={14} />}
              count={trace.finishedGoods!.length}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-mes-border">
                      {['Nr partii', 'Receptura', 'Ilość', 'Łącznie kg', 'Data prod.'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mes-border">
                    {trace.finishedGoods!.map((fg: any, i: number) => (
                      <tr key={i} className="hover:bg-mes-elevated/50">
                        <td className="px-3 py-2.5 font-mono text-emerald-400">{fg.batch_no}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fg.recipe_name}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fg.qty} szt.</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtKg(fg.total_kg)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{fmtDate(fg.produced_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* ── Delivery info ─────────────────────────────────── */}
          <CollapsibleSection title="Szczegóły dostawy" icon={<Truck size={14} />}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3">
              <KV l="Dostawca"        v={trace.rawBatch?.supplier_name} />
              <KV l="Nr faktury"      v={trace.rawBatch?.invoice_no} />
              <KV l="Nr partii dost." v={trace.rawBatch?.supplier_batch_no} />
              <KV l="Data uboju"      v={fmtDate(trace.rawBatch?.slaughter_date)} />
              <KV l="Data przyjęcia"  v={fmtDate(trace.rawBatch?.received_date)} />
              <KV l="Masa przyjęta"   v={fmtKg(trace.rawBatch?.kg_received)} />
              {trace.rawBatch?.price_per_kg && (
                <KV l="Cena/kg" v={`${trace.rawBatch.price_per_kg} PLN`} />
              )}
            </div>
          </CollapsibleSection>

          {/* ── Event log ─────────────────────────────────────── */}
          {(trace.events?.length ?? 0) > 0 && (
            <CollapsibleSection
              title="Historia zdarzeń"
              icon={<Clock size={14} />}
              count={trace.events!.length}
            >
              <div className="space-y-1">
                {trace.events!.map((ev: any, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-mes-border/30 last:border-0">
                    <span className="text-slate-600 font-mono shrink-0 w-36">{fmtDatetime(ev.created_at)}</span>
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
            </CollapsibleSection>
          )}

        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function FlowStep({ icon, label, count, detail, active, color }: {
  icon: React.ReactNode
  label: string
  count: number
  detail?: string
  active: boolean
  color: 'blue' | 'cyan' | 'amber' | 'green'
}) {
  const colorMap = {
    blue:  { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400'   },
    cyan:  { bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30',   text: 'text-cyan-400'   },
    amber: { bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-400'  },
    green: { bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',text: 'text-emerald-400'},
  }
  const c = colorMap[color]
  return (
    <div className={cn(
      'flex flex-col items-center gap-1 px-4 py-3 rounded-xl border min-w-[90px] transition-all',
      active ? `${c.bg} ${c.border}` : 'bg-mes-elevated border-mes-border opacity-40'
    )}>
      <span className={cn('mb-0.5', active ? c.text : 'text-slate-500')}>{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <span className={cn('text-lg font-bold tabular-nums', active ? c.text : 'text-slate-600')}>{count}</span>
      {detail && <span className="text-[10px] text-slate-500">{detail}</span>}
    </div>
  )
}

function CollapsibleSection({ title, icon, count, children, defaultOpen = false }: {
  title: string
  icon: React.ReactNode
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 hover:bg-mes-elevated/40 transition-colors"
      >
        <span className="text-slate-400">{icon}</span>
        <span className="font-semibold text-sm text-slate-200 flex-1 text-left">{title}</span>
        {count !== undefined && (
          <span className="text-xs text-slate-600 bg-mes-elevated px-2 py-0.5 rounded-full">{count}</span>
        )}
        {open
          ? <ChevronDown size={13} className="text-slate-500 shrink-0" />
          : <ChevronRight size={13} className="text-slate-500 shrink-0" />
        }
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  )
}

function StatusPill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    active:    'text-emerald-400 bg-emerald-500/10',
    available: 'text-emerald-400 bg-emerald-500/10',
    done:      'text-slate-400 bg-slate-500/10',
    planned:   'text-blue-400 bg-blue-500/10',
    used:      'text-slate-500 bg-slate-500/10',
    cancelled: 'text-red-400 bg-red-500/10',
  }
  const s = status?.toLowerCase() ?? ''
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', map[s] ?? 'text-slate-400 bg-slate-500/10')}>
      {status ?? '—'}
    </span>
  )
}

function KV({ l, v }: { l: string; v?: string | number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">{l}</span>
      <span className="text-sm text-slate-300">{v ?? '—'}</span>
    </div>
  )
}

function EntityBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; v: 'blue' | 'cyan' | 'amber' | 'green' }> = {
    raw_batch:      { label: 'Partia surowca',    v: 'blue'  },
    meat_lot:       { label: 'Partia mięsa',       v: 'cyan'  },
    seasoned_meat:  { label: 'Mięso przyprawione', v: 'amber' },
    finished_goods: { label: 'Wyrób gotowy',       v: 'green' },
  }
  const m = map[type]
  if (!m) return <Badge>{type}</Badge>
  return <Badge variant={m.v}>{m.label}</Badge>
}

function ActionBadge({ action }: { action: string }) {
  const v = action === 'CREATE'  ? 'green'
    : action === 'UPDATE'  ? 'blue'
    : action === 'CONSUME' ? 'amber'
    : 'default'
  return <Badge variant={v as any} className="shrink-0 text-[10px]">{action}</Badge>
}
