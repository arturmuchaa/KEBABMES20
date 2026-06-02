/**
 * ProductionPlanningPage v3
 * - Panel mięsa: zgrupowany per receptura, zwinięty domyślnie
 * - Rezerwacja: proporcjonalna wg pojemności partii (nie równa)
 * - Partie w pozycji: czytelny dropdown zamiast checkboxów
 * - Klient: wybór z listy kontrahentów
 */
import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { productionPlansApi, clientOrdersApi, seasonedMeatApi, packagingApi, clientsApi, finishedUnitsApi } from '@/lib/apiClient'
import type { OrderProductionProgress } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
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
  Download,
  Factory,
  Pencil,
  Plus,
  Square,
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

  let available = 0
  selIds.forEach(id => {
    const s = seasonedRaw.find((x:any)=>x.id===id)
    if (!s) return
    available += Math.max(0, (s.kgFree ?? s.kgAvailable) - (otherUsed[id]??0))
  })
  return available
}

const STATUS_LABELS: Record<ProductionPlan['status'], string> = {
  draft:'Szkic', active:'Aktywny', done:'Ukończony',
}
const STATUS_CLASS: Record<ProductionPlan['status'], string> = {
  draft: '',
  active: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  done: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-50',
}

// ─── Import z zamówień ────────────────────────────────────────
function ImportOrderModal({ orders, onImport, onClose }: {
  orders: ClientOrder[]
  onImport: (lines: PlanLineForm[]) => void
  onClose: () => void
}) {
  const [selectedOrder,   setSelectedOrder]   = useState<string>(orders[0]?.id ?? '')
  const [selectedLines,   setSelectedLines]   = useState<Set<string>>(new Set())
  const [progress,        setProgress]        = useState<OrderProductionProgress | null>(null)
  const [progressLoading, setProgressLoading] = useState(false)

  const order = orders.find(o=>o.id===selectedOrder)

  // Mapa line_id -> {qty_done, qty_pending, qty_remaining}
  const progressMap = useMemo(() => {
    const m: Record<string, { qtyTotal: number; qtyDone: number; qtyPending: number; qtyRemaining: number }> = {}
    progress?.lines.forEach(p => {
      m[p.lineId] = { qtyTotal: p.qtyTotal, qtyDone: p.qtyDone, qtyPending: p.qtyPending, qtyRemaining: p.qtyRemaining }
    })
    return m
  }, [progress])

  function importableLines(o: ClientOrder | undefined): string[] {
    if (!o) return []
    return o.lines.filter(l => (progressMap[l.id]?.qtyRemaining ?? l.qty) > 0).map(l => l.id)
  }

  useEffect(() => {
    if (!selectedOrder) { setProgress(null); return }
    let cancelled = false
    setProgressLoading(true)
    clientOrdersApi.productionProgress(selectedOrder)
      .then(p => { if (!cancelled) { setProgress(p); setProgressLoading(false) } })
      .catch(()  => { if (!cancelled) { setProgress(null); setProgressLoading(false) } })
    return () => { cancelled = true }
  }, [selectedOrder])

  // Po załadowaniu progress: zaznacz wszystkie linie z qty_remaining > 0
  useEffect(() => {
    if (progress) setSelectedLines(new Set(importableLines(order)))
    else if (order) setSelectedLines(new Set(order.lines.map(l=>l.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress])

  function handleOrderChange(id: string) {
    setSelectedOrder(id)
    setSelectedLines(new Set())
  }

  function toggleAll() {
    if (!order) return
    const avail = importableLines(order)
    setSelectedLines(selectedLines.size===avail.length ? new Set() : new Set(avail))
  }

  function handleConfirm() {
    if (!order) return
    const newLines: PlanLineForm[] = order.lines
      .filter(l => selectedLines.has(l.id))
      .map(l => {
        const remaining = progressMap[l.id]?.qtyRemaining ?? l.qty
        return {
          qty:             String(remaining),
          kgPerUnit:       String(l.kgPerUnit),
          productTypeId:   l.productTypeId,
          recipeId:        l.recipeId,
          packagingId:     l.packagingId??'',
          clientId:        order.clientId,
          clientName:      order.clientName,
          seasonedBatchIds:[], seasonedBatchId:'',
          clientOrderId:   order.id,
          clientOrderNo:   order.orderNo,
          clientOrderLineId: l.id,
        }
      })
    onImport(newLines)
    onClose()
  }

  const availCount = order ? importableLines(order).length : 0

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Zamówienie</Label>
        <Select value={selectedOrder} onValueChange={handleOrderChange}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue/>
          </SelectTrigger>
          <SelectContent>
            {orders.map(o=>(
              <SelectItem key={o.id} value={o.id}>
                {o.orderNo} · {o.clientName} · {fmtKg(o.totalKg,0)} kg
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {order && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase">Pozycje</span>
            <Button variant="ghost" size="sm" onClick={toggleAll} disabled={availCount===0} className="h-7 text-[11px] gap-1 px-2">
              {selectedLines.size===availCount && availCount>0
                ? <><Square size={12}/>Odznacz</>
                : <><CheckSquare size={12}/>Zaznacz wszystkie</>}
            </Button>
          </div>
          <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
            {order.lines.map(l=>{
              const p          = progressMap[l.id]
              const qtyDone    = p?.qtyDone    ?? 0
              const qtyPending = p?.qtyPending ?? 0
              const qtyRemain  = p?.qtyRemaining ?? l.qty
              const isFull     = qtyRemain <= 0
              const isPartial  = (qtyDone + qtyPending) > 0 && !isFull
              const isSel      = selectedLines.has(l.id)

              return (
                <label
                  key={l.id}
                  className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
                    isFull
                      ? 'bg-green-50/50 opacity-70 cursor-not-allowed'
                      : `cursor-pointer hover:bg-muted/50 ${isSel?'bg-blue-50':''}`
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    disabled={isFull}
                    onChange={()=>setSelectedLines(prev=>{
                      const n = new Set(prev)
                      n.has(l.id) ? n.delete(l.id) : n.add(l.id)
                      return n
                    })}
                    className="w-4 h-4 accent-primary flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold flex flex-wrap items-center gap-2">
                      <span>{l.qty} szt × {l.kgPerUnit} kg = <span className="text-blue-700">{fmtKg(l.qty*l.kgPerUnit,0)} kg</span></span>
                      {progressLoading && <span className="text-[10px] text-muted-foreground">…</span>}
                      {isFull && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold border border-green-200">
                          ✓ Wyprodukowane
                        </span>
                      )}
                      {isPartial && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-semibold border border-amber-200">
                          do produkcji {qtyRemain} szt
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {l.productTypeName} · {l.recipeName}{l.packagingName?` · ${l.packagingName}`:''}
                    </div>
                    {(qtyDone>0 || qtyPending>0) && (
                      <div className="text-[10px] mt-0.5 flex flex-wrap gap-2">
                        {qtyDone>0 && (
                          <span className="text-green-700 font-semibold">Wyprodukowano: {qtyDone}/{l.qty} szt</span>
                        )}
                        {qtyPending>0 && (
                          <span className="text-amber-600 font-semibold">W toku/planie: {qtyPending} szt</span>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
          {selectedLines.size>0 && (
            <div className="text-[11px] text-primary font-semibold mt-1.5">
              {selectedLines.size} pozycji · {fmtKg(
                order.lines
                  .filter(l=>selectedLines.has(l.id))
                  .reduce((s,l)=>{
                    const q = progressMap[l.id]?.qtyRemaining ?? l.qty
                    return s + q*l.kgPerUnit
                  }, 0),
                0
              )} kg do zaplanowania
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleConfirm} disabled={selectedLines.size===0} className="flex-1">
          <Download size={14} className="mr-1"/> Importuj {selectedLines.size} poz.
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
                    {isFull && <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-semibold">Wszystko zaplanowane</span>}
                  </div>
                  {/* Pasek + liczniki w jednym wierszu */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isFull?'bg-green-500':pct>80?'bg-amber-400':'bg-blue-500'}`}
                        style={{width:`${pct}%`}}/>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] whitespace-nowrap flex-shrink-0">
                      <span className="text-muted-foreground">Total: <strong>{fmtKg(r.totalKg,0)}</strong></span>
                      <span className="text-amber-600">Zapl: <strong>{fmtKg(r.usedKg,0)}</strong></span>
                      <span className={isFull?'text-green-600':'text-blue-700'}>
                        Pozostało: <strong>{fmtKg(r.remainingKg,0)} kg</strong>
                      </span>
                    </div>
                  </div>
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
              {line.clientName}{line.clientOrderNo?` · ${line.clientOrderNo}`:''}
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
                {clients.map((c:any)=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Partie mięsa — rozwijany panel */}
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
  onSave:       (lines: CreatePlanLineDto[], date: string) => Promise<string>
  onClose:      () => void
  initialPlan?: ProductionPlan   // gdy edycja
}

function PlanForm({ onSave, onClose, initialPlan }: PlanFormProps) {
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
    })) ?? [emptyLine()]
  )
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [importModal, setImportModal] = useState(false)

  const confirmed = (orders??[]).filter(o=>o.status==='confirmed')
  const packaging = pkgList??[]
  const clients   = (clientList??[]).filter((c:any)=>c.active)

  // ── Żywe zużycie mięsa — PROPORCJONALNE wg pojemności ──────
  const seasonedUsed = useMemo(() => {
    // Buduj mapę rezerwacji sekwencyjnie, partia po partii (FEFO zachłanne)
    // seasonedUsed[id] = ile kg ZAREZERWOWANO z tej partii przez wszystkie linie
    const map: Record<string, number> = {}

    lines.forEach(l => {
      const needed = (parseFloat(l.qty)||0) * (parseFloat(l.kgPerUnit)||0)
      if (needed <= 0) return
      const ids = l.seasonedBatchIds?.length>0
        ? l.seasonedBatchIds
        : (l.seasonedBatchId ? [l.seasonedBatchId] : [])
      if (ids.length === 0) return

      // Dla każdej zaznaczonej partii: weź min(potrzeba_z_tej_partii, dostępne)
      // "dostępne" = kgAvailable z bazy MINUS co już zarezerwowały poprzednie linie
      let stillNeeded = needed
      ids.forEach(id => {
        if (stillNeeded <= 0) return
        const s = (seasonedRaw??[]).find((x:any)=>x.id===id)
        if (!s) return
        // Ile jeszcze wolne w tej partii po wcześniejszych rezerwacjach
        const alreadyReserved = map[id] ?? 0
        const freeInBatch = Math.max(0, (s.kgFree ?? s.kgAvailable) - alreadyReserved)
        const take = Math.min(stillNeeded, freeInBatch)
        if (take > 0) {
          map[id] = alreadyReserved + take
          stillNeeded -= take
        }
      })
    })
    return map
  }, [lines, seasonedRaw])

  const seasonedAvail = useMemo(() =>
    (seasonedRaw??[]).map((s:any) => ({
      ...s,
      kgAvailLive: Math.max(0, (s.kgFree ?? s.kgAvailable) - (seasonedUsed[s.id]??0)),
    }))
  , [seasonedRaw, seasonedUsed])

  const totalKg = lines.reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.kgPerUnit)||0), 0)

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
  function addLine()          { setLines(p=>[...p,emptyLine()]) }
  function removeLine(i: number) { setLines(p=>p.filter((_,j)=>j!==i)) }

  function importLines(newLines: PlanLineForm[]) {
    setLines(p=>{
      const hasContent = p.some(l=>l.qty||l.productTypeId)
      return hasContent ? [...p,...newLines] : newLines
    })
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

      {/* Panel mięsa */}
      <MeatPanel seasonedAvail={seasonedAvail} seasonedUsed={seasonedUsed} onAutoAssign={autoAssignRecipe}/>

      {/* Pozycje */}
      <div>
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Pozycje produkcyjne</div>
        <div className="space-y-3">
          {lines.map((line,i)=>(
            <LineFormRow key={i} line={line} idx={i} total={lines.length}
              lines={lines}
              productTypes={productTypes??[]} recipes={recipes??[]}
              packaging={packaging} clients={clients}
              seasonedAvail={seasonedAvail} seasonedUsed={seasonedUsed}
              seasonedRaw={seasonedRaw??[]}
              onChange={(k,v)=>setLine(i,k,v)}
              onRemove={()=>removeLine(i)}/>
          ))}
        </div>
        <Button variant="ghost" onClick={addLine} className="mt-2 h-8 gap-1.5 text-[12px] text-primary px-2">
          <Plus size={14}/> Dodaj pozycję
        </Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import z zamówienia klienta</DialogTitle>
          </DialogHeader>
          <ImportOrderModal orders={confirmed} onImport={importLines} onClose={()=>setImportModal(false)}/>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Strona główna ────────────────────────────────────────────
export function ProductionPlanningPage() {
  const { data: plans, loading, refetch } = useApi(()=>productionPlansApi.list())
  const [modal,    setModal]    = useState(false)
  const [editPlan, setEditPlan] = useState<ProductionPlan|null>(null)
  const [expanded, setExpanded] = useState<string|null>(null)
  const navigate = useNavigate()
  const [generatingLine, setGeneratingLine] = useState<string|null>(null)

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

  const activePlans = (plans??[]).filter(p=>p.status!=='done')

  return (
    <div className="space-y-4 animate-fade-in">
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
                            if (!confirm(`Zamknąć plan ${plan.planNo} bez produkcji? Rezerwacje mięsa zostaną zwolnione.`)) return
                            await productionPlansApi.updateStatus(plan.id,'done')
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
                                {(l as any).seasonedBatchNos?.length>0
                                  ? <div className="flex gap-1 flex-wrap">
                                      {(l as any).seasonedBatchNos.map((n:string)=>(
                                        <Badge key={n} variant="outline" className="font-mono text-green-700 bg-green-50 border-green-200 text-[10px] h-5">{n}</Badge>
                                      ))}
                                    </div>
                                  : l.seasonedBatchNo
                                    ? <span className="font-mono text-green-700">{l.seasonedBatchNo}</span>
                                    : <span className="text-amber-600">Do przydzielenia</span>
                                }
                              </TableCell>
                              <TableCell className="py-1.5 text-muted-foreground text-[10px] px-3">{l.clientName||'—'}</TableCell>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nowy plan produkcji</DialogTitle>
          </DialogHeader>
          <PlanForm onSave={handleCreate} onClose={()=>setModal(false)}/>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPlan} onOpenChange={open=>{ if(!open) setEditPlan(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edycja planu {editPlan?.planNo}</DialogTitle>
          </DialogHeader>
          {editPlan && (
            <PlanForm
              initialPlan={editPlan}
              onSave={handleUpdate}
              onClose={()=>setEditPlan(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
