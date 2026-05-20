/**
 * FinishedGoodsDetailPage — szczegóły rodzaju wyrobu gotowego.
 *
 * URL: /office/magazyn/gotowe/:groupKey  (groupKey = recipeId__kgPerUnit)
 *
 * Pokazuje wszystkie partie tego rodzaju w kolejności FEFO (najstarsza data
 * produkcji najpierw). Klik wiersza → DetailModal z pełnym łańcuchem
 * traceability (R-xxx → rozbiór → masownia → MPP → kebab).
 */
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import {
  ArrowLeft, Eye, ShoppingBag, Search, Boxes, Clock,
} from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { DetailModal } from '@/features/finished-goods/components/DetailModal'

// Helpers (zsynchronizowane z FinishedGoodsPage)
function parseGroupKey(raw: string | undefined): { recipeId: string; kgPerUnit: number } {
  if (!raw) return { recipeId: '', kgPerUnit: 0 }
  const decoded = decodeURIComponent(raw)
  const idx = decoded.lastIndexOf('__')
  if (idx < 0) return { recipeId: decoded, kgPerUnit: 0 }
  return {
    recipeId:  decoded.slice(0, idx),
    kgPerUnit: parseFloat(decoded.slice(idx + 2)) || 0,
  }
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 0
  const t = Date.parse(dateStr)
  if (!t || isNaN(t)) return 0
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
}

function ageBadge(days: number): React.ReactNode {
  if (days <= 0) return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">dziś</Badge>
  if (days <= 3) return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">{days}d</Badge>
  if (days <= 7) return <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{days}d</Badge>
  return <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">{days}d</Badge>
}

