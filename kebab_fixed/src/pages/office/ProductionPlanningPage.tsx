/**
 * ProductionPlanningPage v3
 * - Panel mięsa: zgrupowany per receptura, zwinięty domyślnie
 * - Rezerwacja: proporcjonalna wg pojemności partii (nie równa)
 * - Partie w pozycji: czytelny dropdown zamiast checkboxów
 * - Klient: wybór z listy kontrahentów
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { productionPlansApi, clientOrdersApi, seasonedMeatApi, packagingApi, clientsApi } from '@/lib/apiClient'
import { Spinner, EmptyState, Modal } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtKg, fmtDatePl, todayIso } from '@/lib/utils'
import {
  AlertTriangle,
  BarChart2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Factory,
  Plus,
  Square,
  X,
} from 'lucide-react'
import { useProductTypes } from '@/features/products/hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import type { ProductionPlan, CreatePlanLineDto, ClientOrder } from '@/lib/mockApi'

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
}

const emptyLine = (): PlanLineForm => ({
  qty:'', kgPerUnit:'', productTypeId:'', recipeId:'', packagingId:'',
  clientId:'', clientName:'',
  seasonedBatchIds:[], seasonedBatchId:'',
  clientOrderId:'', clientOrderNo:'',
})

const STATUS_LABELS: Record<ProductionPlan['status'], string> = {
  draft:'Szkic', active:'Aktywny', done:'Ukończony',
}
const STATUS_COLORS: Record<ProductionPlan['status'], string> = {
  draft:'bg-surface-3 text-ink-3', active:'bg-amber-500/15 text-amber-400', done:'bg-green-500/15 text-green-400',
}

// ─── Import z zamówień ────────────────────────────────────────
function ImportOrderModal({ orders, onImport, onClose }: {
  orders: ClientOrder[]
  onImport: (lines: PlanLineForm[]) => void
  onClose: () => void
}) {
  const [selectedOrder, setSelectedOrder] = useState<string>(orders[0]?.id ?? '')
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set(orders[0]?.lines.map(l=>l.id)??[]))

  const order = orders.find(o=>o.id===selectedOrder)

  function handleOrderChange(id: string) {
    setSelectedOrder(id)
    const o = orders.find(x=>x.id===id)
    setSelectedLines(new Set(o?.lines.map(l=>l.id)??[]))
  }

  function toggleAll() {
    if (!order) return
    const avail = order.lines.map(l=>l.id)
    setSelectedLines(selectedLines.size===avail.length ? new Set() : new Set(avail))
  }

  function handleConfirm() {
    if (!order) return
    const newLines: PlanLineForm[] = order.lines
      .filter(l=>selectedLines.has(l.id))
      .map(l=>({
        qty:             String(l.qty),
        kgPerUnit:       String(l.kgPerUnit),
        productTypeId:   l.productTypeId,
        recipeId:        l.recipeId,
        packagingId:     l.packagingId??'',
        clientId:        order.clientId,
        clientName:      order.clientName,
        seasonedBatchIds:[], seasonedBatchId:'',
        clientOrderId:   order.id,
        clientOrderNo:   order.orderNo,
      }))
    onImport(newLines)
    onClose()
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Zamówienie</label>
        <select value={selectedOrder} onChange={e=>handleOrderChange(e.target.value)}
          className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
          {orders.map(o=><option key={o.id} value={o.id}>{o.orderNo} · {o.clientName} · {fmtKg(o.totalKg,0)} kg</option>)}
        </select>
      </div>
      {order && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-ink-3 uppercase">Pozycje</span>
            <button onClick={toggleAll} className="text-[11px] font-semibold text-brand flex items-center gap-1">
              {selectedLines.size===order.lines.length?<><Square size={12}/>Odznacz</>:<><CheckSquare size={12}/>Zaznacz wszystkie</>}
            </button>
          </div>
          <div className="border border-surface-4 rounded-lg divide-y max-h-56 overflow-y-auto">
            {order.lines.map(l=>{
              const isSel = selectedLines.has(l.id)
              return (
                <label key={l.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-2 ${isSel?'bg-blue-50':''}`}>
                  <input type="checkbox" checked={isSel}
                    onChange={()=>setSelectedLines(p=>{const n=new Set(p);n.has(l.id)?n.delete(l.id):n.add(l.id);return n})}
                    className="w-4 h-4 accent-brand flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold text-ink">{l.qty} szt × {l.kgPerUnit} kg = <span className="text-blue-700">{fmtKg(l.qty*l.kgPerUnit,0)} kg</span></div>
                    <div className="text-[11px] text-ink-3">{l.productTypeName} · {l.recipeName}{l.packagingName?` · ${l.packagingName}`:''}</div>
                  </div>
                </label>
              )
            })}
          </div>
          {selectedLines.size>0 && (
            <div className="text-[11px] text-brand font-semibold mt-1.5">
              {selectedLines.size} pozycji · {fmtKg(order.lines.filter(l=>selectedLines.has(l.id)).reduce((s,l)=>s+l.qty*l.kgPerUnit,0),0)} kg
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Anuluj</Button>
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
    byRecipe[s.recipeId].totalKg    += s.kgAvailable
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
                    <span className="text-[12px] font-bold text-ink truncate">{r.recipeName}</span>
                    {isFull && <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded font-semibold">Wszystko zaplanowane</span>}
                  </div>
                  {/* Pasek + liczniki w jednym wierszu */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isFull?'bg-green-500':pct>80?'bg-amber-400':'bg-blue-500'}`}
                        style={{width:`${pct}%`}}/>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] whitespace-nowrap flex-shrink-0">
                      <span className="text-ink-3">Total: <strong>{fmtKg(r.totalKg,0)}</strong></span>
                      <span className="text-amber-600">Zapl: <strong>{fmtKg(r.usedKg,0)}</strong></span>
                      <span className={isFull?'text-green-600':'text-blue-700'}>
                        Pozostało: <strong>{fmtKg(r.remainingKg,0)} kg</strong>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={()=>onAutoAssign(r.recipeId)}
                    className="text-[11px] font-semibold text-blue-700 border border-blue-200 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 active:scale-95">
                    ⚡ Auto
                  </button>
                  <button onClick={()=>setExpandedRecipe(isExpanded?null:r.recipeId)}
                    className="p-1 text-ink-4 hover:text-ink">
                    {isExpanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
                  </button>
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
                          <span className="font-mono font-bold text-brand text-[10px]">{s.batchNo}</span>
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
        const free = Math.max(0, s.kgAvailable - (otherUsed[id]??0))
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
      available += Math.max(0, s.kgAvailable - (otherUsed[id]??0))
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
    <div className="border border-surface-4 rounded-xl bg-white overflow-hidden">
      {/* Nagłówek pozycji */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-ink-3">Pozycja {idx+1}</span>
          {line.clientName && (
            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold">
              {line.clientName}{line.clientOrderNo?` · ${line.clientOrderNo}`:''}
            </span>
          )}
        </div>
        {total>1 && <button onClick={onRemove} className="text-ink-4 hover:text-danger"><X size={14}/></button>}
      </div>

      <div className="p-3">
        {/* Rząd 1: Szt, kg/szt, Rodzaj, Receptura */}
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div>
            <label className="block text-[9px] font-bold text-ink-4 uppercase mb-1">Szt *</label>
            <input type="number" min="1" value={line.qty} onChange={e=>onChange('qty',e.target.value)}
              className="w-full h-8 px-2 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50"/>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-ink-4 uppercase mb-1">kg/szt *</label>
            <input type="number" min="0.1" step="0.1" value={line.kgPerUnit} onChange={e=>onChange('kgPerUnit',e.target.value)}
              className="w-full h-8 px-2 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50"/>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-ink-4 uppercase mb-1">Rodzaj</label>
            <select value={line.productTypeId} onChange={e=>onChange('productTypeId',e.target.value)}
              className="w-full h-8 px-2 text-[11px] border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
              <option value="">Dowolny</option>
              {(productTypes??[]).map((pt:any)=><option key={pt.id} value={pt.id}>{pt.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-ink-4 uppercase mb-1">Receptura *</label>
            <select value={line.recipeId} onChange={e=>{onChange('recipeId',e.target.value);onChange('seasonedBatchIds',[]);onChange('seasonedBatchId','')}}
              className="w-full h-8 px-2 text-[11px] border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
              <option value="">Wybierz...</option>
              {(recipes??[]).map((r:any)=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        {/* Rząd 2: Tuleja, Klient */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="block text-[9px] font-bold text-ink-4 uppercase mb-1">Tuleja / Opakowanie</label>
            <select value={line.packagingId} onChange={e=>onChange('packagingId',e.target.value)}
              className="w-full h-8 px-2 text-[11px] border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
              <option value="">— brak —</option>
              {packaging.map((p:any)=>{
                const isLow = qty>0&&p.kgAvailable<100&&qty>p.kgAvailable
                return <option key={p.id} value={p.id}>{p.name}{p.kgAvailable<100?` (${p.kgAvailable} szt)`:''}{isLow?' ⚠':''}</option>
              })}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-ink-4 uppercase mb-1">Klient</label>
            <select value={line.clientId} onChange={e=>{
              const c = clients.find((x:any)=>x.id===e.target.value)
              onChange('clientId', e.target.value)
              onChange('clientName', c?.name??'')
            }}
              className="w-full h-8 px-2 text-[11px] border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
              <option value="">— brak —</option>
              {clients.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Partie mięsa — rozwijany panel */}
        <div className="border border-surface-4 rounded-lg overflow-hidden">
          <button onClick={()=>setShowBatchPanel(p=>!p)}
            className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold transition-colors ${
              selIds.length>0
                ? isOk ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                : 'bg-surface-2 text-ink-3'
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
            <div className="border-t border-surface-4">
              {relevantBatches.length===0 ? (
                <div className="px-3 py-2.5 text-[11px] text-ink-3">
                  {line.recipeId ? 'Brak mięsa tej receptury w magazynie' : 'Wybierz recepturę aby zobaczyć dostępne partie'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {relevantBatches.map((s:any)=>{
                    const isSel    = selIds.includes(s.id)
                    const maxSzt   = kgPerUnit>0 ? Math.floor(s.kgAvailLive/kgPerUnit) : 0
                    const isLow    = maxSzt<qty && maxSzt>0
                    const isEmpty  = s.kgAvailLive<=0.01
                    return (
                      <label key={s.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2 transition-colors ${isSel?'bg-blue-50':''} ${isEmpty&&!isSel?'opacity-40':''}`}>
                        <input type="checkbox" checked={isSel} onChange={()=>toggleBatch(s.id)}
                          disabled={isEmpty&&!isSel}
                          className="w-4 h-4 accent-brand flex-shrink-0"/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-brand text-[12px]">{s.batchNo}</span>
                            <span className="text-[10px] text-ink-3">{s.recipeName}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] mt-0.5">
                            <span className={`font-bold ${isEmpty?'text-red-500':isSel?'text-blue-700':'text-green-700'}`}>
                              {fmtKg(s.kgAvailLive)} kg dostępne
                            </span>
                            {kgPerUnit>0&&!isEmpty&&(
                              <span className={`font-semibold ${isLow?'text-amber-600':'text-ink-3'}`}>
                                = max {maxSzt} szt{isLow?` (z ${qty} zamówionych)`:''}
                              </span>
                            )}
                            <span className="text-ink-4 text-[10px]">do: {fmtDatePl(s.expiryDate)}</span>
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
                <div className={`px-3 py-2 border-t text-[11px] font-semibold flex items-center gap-1.5 ${isOk?'bg-green-500/15 text-green-400':'bg-red-50 text-red-600'}`}>
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
function PlanForm({ onSave, onClose }: {
  onSave: (lines: CreatePlanLineDto[], date: string) => Promise<void>
  onClose: () => void
}) {
  const { data: orders }      = useApi(() => clientOrdersApi.list('confirmed'))
  const { data: seasonedRaw } = useApi(() => seasonedMeatApi.list())
  const { data: pkgList }     = useApi(() => packagingApi.list())
  const { data: clientList }  = useApi(() => clientsApi.list())
  const { productTypes }      = useProductTypes()
  const { recipes }           = useRecipes()

  const [planDate,    setPlanDate]    = useState(todayIso())
  const [lines,       setLines]       = useState<PlanLineForm[]>([emptyLine()])
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
        const freeInBatch = Math.max(0, s.kgAvailable - alreadyReserved)
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
      kgAvailLive: Math.max(0, s.kgAvailable - (seasonedUsed[s.id]??0)),
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
    setError('')  // kasuj błąd gdy użytkownik cokolwiek zmienia
    setLines(p=>p.map((l,j)=>j===i?{...l,[k]:v}:l))
  }
  function addLine()          { setError(''); setLines(p=>[...p,emptyLine()]) }
  function removeLine(i: number) { setError(''); setLines(p=>p.filter((_,j)=>j!==i)) }

  function importLines(newLines: PlanLineForm[]) {
    setLines(p=>{
      const hasContent = p.some(l=>l.qty||l.productTypeId)
      return hasContent ? [...p,...newLines] : newLines
    })
  }

  async function handleSave() {
    const valid = lines.filter(l=>l.recipeId&&parseFloat(l.qty)>0&&parseFloat(l.kgPerUnit)>0)
    if (valid.length===0) { setError('Dodaj przynajmniej jedną pozycję z recepturą i kg'); return }

    // Walidacja mięsa — sprawdź czy zaznaczone partie pokrywają potrzeby każdej linii
    {
      // Symuluj alokację sekwencyjnie, odejmując z puli dostępnych
      const pool: Record<string, number> = {}
      ;(seasonedRaw??[]).forEach((s:any) => { pool[s.id] = s.kgAvailable })

      for (const line of valid) {
        const needed = parseFloat(line.qty) * parseFloat(line.kgPerUnit)
        const ids = (line as any).seasonedBatchIds?.length > 0
          ? (line as any).seasonedBatchIds
          : ((line as any).seasonedBatchId ? [(line as any).seasonedBatchId] : [])
        if (ids.length === 0) continue

        let stillNeeded = needed
        for (const id of ids) {
          const avail = pool[id] ?? 0
          const take  = Math.min(stillNeeded, avail)
          pool[id]    = avail - take
          stillNeeded -= take
        }
        if (stillNeeded > 0.1) {
          const batchNos = ids.map((id: string) => (seasonedRaw??[]).find((x:any)=>x.id===id)?.batchNo ?? id).join(', ')
          setError(`Za mało mięsa — partie "${batchNos}" mają razem ${fmtKg(needed - stillNeeded)} kg, potrzeba ${fmtKg(needed)} kg`)
          return
        }
      }
    }

    setSaving(true)
    try {
      await onSave(valid.map(l=>({
        qty:           parseFloat(l.qty),
        kgPerUnit:     parseFloat(l.kgPerUnit),
        productTypeId: l.productTypeId||'',
        recipeId:      l.recipeId,
        packagingId:   l.packagingId||undefined,
        seasonedBatchId:  l.seasonedBatchIds[0]||l.seasonedBatchId||undefined,
        seasonedBatchIds: l.seasonedBatchIds?.length>0 ? l.seasonedBatchIds : (l.seasonedBatchId?[l.seasonedBatchId]:undefined),
        clientOrderId: l.clientOrderId||undefined,
        clientOrderNo: l.clientOrderNo||undefined,
        clientName:    l.clientName||undefined,
      })), planDate)
      onClose()
    } catch(e){ setError(e instanceof Error?e.message:'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 max-h-[85vh] overflow-y-auto pr-1">
      {/* Data + import */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Data produkcji</label>
          <input type="date" value={planDate} onChange={e=>setPlanDate(e.target.value)}
            className="h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50"/>
        </div>
        {confirmed.length>0&&(
          <button onClick={()=>setImportModal(true)}
            className="flex items-center gap-1.5 h-9 px-3 text-sm font-semibold text-brand border border-brand/40 rounded hover:bg-slate-50">
            <Download size={14}/> Importuj z zamówienia ({confirmed.length})
          </button>
        )}
      </div>

      {/* Panel mięsa */}
      <MeatPanel seasonedAvail={seasonedAvail} seasonedUsed={seasonedUsed} onAutoAssign={autoAssignRecipe}/>

      {/* Pozycje */}
      <div>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Pozycje produkcyjne</div>
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
        <button onClick={addLine} className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-brand hover:text-brand/80">
          <Plus size={14}/> Dodaj pozycję
        </button>
      </div>

      {/* Suma */}
      <div className="bg-surface-2 border border-surface-4 rounded-xl p-3 flex items-center justify-between">
        <span className="text-[12px] font-bold text-ink-3">SUMA PLANU:</span>
        <div className="text-xl font-black text-brand">{fmtKg(totalKg,0)} kg</div>
      </div>

      {error&&<div className="text-[12px] text-danger bg-danger-light border border-danger-border px-3 py-2 flex items-center gap-2"><AlertTriangle size={13}/>{error}</div>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Utwórz plan produkcji</Button>
      </div>

      {importModal&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm">
          <div className="bg-surface border border-surface-4 rounded-2xl w-full max-w-lg p-5 shadow-xl">
            <div className="text-[13px] font-bold text-ink mb-4">Import z zamówienia klienta</div>
            <ImportOrderModal orders={confirmed} onImport={importLines} onClose={()=>setImportModal(false)}/>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Strona główna ────────────────────────────────────────────
export function ProductionPlanningPage() {
  const { data: plans, loading, refetch } = useApi(()=>productionPlansApi.list())
  const [modal,    setModal]    = useState(false)
  const [expanded, setExpanded] = useState<string|null>(null)

  async function handleCreate(lines: CreatePlanLineDto[], planDate: string) {
    await productionPlansApi.create({ planDate, lines })
    refetch()
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
            <div key={k.label} className="bg-surface-3 border border-surface-4 p-3 rounded-lg">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{k.label}</div>
              <div className="text-xl font-bold text-ink">{k.val}</div>
            </div>
          ))}
        </div>
        <div className="flex items-start">
          <Button icon={<Plus size={14}/>} onClick={()=>setModal(true)}>Nowy plan</Button>
        </div>
      </div>

      <div className="bg-surface border border-surface-4 rounded-xl">
        <div className="px-4 py-2.5 border-b border-surface-4">
          <span className="text-[13px] font-semibold text-ink">{(plans??[]).length} planów</span>
        </div>
        {loading?<div className="flex justify-center py-10"><Spinner size={20}/></div>
        :(plans??[]).length===0?<EmptyState icon={<Factory size={32}/>} title="Brak planów" message="Utwórz plan"/>
        :(
          <div className="divide-y divide-slate-100">
            {(plans??[]).map(plan=>{
              const isExp=expanded===plan.id
              return (
                <div key={plan.id}>
                  <div className="px-4 py-3 flex items-center gap-3 hover:bg-surface-3/60 cursor-pointer"
                    onClick={()=>setExpanded(isExp?null:plan.id)}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-brand">{plan.planNo}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLORS[plan.status]}`}>
                          {STATUS_LABELS[plan.status]}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-3 mt-0.5">
                        {fmtDatePl(plan.planDate)} · {plan.lines.length} poz. · {fmtKg(plan.totalKg,0)} kg · {plan.totalUnits} szt
                      </div>
                    </div>
                    <div className="flex gap-1 items-center">
                      {plan.status==='draft'&&(
                        <button onClick={e=>{e.stopPropagation();productionPlansApi.updateStatus(plan.id,'active').then(refetch)}}
                          className="text-[11px] text-amber-700 border border-amber-200 px-2 py-1 rounded hover:bg-amber-50">Aktywuj</button>
                      )}
                      {plan.status==='active'&&(
                        <button onClick={e=>{e.stopPropagation();productionPlansApi.updateStatus(plan.id,'done').then(refetch)}}
                          className="text-[11px] text-green-700 border border-green-200 px-2 py-1 rounded hover:bg-green-50">Zakończ</button>
                      )}
                      {isExp?<ChevronUp size={16} className="text-ink-4"/>:<ChevronDown size={16} className="text-ink-4"/>}
                    </div>
                  </div>
                  {isExp&&(
                    <div className="px-4 pb-3 bg-surface-2/50 border-t border-surface-4 overflow-x-auto">
                      <table className="w-full text-[11px] mt-2">
                        <thead>
                          <tr className="text-ink-4 uppercase text-[9px] font-semibold tracking-wider">
                            {['Szt','kg/szt','Razem','Receptura','Tuleja','Partie mięsa','Klient'].map(h=>(
                              <th key={h} className="text-left pb-1 pr-3">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {plan.lines.map(l=>(
                            <tr key={l.id}>
                              <td className="py-1.5 font-bold pr-3">{l.qty}</td>
                              <td className="py-1.5 pr-3">{l.kgPerUnit} kg</td>
                              <td className="py-1.5 font-bold text-brand pr-3">{fmtKg(l.totalKg,0)} kg</td>
                              <td className="py-1.5 pr-3">{l.recipeName}</td>
                              <td className="py-1.5 text-ink-3 pr-3">{l.packagingName||'—'}</td>
                              <td className="py-1.5 pr-3">
                                {(l as any).seasonedBatchNos?.length>0
                                  ? <div className="flex gap-1 flex-wrap">
                                      {(l as any).seasonedBatchNos.map((n:string)=>(
                                        <span key={n} className="font-mono text-green-700 text-[10px] bg-green-50 px-1 py-0.5 rounded">{n}</span>
                                      ))}
                                    </div>
                                  : l.seasonedBatchNo
                                    ? <span className="font-mono text-green-700">{l.seasonedBatchNo}</span>
                                    : <span className="text-amber-600">Do przydzielenia</span>
                                }
                              </td>
                              <td className="py-1.5 text-ink-3 text-[10px]">{l.clientName||'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal&&(
        <Modal open title="Nowy plan produkcji" onClose={()=>setModal(false)} size="xl">
          <PlanForm onSave={handleCreate} onClose={()=>setModal(false)}/>
        </Modal>
      )}
    </div>
  )
}
