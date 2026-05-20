/**
 * FinishedGoodsPage — Magazyn wyrobów gotowych.
 *
 * Widok główny: grid kart pogrupowanych po (recipe_id, kg/szt). Karta pokazuje
 * sumę szt+kg dla rodzaju produktu, badge stanu (niski/średni/wysoki) i liczbę
 * partii. Klik karty → strona szczegółów (/office/magazyn/gotowe/:groupKey)
 * z listą partii w kolejności FEFO.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { fmtKg, cn } from '@/lib/utils'
import {
  ShoppingBag, Search, Boxes, ArrowRight, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ─── Progi stanu ─────────────────────────────────────────────
// Domyślne progi szt — możliwy upgrade w przyszłości (per receptura).
const LOW_THRESHOLD  = 30
const HIGH_THRESHOLD = 100

type Level = 'empty' | 'low' | 'med' | 'high'

function levelOf(qty: number): Level {
  if (qty <= 0)               return 'empty'
  if (qty <  LOW_THRESHOLD)   return 'low'
  if (qty <  HIGH_THRESHOLD)  return 'med'
  return 'high'
}

const LEVEL_STYLE: Record<Level, { accent: string; pill: string; text: string; icon: React.ReactNode; label: string }> = {
  empty: {
    accent: 'bg-gradient-to-r from-gray-300 via-gray-400 to-gray-300',
    pill:   'bg-gray-100 text-gray-600 border-gray-300',
    text:   'text-gray-500',
    icon:   <ShoppingBag size={11} />,
    label:  'Brak',
  },
  low: {
    accent: 'bg-gradient-to-r from-red-400 via-red-500 to-red-400',
    pill:   'bg-red-50 text-red-700 border-red-200',
    text:   'text-red-700',
    icon:   <AlertTriangle size={11} />,
    label:  'Niski stan',
  },
  med: {
    accent: 'bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400',
    pill:   'bg-amber-50 text-amber-700 border-amber-200',
    text:   'text-amber-700',
    icon:   <Boxes size={11} />,
    label:  'Średni stan',
  },
  high: {
    accent: 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400',
    pill:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    text:   'text-emerald-700',
    icon:   <CheckCircle2 size={11} />,
    label:  'Wysoki stan',
  },
}

// ─── Grupowanie ──────────────────────────────────────────────
interface ProductGroup {
  groupKey:       string        // url-safe: recipeId__kgPerUnit (encoded)
  recipeId:       string
  recipeName:     string
  productTypeName:string
  kgPerUnit:      number
  totalQty:       number
  totalKg:        number
  batches:        FinishedGoodsItem[]
  oldestDate:     string        // najstarsza data produkcji w grupie (FEFO heads-up)
  clientCount:    number
}

function groupKeyOf(recipeId: string, kg: number): string {
  return encodeURIComponent(`${recipeId || '__'}__${kg}`)
}

function groupItems(items: FinishedGoodsItem[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>()
  for (const it of items) {
    const key = groupKeyOf(it.recipeId || it.recipeName, it.kgPerUnit)
    const clients = new Set<string>()
    const existing = map.get(key)
    if (existing) {
      existing.totalQty += it.qtyAvailable
      existing.totalKg  += it.qtyAvailable * it.kgPerUnit
      existing.batches.push(it)
      if (it.producedDate && (!existing.oldestDate || it.producedDate < existing.oldestDate)) {
        existing.oldestDate = it.producedDate
      }
      if (it.clientName) existing.batches.forEach(b => { if (b.clientName) clients.add(b.clientName) })
      existing.clientCount = new Set(existing.batches.map(b => b.clientName).filter(Boolean)).size
    } else {
      if (it.clientName) clients.add(it.clientName)
      map.set(key, {
        groupKey:        key,
        recipeId:        it.recipeId,
        recipeName:      it.recipeName || '—',
        productTypeName: it.productTypeName || '',
        kgPerUnit:       it.kgPerUnit,
        totalQty:        it.qtyAvailable,
        totalKg:         it.qtyAvailable * it.kgPerUnit,
        batches:         [it],
        oldestDate:      it.producedDate,
        clientCount:     clients.size,
      })
    }
  }
  // Sortuj: najpierw niski stan, potem wg kg malejąco
  return Array.from(map.values()).sort((a, b) => {
    const la = levelOf(a.totalQty)
    const lb = levelOf(b.totalQty)
    const ord: Record<Level, number> = { low: 0, med: 1, high: 2, empty: 3 }
    if (ord[la] !== ord[lb]) return ord[la] - ord[lb]
    return b.totalKg - a.totalKg
  })
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 0
  const t = Date.parse(dateStr)
  if (!t || isNaN(t)) return 0
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
}

// ─── Karta grupy ─────────────────────────────────────────────
function ProductCard({ g }: { g: ProductGroup }) {
  const level = levelOf(g.totalQty)
  const s     = LEVEL_STYLE[level]
  const days  = daysSince(g.oldestDate)

  return (
    <Link
      to={`/office/magazyn/gotowe/${g.groupKey}`}
      className="group block relative overflow-hidden rounded-2xl border border-surface-4 bg-white shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Akcent kolorowy */}
      <div className={cn('absolute top-0 inset-x-0 h-1', s.accent)} />

      <div className="p-5 pt-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold leading-tight truncate">
              {g.recipeName}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <code className="font-mono text-xs font-bold text-primary bg-primary/5 px-1.5 py-0.5 rounded">
                {g.kgPerUnit} kg
              </code>
              {g.productTypeName && g.productTypeName !== g.recipeName && (
                <CardDescription className="text-[11px] truncate">{g.productTypeName}</CardDescription>
              )}
            </div>
          </div>
          <Badge variant="outline" className={cn('text-[10px] font-medium gap-1 flex-shrink-0', s.pill)}>
            {s.icon}
            {s.label}
          </Badge>
        </div>

        {/* Główne liczby */}
        <div className="flex items-baseline gap-3 mb-3">
          <div>
            <div className={cn('font-mono text-3xl font-black tabular-nums leading-none', s.text)}>
              {g.totalQty}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-1">szt</div>
          </div>
          <div className="text-muted-foreground text-2xl leading-none">·</div>
          <div>
            <div className="font-mono text-3xl font-black tabular-nums leading-none text-ink-2">
              {fmtKg(g.totalKg, 0)}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-1">kg</div>
          </div>
        </div>

        {/* Stopka */}
        <div className="flex items-center justify-between pt-3 border-t border-surface-3">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{g.batches.length} {g.batches.length === 1 ? 'partia' : 'partii'}</span>
            {days > 0 && (
              <span className={cn(
                'tabular-nums',
                days > 7  ? 'text-red-600 font-semibold' :
                days > 3  ? 'text-amber-600 font-semibold' :
                'text-muted-foreground',
              )}>
                najstarsza: {days}d
              </span>
            )}
          </div>
          <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </Link>
  )
}

