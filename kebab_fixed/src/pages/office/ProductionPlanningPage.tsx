/**
 * ProductionPlanningPage v3
 * - Panel mięsa: zgrupowany per receptura, zwinięty domyślnie
 * - Rezerwacja: proporcjonalna wg pojemności partii (nie równa)
 * - Partie w pozycji: czytelny dropdown zamiast checkboxów
 * - Klient: wybór z listy kontrahentów
 */
import { useState, useMemo, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { useClientNames } from '@/lib/clientNames'
import { productionPlansApi, clientOrdersApi, seasonedMeatApi, packagingApi, clientsApi, finishedUnitsApi } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { UnitReprintModal, type ReprintLine } from '@/features/production/components/UnitReprintModal'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtKg, fmtDatePl, todayIso } from '@/lib/utils'
import {
  AlertTriangle,
  BarChart2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Download,
  Factory,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useProductTypes } from '@/features/products/hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import type { ProductionPlan, ProductionPlanLine, CreatePlanLineDto, ClientOrder } from '@/lib/mockApi'

interface PlanLineForm {
  qty:              string
  kgPerUnit:        string
  productTypeId:    string
  recipeId:         string
  packagingId:      string
  clientId:         string
  clientName:       string
  // Partie mięsa — lista id z priorytetem
  seasonedBatchIds: string[]
  seasonedBatchId:  string
  clientOrderId:    string
  clientOrderNo:    string
  clientOrderLineId: string
}

const emptyLine = (): PlanLineForm => ({
  qty:'', kgPerUnit:'', productTypeId:'', recipeId:'', packagingId:'',
  clientId:'', clientName:'',
  seasonedBatchIds:[], seasonedBatchId:'',
  clientOrderId:'', clientOrderNo:'', clientOrderLineId:'',
})

// Zajętość partii przez WSZYSTKIE linie poza wskazaną (zachłannie,
// w kolejności linii i zaznaczonych partii).
function computeOtherUsed(
  idx: number,
  lines: PlanLineForm[],
  seasonedRaw: any[],
): Record<string, number> {
  const otherUsed: Record<string, number> = {}
  lines.forEach((ll, li) => {
    if (li === idx) return
    const lids = ll.seasonedBatchIds?.length>0
      ? ll.seasonedBatchIds
      : (ll.seasonedBatchId ? [ll.seasonedBatchId] : [])
    const lNeeded = (parseFloat(ll.qty)||0)*(parseFloat(ll.kgPerUnit)||0)
    let lStill = lNeeded
    lids.forEach(id => {
      if (lStill<=0) return
      const s = seasonedRaw.find((x:any)=>x.id===id)
      if (!s) return
      const free = Math.max(0, (s.kgFree ?? s.kgAvailable) - (otherUsed[id]??0))
      const take = Math.min(lStill, free)
      otherUsed[id] = (otherUsed[id]??0) + take
      lStill -= take
    })
  })
  return otherUsed
}

// Oblicza ile kg z zaznaczonych partii jest FAKTYCZNIE dostępne dla danej linii,
// uwzględniając rezerwacje innych linii (proporcjonalnie, sekwencyjnie).
function computeSelKgAvailForLine(
  idx: number,
  lines: PlanLineForm[],
  seasonedRaw: any[],
): number {
  const line = lines[idx]
  if (!line) return 0
  const selIds = line.seasonedBatchIds?.length>0
    ? line.seasonedBatchIds
    : (line.seasonedBatchId ? [line.seasonedBatchId] : [])
  if (selIds.length === 0) return 0

  const otherUsed = computeOtherUsed(idx, lines, seasonedRaw)

  let available = 0
  selIds.forEach(id => {
    const s = seasonedRaw.find((x:any)=>x.id===id)
    if (!s) return
    available += Math.max(0, (s.kgFree ?? s.kgAvailable) - (otherUsed[id]??0))
  })
  return available
}

// Podgląd rozbicia linii na partie — lustrzane odbicie backendowego
// _compute_allocation (FEFO): całe sztuki z partii, a jej resztkę od razu
// zużyj w sztuce mieszanej (PM) dopełnionej z kolejnych partii.
interface AllocPreview {
  clean:       Array<{ batchNo: string; pieces: number }>
  mixedPieces: number
  mixedParts:  Array<{ batchNo: string; kg: number }>
}

function computeAllocPreview(
  idx: number,
  lines: PlanLineForm[],
  seasonedRaw: any[],
): AllocPreview | null {
  const line = lines[idx]
  if (!line) return null
  const qty  = parseFloat(line.qty)||0
  const kgPu = parseFloat(line.kgPerUnit)||0
  if (qty <= 0 || kgPu <= 0) return null
  const selIds = line.seasonedBatchIds?.length>0
    ? line.seasonedBatchIds
    : (line.seasonedBatchId ? [line.seasonedBatchId] : [])
  if (selIds.length === 0) return null

  const otherUsed = computeOtherUsed(idx, lines, seasonedRaw)
  const pool = selIds.map(id => {
    const s = seasonedRaw.find((x:any)=>x.id===id)
    return {
      batchNo: s?.batchNo ?? '?',
      free: s ? Math.max(0, (s.kgFree ?? s.kgAvailable) - (otherUsed[id]??0)) : 0,
    }
  })

  const clean: Array<{ batchNo: string; pieces: number }> = []
  const partsMap: Record<string, number> = {}
  let remaining = qty
  let mixed = 0
  for (let i = 0; i < pool.length; i++) {
    const b = pool[i]
    if (remaining > 0) {
      const pcs = Math.min(remaining, Math.floor(b.free / kgPu))
      if (pcs > 0) clean.push({ batchNo: b.batchNo, pieces: pcs })
      b.free -= pcs * kgPu
      remaining -= pcs
    }
    while (remaining > 0 && b.free > 1e-6) {
      let need = kgPu
      const taken: Array<[number, number]> = []
      for (let j = i; j < pool.length && need > 1e-6; j++) {
        const take = Math.min(need, pool[j].free)
        if (take <= 1e-6) continue
        taken.push([j, take])
        need -= take
      }
      if (need > 1e-6) break
      taken.forEach(([j, take]) => {
        pool[j].free -= take
        partsMap[pool[j].batchNo] = (partsMap[pool[j].batchNo] ?? 0) + take
      })
      mixed++
      remaining--
    }
  }
  return {
    clean,
    mixedPieces: mixed,
    mixedParts: Object.entries(partsMap).map(([batchNo, kg]) => ({ batchNo, kg })),
  }
}

// Mapa rezerwacji: ile kg z każdej partii zajmują podane linie formularza
// (zachłannie, w kolejności linii i zaznaczonych partii).
function computeUsage(lines: PlanLineForm[], seasonedRaw: any[]): Record<string, number> {
  const map: Record<string, number> = {}
  lines.forEach(l => {
    const needed = (parseFloat(l.qty)||0) * (parseFloat(l.kgPerUnit)||0)
    if (needed <= 0) return
    const ids = l.seasonedBatchIds?.length>0
      ? l.seasonedBatchIds
      : (l.seasonedBatchId ? [l.seasonedBatchId] : [])
    if (ids.length === 0) return
    let stillNeeded = needed
    ids.forEach(id => {
      if (stillNeeded <= 0) return
      const s = seasonedRaw.find((x:any)=>x.id===id)
      if (!s) return
      const free = Math.max(0, (s.kgFree ?? s.kgAvailable) - (map[id] ?? 0))
      const take = Math.min(stillNeeded, free)
      if (take > 0) { map[id] = (map[id]??0) + take; stillNeeded -= take }
    })
  })
  return map
}

// Automatyczny przydział partii (FEFO) dla nowych linii — pula = wolne kg
// po odjęciu rezerwacji już istniejących linii formularza.
function autoAssignNewLines(newLines: PlanLineForm[], existing: PlanLineForm[], seasonedRaw: any[]): PlanLineForm[] {
  const used = computeUsage(existing, seasonedRaw)
  const pool = seasonedRaw
    .map((s:any) => ({
      id: s.id, recipeId: s.recipeId, expiryDate: s.expiryDate,
      rem: Math.max(0, (s.kgFree ?? s.kgAvailable) - (used[s.id]??0)),
    }))
    .sort((a,b)=>a.expiryDate>b.expiryDate?1:-1)
  return newLines.map(line => {
    if (line.seasonedBatchIds?.length>0 || line.seasonedBatchId) return line
    const needed = (parseFloat(line.qty)||0)*(parseFloat(line.kgPerUnit)||0)
    if (needed<=0 || !line.recipeId) return line
    let still = needed
    const assigned: string[] = []
    for (const b of pool) {
      if (still<=0) break
      if (b.recipeId!==line.recipeId || b.rem<=0.01) continue
      const take = Math.min(still, b.rem)
      b.rem -= take; still -= take
      assigned.push(b.id)
    }
    return assigned.length===0 ? line : { ...line, seasonedBatchIds: assigned, seasonedBatchId: assigned[0] }
  })
}

// ─── Kebab komponentowy (np. 70/30) ───────────────────────────
// Receptura ze składem produkcyjnym: partie per komponent dobiera backend
// (FEFO po rodzaju mięsa) — planista nie zaznacza partii ręcznie.
interface RecipeComponentLite { materialTypeId: string; materialName: string; pct: number }

function recipeComponents(recipes: any[], recipeId: string): RecipeComponentLite[] {
  if (!recipeId) return []
  const r = (recipes ?? []).find((x: any) => x.id === recipeId)
  return (r?.components ?? []) as RecipeComponentLite[]
}

