/**
 * TracePage — Śledzenie surowca
 *
 * Wpisz dowolny numer partii (surowiec, lot, mięso przyprawione, wyrób,
 * QR sztuki) → pełne drzewo przepływu w przód i w tył:
 * przyjęcie → rozbiór → masowanie → mięso przyprawione → wyrób gotowy.
 * Każdy etap ma przyciski druku dokumentów (faktura, raport partii,
 * zamówienie, HDI, WZ, CMR, etykiety). Wycofanie partii (recall) jest
 * akcją dostępną z tego panelu — nie osobnym ekranem w menu.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Beef, ChevronDown, ChevronRight, FileText, FlaskConical,
  Loader2, Package, Printer, Scissors, Search, ShoppingBag,
} from 'lucide-react'
import { cn, fmtKg, fmtDatePl } from '@/lib/utils'
import { traceApi } from '@/lib/api'
import { useClientNames } from '@/lib/clientNames'

interface TraceDoc {
  kind:   string
  label:  string
  number: string
  refId?: string
  refNo?: string
  date?:  string
}

interface TraceNode {
  type:      'raw'|'deboning'|'mixing'|'seasoned'|'finished'
  id:        string
  batchNo:   string
  title:     string
  subtitle:  string
  date:      string
  kg:        number | null
  qty:       number | null
  highlight: boolean
  docs:      TraceDoc[]
  children:  TraceNode[]
}

interface TraceTree {
  query:       string
  ambiguous:   boolean
  candidates:  { stage: string; number: string; type: string }[]
  roots:       TraceNode[]
  summary: {
    totalKg: number; totalUnits: number
    rawBatches: number; deboning: number; mixing: number
    seasoned: number; finished: number
    suppliers: string[]
    clients: { clientName: string; clientOrderNo?: string; qty: number; totalKg: number }[]
  }
  byproducts: any[]
}

// ─── Konfiguracja etapów ──────────────────────────────────────
const STAGE: Record<TraceNode['type'], {
  icon: React.ReactNode; chip: string; iconBg: string; line: string
}> = {
  raw:      { icon: <Package size={15}/>,      chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', iconBg: 'bg-emerald-100 text-emerald-700', line: 'border-emerald-200' },
  deboning: { icon: <Scissors size={15}/>,     chip: 'bg-orange-50 text-orange-700 border-orange-200',    iconBg: 'bg-orange-100 text-orange-700',   line: 'border-orange-200' },
  mixing:   { icon: <FlaskConical size={15}/>, chip: 'bg-sky-50 text-sky-700 border-sky-200',             iconBg: 'bg-sky-100 text-sky-700',         line: 'border-sky-200' },
  seasoned: { icon: <Beef size={15}/>,         chip: 'bg-violet-50 text-violet-700 border-violet-200',    iconBg: 'bg-violet-100 text-violet-700',   line: 'border-violet-200' },
  finished: { icon: <ShoppingBag size={15}/>,  chip: 'bg-green-50 text-green-700 border-green-200',       iconBg: 'bg-green-100 text-green-700',     line: 'border-green-200' },
}

function docHref(d: TraceDoc): string | null {
  switch (d.kind) {
    case 'order':        return d.refId ? `/office/zamowienia/${d.refId}/druk` : null
    case 'hdi':          return d.refId ? `/office/hdi/${d.refId}/druk` : null
    case 'wz':           return d.refId ? `/office/wz/${d.refId}/druk` : null
    case 'cmr':          return d.refId ? `/office/cmr/${d.refId}/druk` : null
    case 'labels':       return d.refId ? `/etykiety/druk?planLineId=${d.refId}` : null
    case 'batch_report': return d.refNo ? `/office/partia/${encodeURIComponent(d.refNo)}/raport` : null
    default:             return null
  }
}

// ─── Węzeł drzewa ─────────────────────────────────────────────
function TreeNodeView({ node, depth }: { node: TraceNode; depth: number }) {
  const [open, setOpen] = useState(true)
  const clientDisplay = useClientNames()
  const cfg = STAGE[node.type] ?? STAGE.raw
  const hasKids = node.children.length > 0

  return (
    <div className={cn(depth > 0 && `pl-5 ml-4 border-l-2 ${cfg.line}`)}>
      <div className={cn(
        'relative rounded-xl border p-3 bg-white shadow-card mb-2',
        node.highlight ? 'border-amber-400 ring-2 ring-amber-300/60 bg-amber-50/60' : 'border-surface-4',
      )}>
        <div className="flex items-start gap-3">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', cfg.iconBg)}>
            {cfg.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border', cfg.chip)}>
                {node.title}
              </span>
              {node.batchNo && (
                <span className="font-mono font-black text-sm text-ink">{node.batchNo}</span>
              )}
              {node.highlight && (
                <span className="text-[10px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded">
                  SZUKANA PARTIA
                </span>
              )}
            </div>
            <div className="text-xs text-ink-3 mt-0.5 truncate">
              {node.type === 'finished' && node.subtitle
                ? clientDisplay(node.subtitle.split(' · ')[0]) + (node.subtitle.includes(' · ') ? ' · ' + node.subtitle.split(' · ').slice(1).join(' · ') : '')
                : node.subtitle || '—'}
            </div>
            {/* Dokumenty etapu */}
            {node.docs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {node.docs.map((d, i) => {
                  const href = docHref(d)
                  const label = `${d.label}${d.number ? ` ${d.number}` : ''}`
                  return href ? (
                    <button key={i}
                      onClick={() => window.open(href, '_blank')}
                      title={`Drukuj: ${label}`}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-surface-2 border border-surface-4 text-ink-2 hover:border-brand hover:text-brand transition-colors">
                      <Printer size={10}/>{label}
                    </button>
                  ) : (
                    <span key={i}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-surface-2 border border-surface-3 text-ink-3">
                      <FileText size={10}/>{label}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          {/* Liczby po prawej */}
          <div className="text-right flex-shrink-0">
            {node.kg !== null && node.kg > 0 && (
              <div className="text-sm font-black text-ink tabular-nums">{fmtKg(node.kg, 0)} kg</div>
            )}
            {node.qty !== null && node.qty > 0 && (
              <div className="text-[11px] font-bold text-ink-2 tabular-nums">{node.qty} szt</div>
            )}
            {node.date && (
              <div className="text-[10px] text-ink-3 mt-0.5">{fmtDatePl(node.date.slice(0, 10))}</div>
            )}
          </div>
          {hasKids && (
            <button onClick={() => setOpen(o => !o)}
              className="w-6 h-6 rounded flex items-center justify-center text-ink-3 hover:bg-surface-2 flex-shrink-0">
              {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            </button>
          )}
        </div>
      </div>
      {hasKids && open && (
        <div>
          {node.children.map((c, i) => (
            <TreeNodeView key={`${c.type}-${c.id}-${i}`} node={c} depth={depth + 1}/>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Strona ───────────────────────────────────────────────────
export function TracePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [query,   setQuery]   = useState(searchParams.get('batch') ?? '')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<TraceTree | null>(null)
  const [error,   setError]   = useState('')

  async function handleSearch(q?: string) {
    const term = (q ?? query).trim()
    if (!term) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await traceApi.tree(term)
      setResult(r)
      if ((r?.roots ?? []).length === 0) {
        setError(`Nie znaleziono partii „${term}" na żadnym etapie produkcji`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wyszukiwania')
    } finally {
      setLoading(false)
    }
  }

  // Prefill z parametru ?batch= (np. powrót z innego ekranu)
  useEffect(() => {
    const b = searchParams.get('batch')
    if (b) handleSearch(b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const s = result?.summary

  return (
    <div className="space-y-4 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-xl font-black text-ink">Śledzenie surowca</h1>
        <p className="text-sm text-ink-3">
          Wpisz numer partii (surowiec, lot, mięso przyprawione, wyrób, QR sztuki) —
          zobaczysz pełne drzewo: skąd się wzięła i gdzie poszła.
        </p>
      </div>

      {/* Wyszukiwarka */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"/>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Numer partii, np. 349, PP1, PM1, 110626 349…"
            className="w-full h-10 pl-9 pr-3 text-sm font-mono border border-surface-4 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>
        <button onClick={() => handleSearch()} disabled={loading || !query.trim()}
          className="h-10 px-4 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2">
          {loading ? <Loader2 size={14} className="animate-spin"/> : <Search size={14}/>}
          Śledź
        </button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg flex items-center gap-2">
          <AlertTriangle size={14}/>{error}
        </div>
      )}

      {/* Niejednoznaczny numer — pokaż, do których etapów pasuje */}
      {result?.ambiguous && (result.candidates ?? []).length > 0 && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg">
          <strong>Uwaga:</strong> numer „{result.query}" pasuje do kilku etapów:{' '}
          {result.candidates.map((c, i) => (
            <span key={i} className="font-semibold">
              {i > 0 && ' · '}{c.stage}
            </span>
          ))}
          {' '}— drzewo pokazuje wszystkie dopasowania.
        </div>
      )}

      {/* Podsumowanie */}
      {result && s && (result.roots ?? []).length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Przyjęcia',  val: s.rawBatches },
              { label: 'Rozbiory',   val: s.deboning },
              { label: 'Masowania',  val: s.mixing },
              { label: 'Partie mięsa', val: s.seasoned },
              { label: 'Wyroby',     val: s.finished },
            ].filter(x => x.val > 0).map(x => (
              <span key={x.label} className="text-[11px] font-semibold bg-white border border-surface-4 rounded-lg px-2.5 py-1.5 text-ink-2">
                {x.label}: <strong className="text-ink">{x.val}</strong>
              </span>
            ))}
            {s.totalKg > 0 && (
              <span className="text-[11px] font-semibold bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 text-blue-700">
                Wyprodukowano: <strong>{fmtKg(s.totalKg, 0)} kg · {s.totalUnits} szt</strong>
              </span>
            )}
          </div>

          {/* Drzewo */}
          <div className="bg-surface-2/40 border border-surface-3 rounded-2xl p-4">
            {result.roots.map((n, i) => (
              <TreeNodeView key={`${n.type}-${n.id}-${i}`} node={n} depth={0}/>
            ))}
          </div>

          {/* Wycofanie — akcja awaryjna na końcu panelu */}
          <div className="flex items-center justify-between bg-red-50/60 border border-red-200 rounded-xl px-4 py-3">
            <div className="text-xs text-red-800">
              <strong>Wycofanie partii (recall)</strong> — pełny raport: dotknięci klienci,
              produkty uboczne, oś czasu. Używaj tylko, gdy partia faktycznie wymaga wycofania.
            </div>
            <button
              onClick={() => navigate(`/office/recall?batch=${encodeURIComponent(result.query)}`)}
              className="flex-shrink-0 ml-3 h-9 px-3 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-bold hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors flex items-center gap-1.5">
              <AlertTriangle size={13}/>Wycofanie partii
            </button>
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center gap-2 py-14 text-ink-3 bg-white border border-surface-4 rounded-2xl">
          <Search size={32}/>
          <div className="font-semibold text-ink-2">Wpisz numer partii, aby zobaczyć drzewo przepływu</div>
          <div className="text-xs">przyjęcie → rozbiór → masowanie → mięso przyprawione → wyrób gotowy</div>
        </div>
      )}
    </div>
  )
}