// ─── Strona ─────────────────────────────────────────────────
export function FinishedGoodsPage() {
  const { data: items, loading } = useApi(() => finishedGoodsApi.list())
  const [filter, setFilter] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)

  const rawList = items ?? []

  const allGroups = useMemo(() => groupItems(rawList), [rawList])

  const groups = useMemo(() => {
    let result = allGroups
    const q = filter.toLowerCase().trim()
    if (q) {
      result = result.filter(g =>
        (g.recipeName || '').toLowerCase().includes(q) ||
        (g.productTypeName || '').toLowerCase().includes(q) ||
        String(g.kgPerUnit).includes(q)
      )
    }
    if (onlyLow) {
      result = result.filter(g => {
        const l = levelOf(g.totalQty)
        return l === 'low' || l === 'empty'
      })
    }
    return result
  }, [allGroups, filter, onlyLow])

  const totalQty = rawList.reduce((s, i) => s + i.qtyAvailable, 0)
  const totalKg  = rawList.reduce((s, i) => s + i.qtyAvailable * i.kgPerUnit, 0)

  const lowCount = allGroups.filter(g => {
    const l = levelOf(g.totalQty)
    return l === 'low' || l === 'empty'
  }).length

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── KPI ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Rodzajów',     val: allGroups.length, accent: 'text-ink' },
          { label: 'Dostępne szt', val: totalQty,         accent: 'text-ink' },
          { label: 'Łącznie kg',   val: fmtKg(totalKg, 0), accent: 'text-ink' },
          { label: 'Niski stan',   val: lowCount,         accent: lowCount > 0 ? 'text-red-600' : 'text-emerald-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <CardDescription className="text-[10px] font-bold uppercase tracking-wider mb-2">{k.label}</CardDescription>
              <CardTitle className={cn('text-3xl font-black tabular-nums', k.accent)}>{k.val}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Filtr ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9 text-sm"
            placeholder="Szukaj: receptura, rodzaj, kg…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <button
          onClick={() => setOnlyLow(v => !v)}
          className={cn(
            'h-9 px-3 rounded-lg border text-xs font-semibold flex items-center gap-2 transition-colors',
            onlyLow
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-white text-muted-foreground border-surface-4 hover:bg-surface-2'
          )}
        >
          <AlertTriangle size={13} />
          Tylko niski stan
          {onlyLow && lowCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold tabular-nums">
              {lowCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Grid kart ──────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : rawList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <ShoppingBag size={48} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-base font-medium text-muted-foreground">Brak wyrobów gotowych</CardTitle>
            <CardDescription>Wyroby pojawią się po potwierdzeniu produkcji przez biuro.</CardDescription>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników{filter && ` dla „${filter}"`}{onlyLow && ' (przy filtrze niskiego stanu)'}</CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {groups.map(g => <ProductCard key={g.groupKey} g={g} />)}
        </div>
      )}

      {/* ── Stopka legendy ────────────────────────────────── */}
      <Card className="bg-muted/40 border-dashed">
        <CardContent className="p-3 flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground">
          <CardDescription className="text-[10px] font-bold uppercase">Stan zapasów</CardDescription>
          <div className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-red-500"/> &lt; {LOW_THRESHOLD} szt — niski</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-amber-500"/> {LOW_THRESHOLD}–{HIGH_THRESHOLD-1} szt — średni</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-emerald-500"/> ≥ {HIGH_THRESHOLD} szt — wysoki</div>
        </CardContent>
      </Card>
    </div>
  )
}