// Dostępność mięsa per komponent (wolne kg wg rodzaju surowca)
function componentAvailability(
  comps: RecipeComponentLite[], qty: number, kgPu: number, seasonedRaw: any[],
) {
  return comps.map(c => {
    const free = (seasonedRaw ?? [])
      .filter((s: any) => (s.materialTypeId ?? '') === c.materialTypeId)
      .reduce((s2: number, s: any) => s2 + Math.max(0, (s.kgFree ?? s.kgAvailable) - 0), 0)
    const need = qty * kgPu * c.pct / 100
    return { ...c, free, need, ok: free >= need - 0.1 }
  })
}

const STATUS_LABELS: Record<ProductionPlan['status'], string> = {
  draft:'Szkic', active:'Aktywny', done:'Ukończony', cancelled:'Anulowany',
}
const STATUS_CLASS: Record<ProductionPlan['status'], string> = {
  draft: '',
  active: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  done: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-50',
  cancelled: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
}

// ─── Przegląd mięsa na stronie głównej ────────────────────────
// Planista widzi stan mięsa przyprawionego per receptura bez
// otwierania formularza planu.
function MeatStockOverview() {
  const { data: seasoned, loading } = useApi(() => seasonedMeatApi.list())
  const [collapsed, setCollapsed] = useState(false)

  const byRecipe = useMemo(() => {
    const m: Record<string, {
      recipeName: string
      freeKg: number; reservedKg: number; totalKg: number
      batches: number; nearestExpiry: string
    }> = {}
    ;(seasoned ?? []).forEach((s: any) => {
      const free     = Math.max(0, s.kgFree ?? s.kgAvailable ?? 0)
      const reserved = Math.max(0, s.kgReserved ?? 0)
      if (free <= 0 && reserved <= 0) return
      if (!m[s.recipeId]) {
        m[s.recipeId] = { recipeName: s.recipeName, freeKg: 0, reservedKg: 0, totalKg: 0, batches: 0, nearestExpiry: '' }
      }
      const r = m[s.recipeId]
      r.freeKg     += free
      r.reservedKg += reserved
      r.totalKg    += free + reserved
      r.batches    += 1
      if (free > 0 && s.expiryDate && (!r.nearestExpiry || s.expiryDate < r.nearestExpiry)) {
        r.nearestExpiry = s.expiryDate
      }
    })
    return Object.values(m).sort((a, b) => b.freeKg - a.freeKg)
  }, [seasoned])

  const totalFree = byRecipe.reduce((s, r) => s + r.freeKg, 0)

  function expiryDays(iso: string): number | null {
    if (!iso) return null
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
    return Number.isFinite(d) ? d : null
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-2.5 flex items-center gap-2 border-b bg-blue-50/60 hover:bg-blue-50 transition-colors"
      >
        <BarChart2 size={14} className="text-blue-600"/>
        <span className="text-[12px] font-bold text-blue-800 uppercase tracking-wide">Mięso do dyspozycji</span>
        {!loading && (
          <span className="text-[12px] font-black text-blue-700 ml-1">{fmtKg(totalFree, 0)} kg</span>
        )}
        <span className="ml-auto text-muted-foreground">
          {collapsed ? <ChevronDown size={15}/> : <ChevronUp size={15}/>}
        </span>
      </button>
      {!collapsed && (
        loading ? (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full"/>)}
          </div>
        ) : byRecipe.length === 0 ? (
          <div className="px-4 py-5 text-[12px] text-muted-foreground">
            Brak mięsa przyprawionego w magazynie — zaplanuj masowanie, aby mieć z czego produkować.
          </div>
        ) : (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {byRecipe.map(r => {
              const days     = expiryDays(r.nearestExpiry)
              const expSoon  = days !== null && days <= 2
              const pctFree  = r.totalKg > 0 ? (r.freeKg / r.totalKg) * 100 : 0
              const isEmpty  = r.freeKg < 0.1
              return (
                <div key={r.recipeName} className={`rounded-lg border p-3 ${isEmpty ? 'bg-muted/40 border-muted' : 'bg-white border-blue-100'}`}>
                  <div className="text-[11px] font-bold truncate mb-1" title={r.recipeName}>{r.recipeName}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-black leading-none ${isEmpty ? 'text-muted-foreground' : 'text-green-700'}`}>
                      {fmtKg(r.freeKg, 0)}
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground">kg wolne</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                    <div className={`h-full rounded-full ${isEmpty ? 'bg-muted' : 'bg-green-500'}`} style={{ width: `${pctFree}%` }}/>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1.5 flex flex-wrap gap-x-2">
                    <span>{r.batches} parti{r.batches === 1 ? 'a' : r.batches < 5 ? 'e' : 'i'}</span>
                    {r.reservedKg > 0.1 && <span className="text-amber-600">zarez. {fmtKg(r.reservedKg, 0)} kg</span>}
                    {days !== null && (
                      <span className={expSoon ? 'text-red-600 font-bold' : ''}>
                        ważność: {fmtDatePl(r.nearestExpiry)}{expSoon ? ` (${days <= 0 ? 'dziś!' : `${days} dn.`})` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </Card>
  )
}

// ─── Import z zamówień ────────────────────────────────────────
function ImportOrderModal({ orders, meatFreeByRecipe, onImport, onClose }: {
  orders: ClientOrder[]
  meatFreeByRecipe: Record<string, number>
  onImport: (lines: PlanLineForm[]) => void
  onClose: () => void
}) {
  const clientDisplay = useClientNames()
  const [expandedId,   setExpandedId]   = useState<string|null>(null)
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  // Postęp produkcji per linia zamówienia (scalany z kolejnych zamówień)
  const [progressByLine, setProgressByLine] = useState<Record<string, { qtyDone: number; qtyPending: number; qtyRemaining: number }>>({})
  const [loadedOrders, setLoadedOrders] = useState<Set<string>>(new Set())
  const [loadingOrder, setLoadingOrder] = useState<string|null>(null)

  const remainingOf = (l: { id: string; qty: number }) => progressByLine[l.id]?.qtyRemaining ?? l.qty

  async function toggleOrder(o: ClientOrder) {
    if (expandedId === o.id) { setExpandedId(null); return }
    setExpandedId(o.id)
    if (loadedOrders.has(o.id)) return
    setLoadingOrder(o.id)
    let merged: Record<string, { qtyDone: number; qtyPending: number; qtyRemaining: number }> = {}
    try {
      const p = await clientOrdersApi.productionProgress(o.id)
      p.lines.forEach(pl => { merged[pl.lineId] = { qtyDone: pl.qtyDone, qtyPending: pl.qtyPending, qtyRemaining: pl.qtyRemaining } })
      setProgressByLine(prev => ({ ...prev, ...merged }))
    } catch { /* brak postępu — traktuj całość jako do wyprodukowania */ }
    setLoadedOrders(prev => new Set(prev).add(o.id))
    // Po rozwinięciu od razu zaznacz wszystko, co zostało do wyprodukowania
    setSelected(prev => {
      const n = new Set(prev)
      o.lines.forEach(l => { if ((merged[l.id]?.qtyRemaining ?? l.qty) > 0) n.add(l.id) })
      return n
    })
    setLoadingOrder(null)
  }

  function toggleAllInOrder(o: ClientOrder) {
    const avail = o.lines.filter(l => remainingOf(l) > 0).map(l => l.id)
    const allSel = avail.length > 0 && avail.every(id => selected.has(id))
    setSelected(prev => {
      const n = new Set(prev)
      avail.forEach(id => allSel ? n.delete(id) : n.add(id))
      return n
    })
  }

  function handleConfirm() {
    const newLines: PlanLineForm[] = []
    orders.forEach(o => o.lines.forEach(l => {
      if (!selected.has(l.id)) return
      const remaining = remainingOf(l)
      if (remaining <= 0) return
      newLines.push({
        qty:             String(remaining),
        kgPerUnit:       String(l.kgPerUnit),
        productTypeId:   l.productTypeId,
        recipeId:        l.recipeId,
        packagingId:     l.packagingId??'',
        clientId:        o.clientId,
        clientName:      o.clientName,
        seasonedBatchIds:[], seasonedBatchId:'',
        clientOrderId:   o.id,
        clientOrderNo:   o.orderNo,
        clientOrderLineId: l.id,
      })
    }))
    if (newLines.length === 0) return
    onImport(newLines)
    onClose()
  }

  // Podsumowanie wyboru (może obejmować pozycje z kilku zamówień)
  const summary = useMemo(() => {
    let count = 0, kg = 0
    orders.forEach(o => o.lines.forEach(l => {
      if (!selected.has(l.id)) return
      const r = remainingOf(l)
      if (r <= 0) return
      count += 1
      kg += r * l.kgPerUnit
    }))
    return { count, kg }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, selected, progressByLine])

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        Kliknij zamówienie, aby zobaczyć pozycje — to, co zostało do wyprodukowania, zaznacza się samo.
        Możesz wybrać pozycje z kilku zamówień naraz.
      </div>

      {/* Lista zamówień — klient + total kg w wierszu, szczegóły w rozwinięciu */}
      <div className="border rounded-lg divide-y max-h-[60vh] overflow-y-auto">
        {orders.map(o => {
          const isExp        = expandedId === o.id
          const selInOrder   = o.lines.filter(l => selected.has(l.id) && remainingOf(l) > 0).length
          const availInOrder = o.lines.filter(l => remainingOf(l) > 0)
          const allSel       = availInOrder.length > 0 && availInOrder.every(l => selected.has(l.id))
          return (
            <div key={o.id}>
              <button
                onClick={() => toggleOrder(o)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${isExp ? 'bg-blue-50/50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-bold truncate">{clientDisplay(o.clientName)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{o.orderNo}</span>
                    {selInOrder > 0 && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">
                        {selInOrder} zazn.
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {o.deliveryDate ? <>dostawa <strong className="text-foreground">{fmtDatePl(o.deliveryDate)}</strong> · </> : null}
                    {o.lines.length} poz. · {o.totalUnits} szt
                  </div>
                </div>
                <div className="text-sm font-black text-blue-700 flex-shrink-0">{fmtKg(o.totalKg,0)} kg</div>
                {isExp
                  ? <ChevronUp size={15} className="text-muted-foreground flex-shrink-0"/>
                  : <ChevronDown size={15} className="text-muted-foreground flex-shrink-0"/>}
              </button>

              {isExp && (
                <div className="border-t bg-muted/20">
                  {loadingOrder === o.id ? (
                    <div className="p-3 space-y-2">
                      <Skeleton className="h-9 w-full"/>
                      <Skeleton className="h-9 w-full"/>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-end px-3 pt-1.5">
                        <Button variant="ghost" size="sm" onClick={() => toggleAllInOrder(o)}
                          disabled={availInOrder.length === 0} className="h-6 text-[10px] gap-1 px-2">
                          {allSel ? <><Square size={11}/>Odznacz</> : <><CheckSquare size={11}/>Zaznacz wszystkie</>}
                        </Button>
                      </div>
                      <div className="divide-y">
                        {o.lines.map(l=>{
                          const p          = progressByLine[l.id]
                          const qtyDone    = p?.qtyDone    ?? 0
                          const qtyPending = p?.qtyPending ?? 0
                          const qtyRemain  = p?.qtyRemaining ?? l.qty
                          const isFull     = qtyRemain <= 0
                          const isSel      = selected.has(l.id)
                          const needKg     = qtyRemain * l.kgPerUnit
                          const meatFree   = meatFreeByRecipe[l.recipeId] ?? 0
                          const meatOk     = meatFree >= needKg - 0.1
                          const pctDone    = l.qty > 0 ? (qtyDone    / l.qty) * 100 : 0
                          const pctPending = l.qty > 0 ? (qtyPending / l.qty) * 100 : 0

                          return (
                            <label
                              key={l.id}
                              className={`flex items-start gap-3 px-3 py-2.5 transition-colors ${
                                isFull
                                  ? 'bg-green-50/50 opacity-70 cursor-not-allowed'
                                  : `cursor-pointer hover:bg-muted/50 ${isSel?'bg-blue-50/60':''}`
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSel}
                                disabled={isFull}
                                onChange={()=>setSelected(prev=>{
                                  const n = new Set(prev)
                                  n.has(l.id) ? n.delete(l.id) : n.add(l.id)
                                  return n
                                })}
                                className="w-4 h-4 accent-primary flex-shrink-0 mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-bold flex flex-wrap items-center gap-2">
                                  <span className="truncate">{l.productTypeName} · {l.recipeName}</span>
                                  {isFull && (
                                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold border border-green-200">
                                      ✓ Wyprodukowane
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  {qtyRemain < l.qty
                                    ? <><strong className="text-amber-700">{qtyRemain} szt do produkcji</strong> (z {l.qty})</>
                                    : <>{l.qty} szt</>
                                  } × {l.kgPerUnit} kg = <strong className="text-blue-700">{fmtKg(needKg,0)} kg</strong>
                                  {l.packagingName ? <span> · {l.packagingName}</span> : null}
                                </div>
                                {/* Pasek postępu produkcji: zielone = wyprodukowane, bursztyn = w toku/planie */}
                                {(qtyDone>0 || qtyPending>0) && (
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden flex">
                                      <div className="h-full bg-green-500" style={{width:`${pctDone}%`}}/>
                                      <div className="h-full bg-amber-400" style={{width:`${pctPending}%`}}/>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                      {qtyDone>0 && <span className="text-green-700 font-semibold">{qtyDone} got.</span>}
                                      {qtyDone>0 && qtyPending>0 && ' · '}
                                      {qtyPending>0 && <span className="text-amber-600 font-semibold">{qtyPending} w toku</span>}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {/* Wskaźnik mięsa dla receptury tej pozycji */}
                              {!isFull && (
                                <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold border whitespace-nowrap ${
                                  meatOk
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : 'bg-red-50 text-red-600 border-red-200'
                                }`}>
                                  mięso: {fmtKg(meatFree,0)} kg{meatOk ? '' : ` (brak ${fmtKg(needKg-meatFree,0)})`}
                                </span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {summary.count > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <span className="text-[11px] font-semibold text-blue-700">
            Wybrano {summary.count} poz. do zaplanowania
          </span>
          <span className="text-sm font-black text-blue-700">{fmtKg(summary.kg,0)} kg</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleConfirm} disabled={summary.count===0} className="flex-1">
          <Download size={14} className="mr-1"/> Importuj {summary.count} poz.
        </Button>
      </div>
    </div>
  )
}

// ─── Panel mięsa (zgrupowany per receptura) ───────────────────
interface MeatPanelProps {
  seasonedAvail: any[]
  seasonedUsed:  Record<string, number>
  onAutoAssign:  (recipeId: string) => void
}

function MeatPanel({ seasonedAvail, seasonedUsed, onAutoAssign }: MeatPanelProps) {
  const [expandedRecipe, setExpandedRecipe] = useState<string|null>(null)
  if (seasonedAvail.length === 0) return null

  // Grupuj po recepturze
  const byRecipe: Record<string, {
    recipeId: string; recipeName: string
    totalKg: number; usedKg: number; remainingKg: number
    batches: any[]
  }> = {}
  seasonedAvail.forEach(s => {
    if (!byRecipe[s.recipeId]) {
      byRecipe[s.recipeId] = { recipeId:s.recipeId, recipeName:s.recipeName, totalKg:0, usedKg:0, remainingKg:0, batches:[] }
    }
    byRecipe[s.recipeId].totalKg    += (s.kgFree ?? s.kgAvailable)
    byRecipe[s.recipeId].usedKg     += seasonedUsed[s.id]??0
    byRecipe[s.recipeId].batches.push(s)
  })
  Object.values(byRecipe).forEach(r => { r.remainingKg = r.totalKg - r.usedKg })

  return (
    <div className="border border-blue-200 rounded-xl overflow-hidden">
      <div className="bg-blue-50 px-3 py-2 flex items-center gap-2 border-b border-blue-200">
        <BarChart2 size={13} className="text-blue-600"/>
        <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Stan mięsa przyprawionego</span>
      </div>
      <div className="divide-y divide-blue-100">
        {Object.values(byRecipe).map(r => {
          const pct        = r.totalKg > 0 ? Math.min(100, (r.usedKg/r.totalKg)*100) : 0
          const isExpanded = expandedRecipe === r.recipeId
          const isFull     = r.remainingKg < 0.1 && r.totalKg > 0
          return (
            <div key={r.recipeId} className="bg-white">
              {/* Nagłówek receptury — zwinięty */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-bold truncate">{r.recipeName}</span>
                    <span className="text-[10px] text-muted-foreground">{r.batches.length} parti{r.batches.length===1?'a':r.batches.length<5?'e':'i'}</span>
                    {isFull && <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-semibold">Wszystko zaplanowane</span>}
                  </div>
                  {/* Pasek + liczniki w jednym wierszu */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isFull?'bg-green-500':pct>80?'bg-amber-400':'bg-blue-500'}`}
                        style={{width:`${pct}%`}}/>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] whitespace-nowrap flex-shrink-0 text-muted-foreground">
                      <span>w planie: <strong className="text-amber-600">{fmtKg(r.usedKg,0)}</strong></span>
                      <span>z <strong>{fmtKg(r.totalKg,0)} kg</strong></span>
                    </div>
                  </div>
                </div>
                {/* Wolne kg — główna liczba dla planisty */}
                <div className="text-right flex-shrink-0 min-w-[72px]">
                  <div className={`text-lg font-black leading-none ${isFull?'text-green-600':'text-blue-700'}`}>
                    {fmtKg(r.remainingKg,0)} kg
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">do dyspozycji</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button variant="outline" size="sm"
                    onClick={()=>onAutoAssign(r.recipeId)}
                    className="h-7 text-[11px] text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100 px-2">
                    ⚡ Auto
                  </Button>
                  <Button variant="ghost" size="icon"
                    onClick={()=>setExpandedRecipe(isExpanded?null:r.recipeId)}
                    className="h-7 w-7">
                    {isExpanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
                  </Button>
                </div>
              </div>
              {/* Szczegóły partii — rozwinięte */}
              {isExpanded && (
                <div className="px-3 pb-2.5 border-t border-blue-100 bg-blue-50/30">
                  <div className="grid grid-cols-2 gap-1 mt-2">
                    {r.batches.map((s:any) => {
                      const used = seasonedUsed[s.id]??0
                      return (
                        <div key={s.id} className={`flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded border ${s.kgAvailLive<0.1&&s.kgAvailable>0?'bg-red-50 border-red-200':'bg-white border-blue-100'}`}>
                          <span className="font-mono font-bold text-primary text-[10px]">{s.batchNo}</span>
                          <span className={`font-bold ml-2 ${s.kgAvailLive<0.1?'text-red-600':'text-green-700'}`}>
                            {fmtKg(s.kgAvailLive)} kg
                          </span>
                          {used>0 && <span className="text-amber-500 text-[10px] ml-1">−{fmtKg(used,0)}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Pasek szybkiego dodawania pozycji (styl POS, jak w zamówieniach) ─
interface QuickAddProps {
  onAdd:            (line: PlanLineForm) => void
  productTypes:     any[]
  recipes:          any[]
  packaging:        any[]
  clients:          any[]
  meatFreeByRecipe: Record<string, number>
}

function PlanLineQuickAdd({ onAdd, productTypes, recipes, packaging, clients, meatFreeByRecipe }: QuickAddProps) {
  const [draft, setDraft] = useState<PlanLineForm>(emptyLine())
  const [hint,  setHint]  = useState('')
  const qtyRef = useRef<HTMLInputElement|null>(null)

  function set(k: keyof PlanLineForm, v: string) {
    setDraft(d => {
      if (k === 'productTypeId') return { ...d, productTypeId: v, recipeId: '' }
      if (k === 'clientId') {
        const c = clients.find((x:any)=>x.id===v)
        return { ...d, clientId: v, clientName: c?.name ?? '' }
      }
      return { ...d, [k]: v }
    })
  }

  function commit() {
    if (!draft.recipeId || !(parseFloat(draft.qty)>0) || !(parseFloat(draft.kgPerUnit)>0)) {
      setHint('Uzupełnij szt, kg i recepturę')
      return
    }
    onAdd({ ...draft })
    setDraft(emptyLine())
    setHint('')
    requestAnimationFrame(() => qtyRef.current?.focus())
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
  }

  useEffect(() => { qtyRef.current?.focus() }, [])

  const draftRecipes = recipes.filter((r:any) =>
    !draft.productTypeId || !r.productTypeId || r.productTypeId === draft.productTypeId)

  const needKg  = (parseFloat(draft.qty)||0) * (parseFloat(draft.kgPerUnit)||0)
  const draftComps = recipeComponents(recipes, draft.recipeId)
  const freeKg  = draft.recipeId && draftComps.length === 0 ? (meatFreeByRecipe[draft.recipeId] ?? 0) : null
  const meatOk  = freeKg === null || needKg <= 0 || freeKg >= needKg - 0.1

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2">
      <div className="grid items-end gap-1.5" style={{ gridTemplateColumns: '64px 64px 1fr 1.2fr 1fr 1fr auto' }}>
        <Input ref={qtyRef} type="number" min="1" step="1" value={draft.qty}
          onChange={e=>set('qty',e.target.value)} onKeyDown={onKeyDown}
          placeholder="szt" className="h-8 text-sm px-2"/>
        <Input type="number" min="0.1" step="0.1" value={draft.kgPerUnit}
          onChange={e=>set('kgPerUnit',e.target.value)} onKeyDown={onKeyDown}
          placeholder="kg" className="h-8 text-sm px-2"/>
        <Select value={draft.productTypeId} onValueChange={v=>set('productTypeId',v)}>
          <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Rodzaj..."/></SelectTrigger>
          <SelectContent>
            {productTypes.map((pt:any)=><SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={draft.recipeId} onValueChange={v=>set('recipeId',v)}>
          <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Receptura..."/></SelectTrigger>
          <SelectContent>
            {draftRecipes.map((r:any)=>(
              <SelectItem key={r.id} value={r.id}>
                {r.name}
                <span className="text-muted-foreground">
                  {' · '}
                  {(r.components?.length ?? 0) > 0
                    ? `skład ${r.components.map((c:any)=>c.pct).join('/')}`
                    : `${fmtKg(meatFreeByRecipe[r.id] ?? 0, 0)} kg`}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={draft.packagingId || '__none'} onValueChange={v=>set('packagingId', v==='__none'?'':v)}>
          <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Tuleja..."/></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">— brak —</SelectItem>
            {packaging.map((p:any)=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={draft.clientId || '__none'} onValueChange={v=>set('clientId', v==='__none'?'':v)}>
          <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Klient..."/></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">— brak —</SelectItem>
            {clients.map((c:any)=><SelectItem key={c.id} value={c.id}>{c.displayName || c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={commit} size="sm" className="h-8 gap-1.5"><CornerDownLeft size={13}/> Dodaj</Button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 min-h-[16px]">
        {hint
          ? <p className="text-[11px] text-destructive font-medium">{hint}</p>
          : <p className="text-[10px] text-muted-foreground">Enter dodaje pozycję — partie mięsa przydzielą się same (FEFO)</p>}
        {freeKg !== null && needKg > 0 && (
          <span className={`text-[10px] font-semibold whitespace-nowrap ${meatOk ? 'text-green-700' : 'text-red-600'}`}>
            {meatOk
              ? `✓ mięso: ${fmtKg(freeKg,0)} kg wolne`
              : `⚠ brakuje ${fmtKg(needKg-(freeKg??0),0)} kg mięsa (wolne ${fmtKg(freeKg??0,0)} kg)`}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Formularz pozycji ────────────────────────────────────────
interface LineFormProps {
  line:           PlanLineForm
  idx:            number
  total:          number
  lines:          PlanLineForm[]    // wszystkie linie (do obliczenia zajętości innych)
  productTypes:   any[]
  recipes:        any[]
  packaging:      any[]
  clients:        any[]
  seasonedAvail:  any[]
  seasonedUsed:   Record<string,number>
  seasonedRaw:    any[]
  onChange:       (k: keyof PlanLineForm, v: any) => void
  onRemove:       () => void
}

function LineFormRow({ line, idx, total, lines, productTypes, recipes, packaging, clients, seasonedAvail, seasonedUsed, seasonedRaw, onChange, onRemove }: LineFormProps) {
  const clientDisplay = useClientNames()
  const [showBatchPanel, setShowBatchPanel] = useState(false)

  const qty        = parseFloat(line.qty)||0
  const kgPerUnit  = parseFloat(line.kgPerUnit)||0
  const totalKgLine= qty * kgPerUnit

  const selIds = line.seasonedBatchIds?.length>0 ? line.seasonedBatchIds : (line.seasonedBatchId?[line.seasonedBatchId]:[])

  // Oblicz sumę dostępnego kg z zaznaczonych partii (proporcjonalnie)
  // Używamy kgAvailLive = kgAvailable - seasonedUsed (już odjęte zużycie z INNYCH linii)
  // selKgAvail = ile kg FAKTYCZNIE DOSTĘPNE dla tej linii z zaznaczonych partii
  // Liczymy zachłannie: bierzemy min(potrzeba, wolne_w_partii)
  // gdzie wolne = kgAvailable - rezerwacje INNYCH linii (seasonedUsed może zawierać też tę linię)
  // Dlatego liczymy od nowa dla bieżącej linii ignorując jej własne wpisy w seasonedUsed
  const selKgAvail = (() => {
    // Zbuduj "zajęte przez INNE linie" (bez bieżącej)
    const otherUsed: Record<string,number> = {}
    lines.forEach((ll, li) => {
      if (li === idx) return  // pomiń bieżącą linię
      const lids = ll.seasonedBatchIds?.length>0 ? ll.seasonedBatchIds : (ll.seasonedBatchId?[ll.seasonedBatchId]:[])
      const lNeeded = (parseFloat(ll.qty)||0)*(parseFloat(ll.kgPerUnit)||0)
      let lStill = lNeeded
      lids.forEach(id => {
        if (lStill<=0) return
        const s = seasonedRaw.find((x:any)=>x.id===id)
        if (!s) return
        const free = Math.max(0, (s.kgFree ?? s.kgAvailable) - (otherUsed[id]??0))
        const take = Math.min(lStill, free)
        otherUsed[id] = (otherUsed[id]??0) + take
        lStill -= take
      })
    })
    // Teraz oblicz ile dostępne dla bieżącej linii
    let available = 0
    selIds.forEach(id => {
      const s = seasonedRaw.find((x:any)=>x.id===id)
      if (!s) return
      available += Math.max(0, (s.kgFree ?? s.kgAvailable) - (otherUsed[id]??0))
    })
    return available
  })()
  const isOk = totalKgLine <= 0 || selKgAvail >= totalKgLine - 0.1
  const shortfall = totalKgLine - selKgAvail

  function toggleBatch(id: string) {
    const cur  = selIds
    const next = cur.includes(id) ? cur.filter(x=>x!==id) : [...cur, id]
    onChange('seasonedBatchIds', next)
    onChange('seasonedBatchId',  next[0]??'')
  }

  // Partie tej samej receptury co wybrana, FEFO
  const relevantBatches = seasonedAvail
    .filter((s:any) => {
      if (s.kgAvailLive <= 0 && !selIds.includes(s.id)) return false
      if (line.recipeId && s.recipeId !== line.recipeId) return false
      return true
    })
    .sort((a:any,b:any)=>a.expiryDate>b.expiryDate?1:-1)

  return (
    <div className="border rounded-xl bg-background overflow-hidden">
      {/* Nagłówek pozycji */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-muted-foreground">Pozycja {idx+1}</span>
          {line.clientName && (
            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold">
              {clientDisplay(line.clientName)}{line.clientOrderNo?` · ${line.clientOrderNo}`:''}
            </span>
          )}
        </div>
        {total>1 && (
          <Button variant="ghost" size="icon" onClick={onRemove} className="h-6 w-6 text-muted-foreground hover:text-destructive">
            <X size={14}/>
          </Button>
        )}
      </div>

      <div className="p-3">
        {/* Rząd 1: Szt, kg, Rodzaj, Receptura */}
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div>
            <Label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 block">Szt *</Label>
            <Input type="number" min="1" value={line.qty} onChange={e=>onChange('qty',e.target.value)} className="h-8 text-sm px-2"/>
          </div>
          <div>
            <Label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 block">kg *</Label>
            <Input type="number" min="0.1" step="0.1" value={line.kgPerUnit} onChange={e=>onChange('kgPerUnit',e.target.value)} className="h-8 text-sm px-2"/>
          </div>
          <div>
            <Label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 block">Rodzaj</Label>
            <Select value={line.productTypeId||'__none'} onValueChange={v=>onChange('productTypeId',v==='__none'?'':v)}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Dowolny</SelectItem>
                {(productTypes??[]).map((pt:any)=><SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 block">Receptura *</Label>
            <Select value={line.recipeId||'__none'} onValueChange={v=>{const val=v==='__none'?'':v;onChange('recipeId',val);onChange('seasonedBatchIds',[]);onChange('seasonedBatchId','')}}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="Wybierz..."/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Wybierz...</SelectItem>
                {(recipes??[]).map((r:any)=><SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Rząd 2: Tuleja, Klient */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <Label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 block">Tuleja / Opakowanie</Label>
            <Select value={line.packagingId||'__none'} onValueChange={v=>onChange('packagingId',v==='__none'?'':v)}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— brak —</SelectItem>
                {packaging.map((p:any)=>{
                  const isLow = qty>0&&p.kgAvailable<100&&qty>p.kgAvailable
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.kgAvailable<100?` (${p.kgAvailable} szt)`:''}{isLow?' ⚠':''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 block">Klient</Label>
            <Select value={line.clientId||'__none'} onValueChange={v=>{
              const id = v==='__none'?'':v
              const c = clients.find((x:any)=>x.id===id)
              onChange('clientId', id)
              onChange('clientName', c?.name??'')
            }}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— brak —</SelectItem>
                {clients.map((c:any)=><SelectItem key={c.id} value={c.id}>{c.displayName || c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Receptura komponentowa: partie dobiera backend per komponent */}
        {recipeComponents(recipes??[], line.recipeId).length>0 ? (
          <div className="border border-violet-200 rounded-lg bg-violet-50/50 px-3 py-2 text-[11px]">
            <span className="font-bold text-violet-700">Kebab komponentowy</span>
            <span className="text-muted-foreground"> — skład: </span>
            {recipeComponents(recipes??[], line.recipeId).map((c,ci)=>(
              <span key={c.materialTypeId} className="font-semibold text-violet-700">
                {ci>0?' + ':''}{c.pct}% {c.materialName}
              </span>
            ))}
            <span className="text-muted-foreground"> · partie per komponent dobierze system (FEFO), wyrób dostanie partię łączoną np. „120626 355/356"</span>
          </div>
        ) : (
        <div className="border rounded-lg overflow-hidden">
          <button onClick={()=>setShowBatchPanel(p=>!p)}
            className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold transition-colors ${
              selIds.length>0
                ? isOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                : 'bg-muted text-muted-foreground'
            }`}>
            <span className="flex items-center gap-2">
              <span>Partie mięsa (receptura: {line.recipeId?(recipes??[]).find((r:any)=>r.id===line.recipeId)?.name??'—':'nie wybrano'})</span>
              {selIds.length>0 && (
                <span className="font-bold">
                  · {selIds.length} parti{selIds.length===1?'a':selIds.length<5?'e':'i'}
                  · {fmtKg(selKgAvail,0)} kg
                  {!isOk && <span className="text-red-600 ml-1">⚠ brakuje {fmtKg(shortfall,0)} kg</span>}
                </span>
              )}
              {selIds.length===0&&totalKgLine>0&&<span className="text-amber-600 font-bold">· potrzeba {fmtKg(totalKgLine,0)} kg</span>}
            </span>
            {showBatchPanel?<ChevronUp size={13}/>:<ChevronDown size={13}/>}
          </button>

          {showBatchPanel && (
            <div className="border-t">
              {relevantBatches.length===0 ? (
                <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                  {line.recipeId ? 'Brak mięsa tej receptury w magazynie' : 'Wybierz recepturę aby zobaczyć dostępne partie'}
                </div>
              ) : (
                <div className="divide-y max-h-48 overflow-y-auto">
                  {relevantBatches.map((s:any)=>{
                    const isSel    = selIds.includes(s.id)
                    const maxSzt   = kgPerUnit>0 ? Math.floor(s.kgAvailLive/kgPerUnit) : 0
                    const isLow    = maxSzt<qty && maxSzt>0
                    const isEmpty  = s.kgAvailLive<=0.01
                    return (
                      <label key={s.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${isSel?'bg-blue-50':''} ${isEmpty&&!isSel?'opacity-40':''}`}>
                        <input type="checkbox" checked={isSel} onChange={()=>toggleBatch(s.id)}
                          disabled={isEmpty&&!isSel}
                          className="w-4 h-4 accent-primary flex-shrink-0"/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-primary text-[12px]">{s.batchNo}</span>
                            {s.materialName && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                                s.materialTypeId==='mat-filet-kurczak'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-50 text-blue-700'}`}>
                                {s.materialName}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground">{s.recipeName}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] mt-0.5">
                            <span className={`font-bold ${isEmpty?'text-red-500':isSel?'text-blue-700':'text-green-700'}`}>
                              {fmtKg(s.kgAvailLive)} kg dostępne
                            </span>
                            {kgPerUnit>0&&!isEmpty&&(
                              <span className={`font-semibold ${isLow?'text-amber-600':'text-muted-foreground'}`}>
                                = max {maxSzt} szt{isLow?` (z ${qty} zamówionych)`:''}
                              </span>
                            )}
                            <span className="text-muted-foreground text-[10px]">do: {fmtDatePl(s.expiryDate)}</span>
                          </div>
                        </div>
                        {isSel&&<span className="text-blue-600 font-bold text-[11px] flex-shrink-0">✓</span>}
                      </label>
                    )
                  })}
                </div>
              )}
              {/* Status sumy */}
              {selIds.length>0&&qty>0&&kgPerUnit>0&&(
                <div className={`px-3 py-2 border-t text-[11px] font-semibold flex items-center gap-1.5 ${isOk?'bg-green-50 text-green-700':'bg-red-50 text-red-600'}`}>
                  {isOk
                    ? <>✓ Wystarczy — {fmtKg(selKgAvail,0)} kg na {qty} szt × {kgPerUnit} kg</>
                    : <><AlertTriangle size={12}/>Brakuje {fmtKg(shortfall,0)} kg — zaznacz więcej partii</>
                  }
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Suma pozycji */}
        {totalKgLine>0&&(
          <div className="mt-2 flex justify-end">
            <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1 rounded">
              = {fmtKg(totalKgLine,0)} kg
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Formularz planu ──────────────────────────────────────────
interface PlanFormProps {
  onSave:        (lines: CreatePlanLineDto[], date: string) => Promise<string>
  onClose:       () => void
  initialPlan?:  ProductionPlan   // gdy edycja
  existingPlans?: ProductionPlan[] // do ostrzeżenia "jeden dzień = jeden plan"
}

function PlanForm({ onSave, onClose, initialPlan, existingPlans }: PlanFormProps) {
  const clientDisplay = useClientNames()
  const { data: orders }      = useApi(() => clientOrdersApi.list('confirmed'))
  const { data: seasonedRaw } = useApi(() => seasonedMeatApi.list())
  const { data: pkgList }     = useApi(() => packagingApi.list())
  const { data: clientList }  = useApi(() => clientsApi.list())
  const { productTypes }      = useProductTypes()
  const { recipes }           = useRecipes()

  const [planDate,    setPlanDate]    = useState(initialPlan?.planDate ?? todayIso())
  const [lines,       setLines]       = useState<PlanLineForm[]>(
    initialPlan?.lines.map(l => ({
      qty:              String(l.qty),
      kgPerUnit:        String(l.kgPerUnit),
      productTypeId:    l.productTypeId ?? '',
      recipeId:         l.recipeId,
      packagingId:      l.packagingId ?? '',
      clientId:         '',
      clientName:       l.clientName ?? '',
      seasonedBatchIds: (l as any).seasonedBatchNos?.length > 0
        ? ((l as any).seasonedBatchIds ?? [])
        : (l.seasonedBatchId ? [l.seasonedBatchId] : []),
      seasonedBatchId:   l.seasonedBatchId ?? '',
      clientOrderId:     l.clientOrderId ?? '',
      clientOrderNo:     l.clientOrderNo ?? '',
      clientOrderLineId: (l as any).clientOrderLineId ?? '',
    })) ?? []
  )
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [importModal,  setImportModal]  = useState(false)
  const [expandedLine, setExpandedLine] = useState<number|null>(null)

  const confirmed = (orders??[]).filter(o=>o.status==='confirmed')
  const packaging = pkgList??[]
  const clients   = (clientList??[]).filter((c:any)=>c.active)

  // ── Żywe zużycie mięsa — zachłannie, partia po partii (FEFO) ──
  const seasonedUsed = useMemo(() => computeUsage(lines, seasonedRaw??[]), [lines, seasonedRaw])

  const seasonedAvail = useMemo(() =>
    (seasonedRaw??[]).map((s:any) => ({
      ...s,
      kgAvailLive: Math.max(0, (s.kgFree ?? s.kgAvailable) - (seasonedUsed[s.id]??0)),
    }))
  , [seasonedRaw, seasonedUsed])

  const totalKg = lines.reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.kgPerUnit)||0), 0)

  // Wolne kg per receptura (po odjęciu rezerwacji bieżącego formularza) —
  // dla wskaźnika "czy starczy mięsa" w modalu importu zamówień
  const meatFreeByRecipe = useMemo(() => {
    const m: Record<string, number> = {}
    seasonedAvail.forEach((s:any) => {
      m[s.recipeId] = (m[s.recipeId] ?? 0) + Math.max(0, s.kgAvailLive ?? 0)
    })
    return m
  }, [seasonedAvail])

  // Auto-assign FEFO — proporcjonalnie z puli partii
  function autoAssignRecipe(recipeId: string) {
    const available = seasonedAvail
      .filter((s:any) => s.recipeId===recipeId && s.kgAvailLive>0)
      .sort((a:any,b:any) => a.expiryDate>b.expiryDate?1:-1)
    if (available.length===0) return

    setLines(prev => {
      const pool = available.map((s:any)=>({ id:s.id, rem:s.kgAvailLive }))
      return prev.map(line => {
        if (line.recipeId !== recipeId) return line
        const qty = parseFloat(line.qty)||0
        const kgPu = parseFloat(line.kgPerUnit)||0
        if (qty<=0||kgPu<=0) return line
        const hasBatches = (line.seasonedBatchIds?.length>0)||line.seasonedBatchId
        if (hasBatches) return line

        const needed  = qty*kgPu
        let stillNeed = needed
        const assigned: string[] = []

        for (const b of pool) {
          if (stillNeed<=0) break
          if (b.rem<=0.01) continue
          const take = Math.min(stillNeed, b.rem)
          b.rem    -= take
          stillNeed-= take
          assigned.push(b.id)
        }

        if (assigned.length===0) return line
        return { ...line, seasonedBatchIds:assigned, seasonedBatchId:assigned[0] }
      })
    })
  }

  function setLine(i: number, k: keyof PlanLineForm, v: any) {
    setLines(p=>p.map((l,j)=>j===i?{...l,[k]:v}:l))
  }
  function removeLine(i: number) {
    setLines(p=>p.filter((_,j)=>j!==i))
    setExpandedLine(null)
  }

  // Nowe pozycje (z paska szybkiego dodawania lub importu) dostają
  // od razu automatyczny przydział partii FEFO.
  function addCommittedLines(newLines: PlanLineForm[]) {
    setLines(p=>[...p, ...autoAssignNewLines(newLines, p, seasonedRaw??[])])
  }

  async function handleSave(toProduction: boolean) {
    const valid = lines.filter(l=>l.recipeId&&parseFloat(l.qty)>0&&parseFloat(l.kgPerUnit)>0)
    if (valid.length===0) { setError('Dodaj przynajmniej jedną pozycję z recepturą i kg'); return }

    // Walidacja mięsa — zawsze (zarówno dla szkicu jak i produkcji).
    // System NIE pozwala utworzyć planu z niedoborem mięsa, bo wtedy nadałby
    // numer planu PP-... i częściowo zarezerwował magazyn.
    const shortfalls: string[] = []
    valid.forEach(l => {
      const idx = lines.indexOf(l)
      const needed = parseFloat(l.qty) * parseFloat(l.kgPerUnit)
      if (needed <= 0) return
      const ids = l.seasonedBatchIds?.length>0 ? l.seasonedBatchIds : (l.seasonedBatchId?[l.seasonedBatchId]:[])
      const recipeName = (recipes??[]).find((r:any)=>r.id===l.recipeId)?.name ?? l.recipeId

      // Receptura komponentowa — partie dobiera backend; sprawdź tylko
      // dostępność wolnych kg per komponent (rodzaj mięsa)
      const comps = recipeComponents(recipes??[], l.recipeId)
      if (comps.length > 0) {
        const qty = parseFloat(l.qty) || 0
        const kgPu = parseFloat(l.kgPerUnit) || 0
        componentAvailability(comps, qty, kgPu, seasonedRaw??[]).forEach(c => {
          if (!c.ok) {
            shortfalls.push(
              `„${recipeName}": komponent ${c.materialName} (${c.pct}%) — potrzeba ${c.need.toFixed(0)} kg, wolne ${c.free.toFixed(0)} kg`
            )
          }
        })
        return
      }

      if (ids.length === 0) {
        if (toProduction) {
          shortfalls.push(`„${recipeName}": brak przydzielonych partii mięsa`)
        }
        return
      }

      const avail = computeSelKgAvailForLine(idx, lines, seasonedRaw??[])
      if (avail < needed - 0.1) {
        const short = needed - avail
        shortfalls.push(`„${recipeName}": potrzeba ${needed.toFixed(0)} kg, dostępne ${avail.toFixed(0)} kg — brakuje ${short.toFixed(0)} kg`)
      }
    })

    if (shortfalls.length > 0) {
      setError(
        (toProduction ? 'Nie można wysłać do produkcji — niewystarczająca ilość mięsa:\n' : 'Nie można zapisać — niewystarczająca ilość mięsa:\n')
        + shortfalls.map(s => '• ' + s).join('\n')
      )
      return
    }

    setSaving(true)
    try {
      const planId = await onSave(valid.map(l=>({
        qty:           parseFloat(l.qty),
        kgPerUnit:     parseFloat(l.kgPerUnit),
        productTypeId: l.productTypeId||'',
        recipeId:      l.recipeId,
        packagingId:   l.packagingId||undefined,
        seasonedBatchId:  l.seasonedBatchIds[0]||l.seasonedBatchId||undefined,
        seasonedBatchIds: l.seasonedBatchIds?.length>0 ? l.seasonedBatchIds : (l.seasonedBatchId?[l.seasonedBatchId]:undefined),
        clientOrderId:     l.clientOrderId    ||undefined,
        clientOrderNo:     l.clientOrderNo    ||undefined,
        clientOrderLineId: l.clientOrderLineId||undefined,
        clientName:        l.clientName       ||undefined,
      })), planDate)

      if (toProduction) {
        try {
          await productionPlansApi.updateStatus(planId, 'active')
        } catch(e) {
          setError(`Plan zapisany jako szkic. Błąd aktywacji: ${e instanceof Error?e.message:'Niewystarczająca ilość mięsa'}`)
          setSaving(false)
          return
        }
      }
      onClose()
    } catch(e){ setError(e instanceof Error?e.message:'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 max-h-[85vh] overflow-y-auto pr-1">
      {/* Data + import */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Data produkcji</Label>
          <Input type="date" value={planDate} onChange={e=>setPlanDate(e.target.value)} className="h-9 w-auto text-sm"/>
        </div>
        {confirmed.length>0&&(
          <Button variant="outline" onClick={()=>setImportModal(true)} className="h-9 gap-1.5 text-sm">
            <Download size={14}/> Importuj z zamówienia ({confirmed.length})
          </Button>
        )}
      </div>

      {/* Jeden dzień = jeden plan produkcji — ostrzeż przy duplikacie daty */}
      {(() => {
        const dup = (existingPlans ?? []).find(p =>
          p.planDate === planDate && p.status !== 'cancelled' && p.id !== initialPlan?.id)
        return dup ? (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg flex items-center gap-2">
            <AlertTriangle size={13} className="flex-shrink-0"/>
            <span>
              Na {fmtDatePl(planDate)} istnieje już plan <strong className="font-mono">{dup.planNo}</strong>
              {' '}({STATUS_LABELS[dup.status]}). Zwykle jeden dzień = jeden plan produkcji —
              rozważ edycję istniejącego zamiast tworzenia drugiego.
            </span>
          </div>
        ) : null
      })()}

      {/* Panel mięsa */}
      <MeatPanel seasonedAvail={seasonedAvail} seasonedUsed={seasonedUsed} onAutoAssign={autoAssignRecipe}/>

      {/* Pozycje — pasek szybkiego dodawania + zwarta lista */}
      <div>
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Pozycje produkcyjne</div>
        <PlanLineQuickAdd
          onAdd={l=>addCommittedLines([l])}
          productTypes={productTypes??[]} recipes={recipes??[]}
          packaging={packaging} clients={clients}
          meatFreeByRecipe={meatFreeByRecipe}/>
        {lines.length===0 ? (
          <div className="rounded-lg border border-dashed py-5 text-center text-xs text-muted-foreground mt-2">
            Brak pozycji — dodaj pierwszą powyżej (Enter) lub zaimportuj z zamówienia
          </div>
        ) : (
          <div className="rounded-lg border bg-background divide-y mt-2">
            {lines.map((line,i)=>{
              const qty    = parseFloat(line.qty)||0
              const kgPu   = parseFloat(line.kgPerUnit)||0
              const tkg    = qty*kgPu
              const ids    = line.seasonedBatchIds?.length>0 ? line.seasonedBatchIds : (line.seasonedBatchId?[line.seasonedBatchId]:[])
              const avail  = ids.length>0 ? computeSelKgAvailForLine(i, lines, seasonedRaw??[]) : 0
              const meatOk = ids.length>0 && avail >= tkg-0.1
              const preview = meatOk ? computeAllocPreview(i, lines, seasonedRaw??[]) : null
              const mixedPcs = preview?.mixedPieces ?? 0
              // Receptura komponentowa: partie dobierze backend per komponent
              const comps = recipeComponents(recipes??[], line.recipeId)
              const compAvail = comps.length>0 ? componentAvailability(comps, qty, kgPu, seasonedRaw??[]) : []
              const compOk = compAvail.length>0 && compAvail.every(c=>c.ok)
              const isExp  = expandedLine===i
              const rcName = (recipes??[]).find((r:any)=>r.id===line.recipeId)?.name ?? '—'
              const ptName = (productTypes??[]).find((pt:any)=>pt.id===line.productTypeId)?.name
              const pkName = packaging.find((p:any)=>p.id===line.packagingId)?.name
              return (
                <div key={i}>
                  <div
                    className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={()=>setExpandedLine(isExp?null:i)}
                  >
                    <span className="w-5 text-center text-muted-foreground font-medium">{i+1}</span>
                    <span className="tabular-nums font-bold whitespace-nowrap">{line.qty||0}× {line.kgPerUnit||0}kg</span>
                    <span className="flex-1 truncate min-w-0">
                      {ptName ? <>{ptName} <span className="text-muted-foreground">/</span> </> : null}{rcName}
                      {pkName && <span className="text-muted-foreground"> · {pkName}</span>}
                      {line.clientName && (
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold ml-1.5">
                          {clientDisplay(line.clientName)}{line.clientOrderNo?` · ${line.clientOrderNo}`:''}
                        </span>
                      )}
                    </span>
                    {/* Status mięsa pozycji */}
                    {comps.length>0 ? (
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold border whitespace-nowrap ${
                        compOk
                          ? 'bg-violet-50 text-violet-700 border-violet-200'
                          : 'bg-red-50 text-red-600 border-red-200'
                      }`}>
                        {compOk
                          ? `✓ skład ${comps.map(c=>c.pct).join('/')}`
                          : `brak: ${compAvail.find(c=>!c.ok)?.materialName ?? 'komponentu'}`}
                      </span>
                    ) : (
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold border whitespace-nowrap ${
                        ids.length===0
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : meatOk
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-red-50 text-red-600 border-red-200'
                      }`}>
                        {ids.length===0
                          ? 'bez partii'
                          : meatOk
                            ? `✓ ${ids.length} part.${mixedPcs>0 ? ` · ${mixedPcs} szt PM` : ''}`
                            : `brak ${fmtKg(tkg-avail,0)} kg`}
                      </span>
                    )}
                    <span className="font-bold text-blue-700 tabular-nums whitespace-nowrap">{fmtKg(tkg,0)} kg</span>
                    <span className="text-muted-foreground flex-shrink-0">
                      {isExp ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </span>
                    <button
                      onClick={e=>{e.stopPropagation();removeLine(i)}}
                      title="Usuń pozycję"
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                  {/* Skład komponentowy: potrzeby vs wolne kg per rodzaj mięsa */}
                  {comps.length>0 && tkg>0 && (
                    <div className="px-3 pb-1.5 -mt-0.5 pl-10 text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="uppercase font-semibold tracking-wide">Skład:</span>
                      {compAvail.map(c=>(
                        <span key={c.materialTypeId} className={`font-semibold ${c.ok?'':'text-red-600'}`}>
                          {c.pct}% {c.materialName} ({fmtKg(c.need,0)} kg / wolne {fmtKg(c.free,0)} kg)
                        </span>
                      ))}
                      <span className="text-violet-700">· partie dobierze system (FEFO)</span>
                    </div>
                  )}
                  {/* Podgląd: ile sztuk z której partii (+ skład sztuki PM) */}
                  {preview && (preview.clean.length>0 || preview.mixedPieces>0) && (
                    <div className="px-3 pb-1.5 -mt-0.5 pl-10 text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="uppercase font-semibold tracking-wide">Rozbicie:</span>
                      {preview.clean.map(c=>(
                        <span key={c.batchNo} className="font-semibold">
                          {c.pieces}× <span className="font-mono text-foreground">{c.batchNo}</span>
                        </span>
                      ))}
                      {preview.mixedPieces>0 && (
                        <span className="font-semibold text-violet-700">
                          {preview.mixedPieces}× PM ({preview.mixedParts.map(p=>`${fmtKg(p.kg)} kg ${p.batchNo}`).join(' + ')})
                        </span>
                      )}
                    </div>
                  )}
                  {/* Szczegóły pozycji — pełny edytor z partiami mięsa */}
                  {isExp && (
                    <div className="px-3 pb-3 pt-1 bg-muted/30 border-t">
                      <LineFormRow line={line} idx={i} total={1}
                        lines={lines}
                        productTypes={productTypes??[]} recipes={recipes??[]}
                        packaging={packaging} clients={clients}
                        seasonedAvail={seasonedAvail} seasonedUsed={seasonedUsed}
                        seasonedRaw={seasonedRaw??[]}
                        onChange={(k,v)=>setLine(i,k,v)}
                        onRemove={()=>removeLine(i)}/>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Suma */}
      <Card>
        <CardContent className="p-3 flex items-center justify-between">
          <span className="text-[12px] font-bold text-muted-foreground">SUMA PLANU:</span>
          <div className="text-xl font-black text-primary">{fmtKg(totalKg,0)} kg</div>
        </CardContent>
      </Card>

      {error && (
        <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded flex items-start gap-2 whitespace-pre-line">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1">Anuluj</Button>
        <Button variant="outline" onClick={()=>handleSave(false)} disabled={saving}
          className="flex-1 text-slate-700 border-slate-300 hover:bg-slate-50">
          {saving && <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mr-2"/>}
          Zapisz szkic
        </Button>
        <Button onClick={()=>handleSave(true)} disabled={saving}
          className="flex-1 bg-amber-600 hover:bg-amber-700">
          {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"/>}
          <Factory size={14} className="mr-1.5"/>Do produkcji
        </Button>
      </div>

      <Dialog open={importModal} onOpenChange={open=>!open&&setImportModal(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import z zamówienia klienta</DialogTitle>
          </DialogHeader>
          <ImportOrderModal orders={confirmed} meatFreeByRecipe={meatFreeByRecipe} onImport={addCommittedLines} onClose={()=>setImportModal(false)}/>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Strona główna ────────────────────────────────────────────
export function ProductionPlanningPage() {
  const clientDisplay = useClientNames()
  const { data: plans, loading, refetch } = useApi(()=>productionPlansApi.list())
  const [modal,    setModal]    = useState(false)
  const [editPlan, setEditPlan] = useState<ProductionPlan|null>(null)
  const [expanded, setExpanded] = useState<string|null>(null)
  const navigate = useNavigate()
  const [generatingLine, setGeneratingLine] = useState<string|null>(null)
  const [reprintLine, setReprintLine] = useState<ReprintLine|null>(null)

  async function handleCreate(lines: CreatePlanLineDto[], planDate: string): Promise<string> {
    const plan = await productionPlansApi.create({ planDate, lines })
    refetch()
    return plan.id
  }

  async function handleUpdate(lines: CreatePlanLineDto[], planDate: string): Promise<string> {
    if (!editPlan) return ''
    const plan = await productionPlansApi.update(editPlan.id, { planDate, lines })
    refetch()
    return plan.id
  }

  async function handleGenerateLabels(planId: string, line: ProductionPlanLine) {
    setGeneratingLine(line.id)
    try {
      await finishedUnitsApi.generateFromPlanLine(line.id)
    } catch {
      // Ignoruj błąd — często jednostki już istnieją; i tak przechodzimy do druku
    }
    setGeneratingLine(null)
    const params = new URLSearchParams({ planLineId: line.id })
    if (line.clientName) params.set('clientId', line.clientName)
    if (line.recipeId)   params.set('recipeId', line.recipeId)
    navigate(`/etykiety/druk?${params.toString()}`)
  }

  // Etykiety Zebra w planowaniu produkcji tymczasowo wyłączone (do dopracowania) —
  // zostają same etykiety PDF. Trasa /etykiety/zebra i handler nadal istnieją.

  const activePlans = (plans??[]).filter(p=>p.status!=='done'&&p.status!=='cancelled')

  return (
    <div className="space-y-4 animate-fade-in">
      <UnitReprintModal
        line={reprintLine}
        open={!!reprintLine}
        onClose={() => setReprintLine(null)}
      />
      <div className="flex gap-3">
        <div className="grid grid-cols-2 gap-3 flex-1">
          {[
            { label:'Planowane kg', val:`${fmtKg(activePlans.reduce((s,p)=>s+p.totalKg,0),0)} kg` },
            { label:'Planowane szt', val:`${activePlans.reduce((s,p)=>s+p.totalUnits,0)} szt` },
          ].map(k=>(
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className="text-xl font-bold">{k.val}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex items-start">
          <Button onClick={()=>setModal(true)} className="gap-1.5"><Plus size={14}/>Nowy plan</Button>
        </div>
      </div>

      <MeatStockOverview/>

      <Card>
        <div className="px-4 py-2.5 border-b">
          <span className="text-[13px] font-semibold">{(plans??[]).length} planów</span>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {[1,2,3].map(i=><Skeleton key={i} className="h-14 w-full"/>)}
          </div>
        ) : (plans??[]).length===0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Factory size={32}/>
            <div className="font-semibold">Brak planów</div>
            <div className="text-sm">Utwórz plan</div>
          </div>
        ) : (
          <div className="divide-y">
            {(plans??[]).map(plan=>{
              const isExp=expanded===plan.id
              return (
                <div key={plan.id}>
                  <div className="px-4 py-3 flex items-center gap-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={()=>setExpanded(isExp?null:plan.id)}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-primary">{plan.planNo}</span>
                        {(() => {
                          // Dla planów 'done' liczymy procent ukończenia
                          // z qty_done na liniach planu — żeby biuro widziało
                          // czy plan zamknięty w 100% czy częściowo.
                          if (plan.status !== 'done') {
                            return (
                              <Badge variant="outline" className={STATUS_CLASS[plan.status]}>
                                {STATUS_LABELS[plan.status]}
                              </Badge>
                            )
                          }
                          const totalQty = plan.lines.reduce((s,l) => s + Number(l.qty || 0), 0)
                          const doneQty  = plan.lines.reduce((s,l) => s + Number((l as any).qtyDone || 0), 0)
                          const pct = totalQty > 0 ? Math.round((doneQty / totalQty) * 100) : 0
                          if (pct >= 100) {
                            return (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                Ukończony 100%
                              </Badge>
                            )
                          }
                          if (pct === 0) {
                            return (
                              <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                                Zamknięty (bez produkcji)
                              </Badge>
                            )
                          }
                          return (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                              Ukończony częściowo · {pct}%
                            </Badge>
                          )
                        })()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmtDatePl(plan.planDate)} · {plan.lines.length} poz. · {fmtKg(plan.totalKg,0)} kg · {plan.totalUnits} szt
                        {plan.status === 'done' && (() => {
                          const doneQty = plan.lines.reduce((s,l) => s + Number((l as any).qtyDone || 0), 0)
                          const doneKg  = plan.lines.reduce((s,l) => s + Number((l as any).qtyDone || 0) * Number(l.kgPerUnit || 0), 0)
                          if (doneQty === plan.totalUnits) return null
                          return <span className="text-green-700 font-semibold"> · wyprodukowano {doneQty} szt / {fmtKg(doneKg,0)} kg</span>
                        })()}
                      </div>
                    </div>
                    <div className="flex gap-1 items-center">
                      {plan.status==='draft'&&(
                        <>
                          <Button variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={e=>{e.stopPropagation();setEditPlan(plan)}}>
                            <Pencil size={13}/>
                          </Button>
                          <Button variant="outline" size="sm"
                            className="h-7 text-[11px] text-amber-700 border-amber-200 hover:bg-amber-50"
                            onClick={async e=>{
                              e.stopPropagation()
                              try {
                                await productionPlansApi.updateStatus(plan.id,'active')
                                refetch()
                              } catch(err) {
                                alert(err instanceof Error ? err.message : 'Niewystarczająca ilość mięsa — dostosuj plan przed aktywacją')
                              }
                            }}>
                            Aktywuj
                          </Button>
                        </>
                      )}
                      {plan.status==='active' && (plan as any).tabletFinishedAt && !(plan as any).officeConfirmedAt && (
                        <>
                          <Badge variant="warning" className="text-[10px] gap-1 mr-1">
                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Do potwierdzenia
                          </Badge>
                          <Button variant="default" size="sm"
                            className="h-7 text-[11px] bg-green-600 hover:bg-green-700 text-white"
                            onClick={async e=>{
                              e.stopPropagation()
                              if (!confirm(`Potwierdzić zakończenie planu ${plan.planNo}? Kebab trafi do magazynu wyrobów gotowych.`)) return
                              try {
                                await productionPlansApi.officeConfirm(plan.id)
                                refetch()
                              } catch(err) {
                                alert(err instanceof Error ? err.message : 'Błąd potwierdzenia')
                              }
                            }}>
                            Potwierdź
                          </Button>
                        </>
                      )}
                      {plan.status==='active' && !(plan as any).tabletFinishedAt && (
                        <Button variant="outline" size="sm"
                          className="h-7 text-[11px] text-muted-foreground border-surface-4 hover:bg-surface-2"
                          onClick={async e=>{
                            e.stopPropagation()
                            if (!confirm(`Anulować plan ${plan.planNo}? Rezerwacje mięsa zostaną zwolnione, a plan nie będzie liczony jako wykonany.`)) return
                            await productionPlansApi.updateStatus(plan.id,'cancelled')
                            refetch()
                          }}>
                          Anuluj
                        </Button>
                      )}
                      {isExp?<ChevronUp size={16} className="text-muted-foreground"/>:<ChevronDown size={16} className="text-muted-foreground"/>}
                    </div>
                  </div>
                  {isExp&&(
                    <div className="px-4 pb-3 bg-muted/30 border-t overflow-x-auto">
                      <Table className="text-[11px] mt-2">
                        <TableHeader>
                          <TableRow>
                            {['Szt','Wykonano','kg','Razem','Receptura','Tuleja','Partie mięsa','Klient',''].map(h=>(
                              <TableHead key={h} className="text-[9px] uppercase tracking-wider h-7 px-3">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plan.lines.map(l=>{
                            const qtyDone = Number((l as any).qtyDone || 0)
                            const lineStatus = ((l as any).lineStatus || 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE'
                            const pct = l.qty > 0 ? Math.round((qtyDone / l.qty) * 100) : 0
                            return (
                            <TableRow key={l.id}>
                              <TableCell className="py-1.5 font-bold px-3">{l.qty}</TableCell>
                              <TableCell className="py-1.5 px-3">
                                {qtyDone === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : pct >= 100 ? (
                                  <span className="font-bold text-green-700">{qtyDone} / {l.qty} ✓</span>
                                ) : (
                                  <span className="font-bold text-amber-700">{qtyDone} / {l.qty} <span className="text-[10px] font-medium">({pct}%)</span></span>
                                )}
                                {lineStatus === 'IN_PROGRESS' && <Badge variant="outline" className="ml-1 text-[9px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200">w trakcie</Badge>}
                              </TableCell>
                              <TableCell className="py-1.5 px-3">{l.kgPerUnit} kg</TableCell>
                              <TableCell className="py-1.5 font-bold text-primary px-3">{fmtKg(l.totalKg,0)} kg</TableCell>
                              <TableCell className="py-1.5 px-3">{l.recipeName}</TableCell>
                              <TableCell className="py-1.5 text-muted-foreground px-3">{l.packagingName||'—'}</TableCell>
                              <TableCell className="py-1.5 px-3">
                                {(() => {
                                  // Rozbicie z batch_allocation: "349 ×19" + fioletowy
                                  // badge PM ze składem; fallback na same numery partii.
                                  const ba = ((l as any).batchAllocation ?? {}) as Record<string, any>
                                  const isMixedKey = (k:string) => k === '__MIXED__' || /^PM\d+$/.test(k)
                                  const entries = Object.entries(ba)
                                    .filter(([,a]) => (a?.pieces ?? 0) > 0)
                                    .sort(([k1],[k2]) => Number(isMixedKey(k1)) - Number(isMixedKey(k2)))
                                  if (entries.length > 0) {
                                    return (
                                      <div className="flex gap-1 flex-wrap">
                                        {entries.map(([k, a]) => {
                                          const mixed = isMixedKey(k)
                                          const label = k === '__MIXED__' ? 'PM' : k
                                          const title = mixed && a.parts
                                            ? Object.entries(a.parts as Record<string, any>)
                                                .map(([p, v]) => `${fmtKg(v?.kg ?? 0)} kg z ${p}`)
                                                .join(' + ')
                                            : undefined
                                          return (
                                            <Badge key={k} variant="outline" title={title}
                                              className={`font-mono text-[10px] h-5 ${mixed
                                                ? 'text-violet-700 bg-violet-50 border-violet-200'
                                                : 'text-green-700 bg-green-50 border-green-200'}`}>
                                              {label} ×{a.pieces}
                                            </Badge>
                                          )
                                        })}
                                      </div>
                                    )
                                  }
                                  return (l as any).seasonedBatchNos?.length>0
                                    ? <div className="flex gap-1 flex-wrap">
                                        {(l as any).seasonedBatchNos.map((n:string)=>(
                                          <Badge key={n} variant="outline" className="font-mono text-green-700 bg-green-50 border-green-200 text-[10px] h-5">{n}</Badge>
                                        ))}
                                      </div>
                                    : l.seasonedBatchNo
                                      ? <span className="font-mono text-green-700">{l.seasonedBatchNo}</span>
                                      : <span className="text-amber-600">Do przydzielenia</span>
                                })()}
                              </TableCell>
                              <TableCell className="py-1.5 text-muted-foreground text-[10px] px-3">{l.clientName ? clientDisplay(l.clientName) : '—'}</TableCell>
                              <TableCell className="py-1 px-2">
                                {(plan.status === 'active' || plan.status === 'done') && l.recipeId && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={generatingLine === l.id}
                                    className="h-6 text-[10px] px-2 text-violet-700 border-violet-200 hover:bg-violet-50 whitespace-nowrap"
                                    onClick={e => { e.stopPropagation(); handleGenerateLabels(plan.id, l as ProductionPlanLine) }}
                                  >
                                    {generatingLine === l.id
                                      ? <span className="w-3 h-3 border border-violet-300 border-t-violet-700 rounded-full animate-spin mr-1" />
                                      : null}
                                    Etykiety
                                  </Button>
                                )}
                                {(plan.status === 'active' || plan.status === 'done') && l.recipeId && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Dodruk pojedynczej etykiety (awaria druku)"
                                    className="h-6 text-[10px] px-2 ml-1 text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                                    onClick={e => { e.stopPropagation(); setReprintLine({
                                      id: l.id, clientName: l.clientName, recipeId: l.recipeId,
                                      recipeName: l.recipeName, qty: l.qty,
                                    }) }}
                                  >
                                    Dodruk
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          )})}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Dialog open={modal} onOpenChange={open=>!open&&setModal(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nowy plan produkcji</DialogTitle>
          </DialogHeader>
          <PlanForm onSave={handleCreate} onClose={()=>setModal(false)} existingPlans={plans??[]}/>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPlan} onOpenChange={open=>{ if(!open) setEditPlan(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edycja planu {editPlan?.planNo}</DialogTitle>
          </DialogHeader>
          {editPlan && (
            <PlanForm
              initialPlan={editPlan}
              onSave={handleUpdate}
              onClose={()=>setEditPlan(null)}
              existingPlans={plans??[]}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