export function FinishedGoodsDetailPage() {
  const { groupKey } = useParams<{ groupKey: string }>()
  const { data: items, loading } = useApi(() => finishedGoodsApi.list())
  const [filter, setFilter] = useState('')
  const [detailItem, setDetailItem] = useState<FinishedGoodsItem | null>(null)

  const target = useMemo(() => parseGroupKey(groupKey), [groupKey])
  const rawList = items ?? []

  // Wszystkie partie pasujące do grupy
  const groupBatches = useMemo(() => {
    return rawList.filter(it =>
      (it.recipeId || it.recipeName) === target.recipeId &&
      Number(it.kgPerUnit) === Number(target.kgPerUnit)
    )
  }, [rawList, target.recipeId, target.kgPerUnit])

  // Filtr po szukajce
  const visible = useMemo(() => {
    let result = groupBatches
    const q = filter.toLowerCase().trim()
    if (q) {
      result = result.filter(it =>
        (it.batchNo || '').toLowerCase().includes(q) ||
        (it.clientName || '').toLowerCase().includes(q) ||
        (it.clientOrderNo || '').toLowerCase().includes(q) ||
        (it.packagingName || '').toLowerCase().includes(q)
      )
    }
    // FEFO: najstarsza data produkcji najpierw
    return [...result].sort((a, b) => {
      const da = a.producedDate || '9999-12-31'
      const db = b.producedDate || '9999-12-31'
      return da.localeCompare(db)
    })
  }, [groupBatches, filter])

  const header = groupBatches[0]
  const totalQty = groupBatches.reduce((s, i) => s + i.qtyAvailable, 0)
  const totalKg  = groupBatches.reduce((s, i) => s + i.qtyAvailable * i.kgPerUnit, 0)
  const oldestDays = groupBatches.reduce((max, i) => Math.max(max, daysSince(i.producedDate)), 0)
  const clientCount = new Set(groupBatches.map(b => b.clientName).filter(Boolean)).size

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!header) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild className="gap-1.5">
          <Link to="/office/magazyn/gotowe">
            <ArrowLeft size={14}/> Wstecz do magazynu
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <ShoppingBag size={36} className="text-muted-foreground opacity-30" />
            <CardTitle className="text-base font-medium text-muted-foreground">Brak partii dla tego rodzaju</CardTitle>
            <CardDescription>Rodzaj prawdopodobnie sprzedany w całości lub usunięty.</CardDescription>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Nagłówek ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 h-7 text-muted-foreground hover:text-ink">
            <Link to="/office/magazyn/gotowe">
              <ArrowLeft size={13}/> Wstecz do magazynu
            </Link>
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-2xl font-black tracking-tight">{header.recipeName}</CardTitle>
            <code className="font-mono text-sm font-bold text-primary bg-primary/5 px-2 py-1 rounded">
              {header.kgPerUnit} kg / szt
            </code>
          </div>
          {header.productTypeName && (
            <CardDescription className="text-sm">{header.productTypeName}</CardDescription>
          )}
        </div>
      </div>

      {/* ── KPI ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Łącznie szt', val: totalQty,           icon: <Boxes size={14}/>,    color: 'text-ink' },
          { label: 'Łącznie kg',  val: fmtKg(totalKg, 0),  icon: <Boxes size={14}/>,    color: 'text-ink' },
          { label: 'Partii',      val: groupBatches.length, icon: <ShoppingBag size={14}/>, color: 'text-ink' },
          { label: 'Najstarsza',  val: oldestDays > 0 ? `${oldestDays}d` : 'dziś', icon: <Clock size={14}/>,
            color: oldestDays > 7 ? 'text-red-600' : oldestDays > 3 ? 'text-amber-600' : 'text-emerald-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
                {k.icon}
                <CardDescription className="text-[10px] font-bold uppercase tracking-wider">{k.label}</CardDescription>
              </div>
              <div className={cn('text-2xl font-black tabular-nums', k.color)}>{k.val}</div>
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
            placeholder="Szukaj: nr partii, klient, zamówienie, tuleja…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        {clientCount > 0 && (
          <CardDescription className="text-xs">
            {clientCount} klient{clientCount === 1 ? '' : clientCount < 5 ? 'ów' : 'ów'}
          </CardDescription>
        )}
      </div>

      {/* ── Tabela FEFO ────────────────────────────────────── */}
      <Card>
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Partie · FEFO</CardTitle>
            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
              {visible.length} {visible.length === 1 ? 'partia' : 'partii'}
            </Badge>
          </div>
          <CardDescription className="text-[11px]">
            Najstarsze partie najpierw — wydawaj w tej kolejności
          </CardDescription>
        </div>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Search size={28} className="text-muted-foreground opacity-20" />
              <CardDescription>Brak wyników{filter && ` dla „${filter}"`}</CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap">#</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap">Nr partii</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap">Produkcja</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap">Wiek</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap text-right">Ilość</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap text-right">Kg</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap">Tuleja</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider whitespace-nowrap">Klient / Zam.</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item, idx) => {
                  const days = daysSince(item.producedDate)
                  const isOldest = idx === 0
                  return (
                    <TableRow
                      key={item.id}
                      className={cn(
                        'cursor-pointer transition-colors',
                        isOldest && 'bg-amber-50/40 hover:bg-amber-50/60',
                      )}
                      onClick={() => setDetailItem(item)}
                    >
                      <TableCell className="text-[11px] tabular-nums text-muted-foreground">
                        {isOldest && (
                          <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-300 font-bold">
                            FEFO
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono font-bold text-sm text-primary">{item.batchNo}</code>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{fmtDatePl(item.producedDate)}</TableCell>
                      <TableCell>{ageBadge(days)}</TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold tabular-nums">{item.qtyAvailable}</span>
                        <span className="text-muted-foreground text-[11px]"> szt</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold tabular-nums text-emerald-700">
                          {fmtKg(item.qtyAvailable * item.kgPerUnit, 0)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{item.packagingName || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {item.clientName ? (
                          <div className="text-xs">
                            <div className="font-medium truncate max-w-[200px]">{item.clientName}</div>
                            {item.clientOrderNo && (
                              <div className="text-muted-foreground font-mono text-[10px]">{item.clientOrderNo}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">wolna partia</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); setDetailItem(item) }}
                          title="Pokaż łańcuch partii"
                        >
                          <Eye size={13}/>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  )
}
