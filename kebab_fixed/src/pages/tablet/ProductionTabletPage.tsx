/**
 * ProductionTabletPage v3
 * - Dane z planów biura
 * - Pracownicy WORKER_PRODUCTION z bazy
 * - Zakończenie dnia → magazyn wyrobów gotowych
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, useMutation } from '@/hooks/useApi'
import { productionPlansApi, usersApi, finishedGoodsApi } from '@/lib/apiClient'
import { Spinner, EmptyState } from '@/components/ui/Card'
import { fmtKg, cn } from '@/lib/utils'
import { ChevronRight, Plus, Minus, Pencil, CheckCircle, Factory, RefreshCw, LogOut, AlertTriangle } from 'lucide-react'
import type { ProductionPlan, ProductionPlanLine } from '@/lib/mockApi'
import type { User } from '@/types'

interface WorkerEntry  { workerId:string; workerName:string; pieces:number; addedAt:string }
interface LineProgress { lineId:string; completedPieces:number; status:'PLANNED'|'IN_PROGRESS'|'DONE'; workerEntries:WorkerEntry[] }
type ProgressMap = Record<string, LineProgress>
type ModalMode   = 'add'|'edit'
interface ModalState { lineId:string; mode:ModalMode }

const STATUS_PILL: Record<'PLANNED'|'IN_PROGRESS'|'DONE', string> = {
  PLANNED:'bg-brand-light text-brand border-brand-border',
  IN_PROGRESS:'bg-warn-light text-warn border-warn-border',
  DONE:'bg-success-light text-success border-success-border',
}
const STATUS_LABEL: Record<'PLANNED'|'IN_PROGRESS'|'DONE', string> = {
  PLANNED:'Zapl.', IN_PROGRESS:'W trakcie', DONE:'Gotowe',
}

// ─── KPI ──────────────────────────────────────────────────────
function KpiBar({ plan, progress }: { plan:ProductionPlan; progress:ProgressMap }) {
  const plannedKg  = plan.lines.reduce((s,l)=>s+l.totalKg,0)
  const producedKg = plan.lines.reduce((s,l)=>s+(progress[l.id]?.completedPieces??0)*l.kgPerUnit,0)
  const rem        = Math.max(0, plannedKg-producedKg)
  const plannedSzt = plan.lines.reduce((s,l)=>s+l.qty,0)
  const doneSzt    = plan.lines.reduce((s,l)=>s+(progress[l.id]?.completedPieces??0),0)
  return (
    <div className="grid grid-cols-3 gap-2 px-4 pt-3 pb-2 flex-shrink-0">
      {[
        {label:'Plan',         val:`${plannedSzt} szt`,   sub:`${fmtKg(plannedKg,0)} kg`, color:'text-ink',    border:'border-t-surface-4'},
        {label:'Wykonano',     val:`${doneSzt} szt`,      sub:`${fmtKg(producedKg,0)} kg`, color:'text-success', border:'border-t-success'},
        {label:'Pozostało',    val:`${plannedSzt-doneSzt} szt`, sub:`${fmtKg(rem,0)} kg`,  color:'text-warn',    border:'border-t-warn'},
      ].map(c=>(
        <div key={c.label} className={cn('bg-white rounded-xl border border-surface-4 shadow-card px-3 py-2.5 text-center border-t-2',c.border)}>
          <div className="text-[9px] font-bold uppercase tracking-wide text-ink-3 mb-0.5">{c.label}</div>
          <div className={cn('text-xl font-black tabular-nums leading-none',c.color)}>{c.val}</div>
          <div className="text-[10px] text-ink-3 font-semibold mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Kolumny ──────────────────────────────────────────────────
const GRID='grid-cols-[22px_70px_1fr_70px_64px_1fr_52px_52px_16px]'
const GAP='gap-x-2'

function ColumnHeader() {
  return (
    <div className={cn('grid items-center px-3 py-2 bg-surface-2 border-b-2 border-surface-3',GRID,GAP)}>
      {['#','Szt×kg','Receptura','Partie','Tuleja','Klient','Waga','Status',''].map(h=>(
        <span key={h} className="text-[9px] font-bold text-ink-3 uppercase tracking-wide">{h}</span>
      ))}
    </div>
  )
}

// ─── Wiersz ───────────────────────────────────────────────────
function ProductionRow({ line, nr, prog, onClick, onEdit }: {
  line:ProductionPlanLine; nr:number; prog:LineProgress|undefined
  onClick:()=>void; onEdit:()=>void
}) {
  const status    = prog?.status??'PLANNED'
  const completed = prog?.completedPieces??0
  const pct       = line.qty>0?(completed/line.qty)*100:0
  const isDone    = status==='DONE'
  const hasProg   = status!=='PLANNED'
  const accent    = status==='IN_PROGRESS'?'border-l-warn':status==='DONE'?'border-l-success':'border-l-surface-4'
  const rowBg     = isDone?'bg-success-light/30':status==='IN_PROGRESS'?'bg-warn-light/20':'bg-white'
  const batchNos  = (line as any).seasonedBatchNos ?? (line.seasonedBatchNo?[line.seasonedBatchNo]:[])

  return (
    <div className={cn('border-b-2 border-surface-3 last:border-b-0 border-l-4',accent,rowBg)}>
      <button onClick={onClick} disabled={isDone}
        className={cn('w-full text-left transition-colors select-none',isDone?'cursor-default':'active:bg-surface-3/50 hover:bg-surface-2/60 cursor-pointer')}>
        <div className={cn('grid items-center px-3 py-2.5',GRID,GAP)}>
          <span className="text-[10px] font-bold text-ink-3 tabular-nums text-center">{nr}</span>
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-sm font-black text-ink tabular-nums">{line.qty}</span>
            <span className="text-[10px] text-ink-4 mx-0.5">×</span>
            <span className="text-sm font-black text-brand tabular-nums">{line.kgPerUnit}</span>
            <span className="text-[9px] text-ink-3 font-semibold">kg</span>
          </div>
          <span className="text-xs font-semibold text-ink uppercase truncate">{line.recipeName}</span>
          <div className="flex flex-col items-center gap-0.5">
            {batchNos.length>0
              ? batchNos.map((n:string,i:number)=>(
                  <span key={i} className="text-[9px] font-bold font-mono text-brand bg-brand-light border border-brand-border px-1 py-0.5 rounded whitespace-nowrap">{n}</span>
                ))
              : <span className="text-[9px] text-ink-4">—</span>
            }
          </div>
          <span className="text-xs font-bold text-ink-2 font-mono truncate text-center">{line.packagingName||'—'}</span>
          <span className="text-xs font-bold text-ink truncate">{line.clientName||'—'}</span>
          <div className="text-right">
            <span className="text-sm font-black text-success tabular-nums">{line.totalKg}</span>
            <span className="text-[9px] text-ink-3 font-semibold ml-0.5">kg</span>
          </div>
          <span className={cn('text-[9px] font-bold px-1 py-0.5 rounded-full border whitespace-nowrap text-center block',STATUS_PILL[status])}>
            {STATUS_LABEL[status]}
          </span>
          {isDone?<CheckCircle size={12} className="text-success"/>:<ChevronRight size={12} className="text-ink-4"/>}
        </div>
      </button>

      {hasProg&&(
        <div className="px-3 pb-2.5 pt-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full',pct>=100?'bg-success':pct>=50?'bg-brand':'bg-warn')} style={{width:`${pct}%`}}/>
            </div>
            <span className="text-[10px] font-bold tabular-nums text-ink-3 w-7 text-right">{Math.round(pct)}%</span>
          </div>
          {(prog?.workerEntries??[]).length>0&&(
            <div className="flex items-center gap-1.5 flex-wrap">
              {(prog?.workerEntries??[]).map((e,i)=>(
                <span key={i} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-white border border-surface-4 text-ink-2">
                  <span className="w-4 h-4 rounded-full bg-brand-light text-brand flex items-center justify-center text-[8px] font-black flex-shrink-0">
                    {e.workerName.split(' ')[0][0]}
                  </span>
                  {e.workerName.split(' ')[0]}
                  <span className="font-black text-ink">{e.pieces}</span>
                  <span className="text-ink-3">szt</span>
                </span>
              ))}
              <button onClick={e=>{e.stopPropagation();onEdit()}}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-white border border-surface-4 text-ink-3 hover:border-brand hover:text-brand ml-auto">
                <Pencil size={10}/>Edytuj
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal postępu ────────────────────────────────────────────
function ProgressModal({ line, prog, mode, workers, onSave, onSaveEdit, onClose }: {
  line:ProductionPlanLine; prog:LineProgress|undefined; mode:ModalMode
  workers:User[]; onSave:(wId:string,wName:string,pieces:number)=>void
  onSaveEdit:(entries:WorkerEntry[])=>void; onClose:()=>void
}) {
  const [worker,      setWorker]      = useState('')
  const [count,       setCount]       = useState(1)
  const [editEntries, setEditEntries] = useState<WorkerEntry[]>(()=>(prog?.workerEntries??[]).map(e=>({...e})))
  const completed = prog?.completedPieces??0
  const rem = Math.max(0, line.qty-completed)

  if (mode==='add') return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-sm p-6" onClick={e=>e.stopPropagation()}>
        <div className="mb-4 pb-4 border-b border-surface-3">
          <div className="text-xs font-bold text-ink-3 mb-1">Dodaj postęp</div>
          <div className="font-black text-ink text-lg">{line.clientName||line.recipeName}</div>
          <div className="text-sm text-ink-3 mt-0.5">{line.qty}×{line.kgPerUnit}kg · {line.recipeName}</div>
          <div className="text-xs text-ink-3 mt-1">Wykonano <strong>{completed}</strong>/{line.qty} · Pozostało <strong className="text-warn">{rem}</strong></div>
        </div>
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase text-ink-3 mb-2">Pracownik *</div>
          {workers.length===0
            ? <div className="text-[12px] text-ink-3 bg-amber-50 border border-amber-200 p-3 rounded">Brak pracowników z rolą "Pracownik produkcji". Dodaj w panelu Pracownicy.</div>
            : <div className="grid grid-cols-2 gap-1.5">
                {workers.map(w=>{
                  const sel=worker===w.id
                  const init=w.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()
                  return (
                    <button key={w.id} onClick={()=>setWorker(w.id)}
                      className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all',sel?'bg-brand border-brand':'bg-white border-surface-4 hover:border-brand/40')}>
                      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black',sel?'bg-white/20 text-white':'bg-brand-light text-brand')}>{init}</div>
                      <span className={cn('text-xs font-bold truncate',sel?'text-white':'text-ink')}>{w.name.split(' ')[0]}</span>
                    </button>
                  )
                })}
              </div>
          }
        </div>
        <div className="mb-5">
          <div className="text-[11px] font-bold uppercase text-ink-3 mb-2">Sztuk *</div>
          <div className="flex items-center justify-center gap-5">
            <button onClick={()=>setCount(c=>Math.max(1,c-1))} className="w-14 h-14 rounded-2xl bg-surface-3 border-2 border-surface-4 flex items-center justify-center active:scale-90"><Minus size={22} className="text-ink-2"/></button>
            <div className="flex flex-col items-center min-w-[80px]">
              <div className="text-6xl font-black text-ink tabular-nums leading-none text-center">{count}</div>
              <div className="text-xs text-ink-3 font-semibold mt-1">= {count*line.kgPerUnit} kg</div>
            </div>
            <button onClick={()=>setCount(c=>Math.min(Math.max(rem,1),c+1))} className="w-14 h-14 rounded-2xl bg-brand flex items-center justify-center active:scale-90"><Plus size={22} className="text-white"/></button>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-2xl bg-surface-2 font-bold text-sm text-ink-2 border border-surface-4">Anuluj</button>
          <button onClick={()=>{const w=workers.find(x=>x.id===worker);if(w)onSave(w.id,w.name,count)}} disabled={!worker}
            className="flex-1 h-12 rounded-2xl bg-brand text-white font-bold text-sm disabled:opacity-40 active:scale-[.97]">Zapisz {count} szt</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-sm p-6" onClick={e=>e.stopPropagation()}>
        <div className="mb-4 pb-4 border-b border-surface-3">
          <div className="flex items-center gap-2 mb-1"><Pencil size={13} className="text-warn"/><div className="text-xs font-bold text-warn uppercase">Korekta</div></div>
          <div className="font-black text-ink text-lg">{line.clientName||line.recipeName}</div>
        </div>
        {editEntries.length===0 ? <div className="text-center py-6 text-sm text-ink-3">Brak wpisów</div> : (
          <div className="space-y-2 mb-5">
            {editEntries.map((entry,idx)=>{
              const init=entry.workerName.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()
              return (
                <div key={idx} className="flex items-center gap-3 bg-surface-2 rounded-xl px-3 py-2.5">
                  <div className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-black flex-shrink-0">{init}</div>
                  <span className="text-sm font-semibold text-ink flex-1 truncate">{entry.workerName.split(' ')[0]}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={()=>setEditEntries(p=>p.map((e,i)=>i===idx?{...e,pieces:Math.max(0,e.pieces-1)}:e))} className="w-8 h-8 rounded-lg bg-white border border-surface-4 flex items-center justify-center"><Minus size={14} className="text-ink-2"/></button>
                    <input type="number" value={entry.pieces} onChange={e=>setEditEntries(p=>p.map((en,i)=>i===idx?{...en,pieces:Math.max(0,parseInt(e.target.value)||0)}:en))}
                      className="w-14 text-center text-lg font-black text-ink tabular-nums bg-white border-2 border-surface-4 rounded-lg focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                    <button onClick={()=>setEditEntries(p=>p.map((e,i)=>i===idx?{...e,pieces:e.pieces+1}:e))} className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center"><Plus size={14} className="text-white"/></button>
                    <span className="text-xs text-ink-3 font-semibold w-6">szt</span>
                  </div>
                </div>
              )
            })}
            <div className="flex justify-between text-xs font-semibold text-ink-3 px-1 pt-1">
              <span>Łącznie:</span>
              <span className="font-black text-ink">{editEntries.reduce((s,e)=>s+e.pieces,0)} szt · {editEntries.reduce((s,e)=>s+e.pieces,0)*line.kgPerUnit} kg</span>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-2xl bg-surface-2 font-bold text-sm text-ink-2 border border-surface-4">Anuluj</button>
          <button onClick={()=>onSaveEdit(editEntries)} className="flex-1 h-12 rounded-2xl bg-warn text-white font-bold text-sm">Zapisz korektę</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal zakończenia dnia ───────────────────────────────────
function FinishDayModal({ plan, progress, onConfirm, onClose }: {
  plan:ProductionPlan; progress:ProgressMap; onConfirm:()=>Promise<void>; onClose:()=>void
}) {
  const [saving, setSaving] = useState(false)
  const doneLines   = plan.lines.filter(l=>progress[l.id]?.status==='DONE')
  const partialLines= plan.lines.filter(l=>progress[l.id]?.status==='IN_PROGRESS')
  const plannedLines= plan.lines.filter(l=>!progress[l.id]||progress[l.id].status==='PLANNED')
  const totalDone   = plan.lines.reduce((s,l)=>s+(progress[l.id]?.completedPieces??0),0)
  const totalKgDone = plan.lines.reduce((s,l)=>s+(progress[l.id]?.completedPieces??0)*l.kgPerUnit,0)

  async function handleConfirm() {
    setSaving(true)
    try { await onConfirm(); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md p-6" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center"><LogOut size={24} className="text-green-600"/></div>
          <div>
            <h3 className="text-lg font-black text-ink">Zakończ dzień produkcji</h3>
            <p className="text-sm text-ink-3">Plan: {plan.planNo}</p>
          </div>
        </div>

        <div className="bg-surface-2 border border-surface-4 rounded-xl p-3 mb-4 space-y-1.5 text-[12px]">
          <div className="flex justify-between"><span className="text-ink-3">Wyprodukowano:</span><span className="font-bold text-green-700">{totalDone} szt · {fmtKg(totalKgDone)} kg</span></div>
          <div className="flex justify-between"><span className="text-ink-3">Gotowe pozycje:</span><span className="font-semibold">{doneLines.length}</span></div>
          {partialLines.length>0&&<div className="flex justify-between"><span className="text-amber-600">Częściowe:</span><span className="font-semibold text-amber-600">{partialLines.length}</span></div>}
          {plannedLines.length>0&&<div className="flex justify-between"><span className="text-ink-3">Niezrealizowane:</span><span className="font-semibold text-ink-3">{plannedLines.length}</span></div>}
        </div>

        <div className="bg-green-50 border border-green-200 px-3 py-2.5 rounded-xl mb-5 text-[11px] text-green-700">
          <CheckCircle size={13} className="inline mr-1.5"/>
          Wszystkie wyprodukowane sztuki ({totalDone} szt) zostaną automatycznie dodane do <strong>Magazynu wyrobów gotowych</strong>
        </div>

        {(partialLines.length>0||plannedLines.length>0)&&(
          <div className="bg-amber-50 border border-amber-200 px-3 py-2.5 rounded-xl mb-5 text-[11px] text-amber-700 flex items-start gap-2">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>
            <span>Pozycje częściowe lub niezrealizowane zostaną zapisane z aktualnym postępem. Plan zostanie zamknięty.</span>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-2xl bg-surface-2 font-bold text-sm text-ink-2 border border-surface-4">Anuluj</button>
          <button onClick={handleConfirm} disabled={saving||totalDone===0}
            className="flex-1 h-12 rounded-2xl bg-success text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
            {saving?<span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>:<CheckCircle size={16}/>}
            Zakończ i zapisz do magazynu
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Wybór planu ──────────────────────────────────────────────
function PlanPicker({ plans, onSelect }: { plans:ProductionPlan[]; onSelect:(id:string)=>void }) {
  const active = plans.filter(p=>p.status==='active')
  const draft  = plans.filter(p=>p.status==='draft')
  const all    = [...active,...draft]

  if (all.length===0) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <Factory size={48} className="text-ink-5 mb-4"/>
      <h2 className="text-2xl font-black text-ink mb-2">Brak aktywnych planów</h2>
      <p className="text-base text-ink-3">Biuro musi aktywować plan produkcji.</p>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-5 py-6">
      <h2 className="text-xl font-black text-ink mb-4">Wybierz plan produkcji</h2>
      <div className="space-y-3">
        {all.map(p=>(
          <button key={p.id} onClick={()=>onSelect(p.id)}
            className="w-full text-left bg-white border-2 border-surface-4 rounded-2xl p-4 hover:border-brand hover:shadow-md active:scale-[.99]">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono font-bold text-brand">{p.planNo}</div>
                <div className="text-[12px] text-ink-3 mt-0.5">{p.planDate} · {p.lines.length} poz. · {fmtKg(p.totalKg,0)} kg · {p.totalUnits} szt</div>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${p.status==='active'?'bg-amber-50 text-amber-700':'bg-surface-3 text-ink-3'}`}>
                {p.status==='active'?'Aktywny':'Szkic'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Główna ───────────────────────────────────────────────────
export function ProductionTabletPage() {
  const navigate = useNavigate()
  const { data:plans,   loading:plansLoading  } = useApi(()=>productionPlansApi.list())
  const { data:workers, loading:workersLoading } = useApi(()=>usersApi.list())
  const finishMut = useMutation(({planId, entries}:{planId:string;entries:any[]}) =>
    finishedGoodsApi.finishProductionDay(planId, entries))

  const [selectedPlanId, setSelectedPlanId] = useState<string|null>(null)
  const [progress,       setProgress]       = useState<ProgressMap>({})
  const [modalState,     setModalState]     = useState<ModalState|null>(null)
  const [showFinish,     setShowFinish]     = useState(false)
  const [toast,          setToast]          = useState('')

  const productionWorkers = (workers??[]).filter(w=>w.role==='WORKER_PRODUCTION'&&w.active)
  const activePlans       = (plans??[]).filter(p=>p.status==='active'||p.status==='draft')
  const selectedPlan      = (plans??[]).find(p=>p.id===selectedPlanId)??null
  const activeLine        = modalState ? selectedPlan?.lines.find(l=>l.id===modalState.lineId)??null : null

  function showToast(msg:string) { setToast(msg); setTimeout(()=>setToast(''),3500) }

  function saveProgress(workerId:string, workerName:string, pieces:number) {
    if (!modalState) return
    const lineId = modalState.lineId
    const line = selectedPlan?.lines.find(l=>l.id===lineId)
    if (!line) return
    const now = new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})
    setProgress(prev=>{
      const cur = prev[lineId]??{lineId,completedPieces:0,status:'PLANNED' as const,workerEntries:[]}
      const idx = cur.workerEntries.findIndex(e=>e.workerId===workerId)
      const entries = idx>=0
        ? cur.workerEntries.map((e,j)=>j===idx?{...e,pieces:e.pieces+pieces}:e)
        : [...cur.workerEntries,{workerId,workerName,pieces,addedAt:now}]
      const completed = Math.min(line.qty, cur.completedPieces+pieces)
      const status: 'PLANNED'|'IN_PROGRESS'|'DONE' = completed>=line.qty?'DONE':completed>0?'IN_PROGRESS':'PLANNED'
      return {...prev,[lineId]:{lineId,completedPieces:completed,status,workerEntries:entries}}
    })
    setModalState(null)
  }

  function saveEdit(entries:WorkerEntry[]) {
    if (!modalState) return
    const lineId = modalState.lineId
    const line = selectedPlan?.lines.find(l=>l.id===lineId)
    if (!line) return
    const completed = Math.min(line.qty, entries.filter(e=>e.pieces>0).reduce((s,e)=>s+e.pieces,0))
    const status: 'PLANNED'|'IN_PROGRESS'|'DONE' = completed>=line.qty?'DONE':completed>0?'IN_PROGRESS':'PLANNED'
    setProgress(prev=>({...prev,[lineId]:{lineId,completedPieces:completed,status,workerEntries:entries.filter(e=>e.pieces>0)}}))
    setModalState(null)
  }

  async function handleFinishDay() {
    if (!selectedPlan) return
    // Zbierz wpisy do zapisania
    const entries = selectedPlan.lines
      .filter(l => (progress[l.id]?.completedPieces??0) > 0)
      .map(l => {
        const prog = progress[l.id]
        const batchNos = (l as any).seasonedBatchNos ?? (l.seasonedBatchNo?[l.seasonedBatchNo]:[])
        return {
          planLineId:      l.id,
          qty:             prog?.completedPieces ?? 0,
          workerNames:     (prog?.workerEntries??[]).map(e=>e.workerName),
          kgPerUnit:       l.kgPerUnit,
          productTypeId:   l.productTypeId,
          productTypeName: l.productTypeName,
          recipeId:        l.recipeId,
          recipeName:      l.recipeName,
          packagingId:     l.packagingId,
          packagingName:   l.packagingName,
          clientOrderId:   l.clientOrderId,
          clientOrderNo:   l.clientOrderNo,
          clientName:      l.clientName,
          seasonedBatchNos: batchNos,
        }
      })
    await finishMut.mutate({ planId: selectedPlan.id, entries })
    setProgress({})
    setSelectedPlanId(null)
    setShowFinish(false)
    navigate('/finished-goods', { state: { justFinished: true, count: entries.reduce((s,e)=>s+e.qty,0) } })
  }

  if (plansLoading||workersLoading) return <div className="flex justify-center items-center h-full"><Spinner size={32}/></div>

  if (!selectedPlan) return <div className="flex flex-col h-full overflow-hidden"><PlanPicker plans={activePlans} onSelect={setSelectedPlanId}/></div>

  const sortedLines = [...selectedPlan.lines].sort((a,b)=>{
    const pa=progress[a.id]?.status??'PLANNED'
    const pb=progress[b.id]?.status??'PLANNED'
    const o={IN_PROGRESS:0,PLANNED:1,DONE:2}
    return o[pa]-o[pb]
  })

  const totalDone = selectedPlan.lines.reduce((s,l)=>s+(progress[l.id]?.completedPieces??0),0)
  const allDone   = selectedPlan.lines.every(l=>(progress[l.id]?.status??'PLANNED')==='DONE')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Nagłówek */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="font-mono text-sm font-bold text-brand">{selectedPlan.planNo}</div>
          <div className="text-[11px] text-ink-3">{selectedPlan.planDate} · {selectedPlan.lines.length} pozycji</div>
        </div>
        <div className="flex gap-2">
          {totalDone>0&&(
            <button onClick={()=>setShowFinish(true)}
              className={cn('flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg border transition-all',
                allDone?'bg-success text-white border-success':'bg-green-50 text-green-700 border-green-200 hover:bg-green-100')}>
              <LogOut size={13}/>
              {allDone?'Zakończ dzień':'Zakończ (częściowo)'}
            </button>
          )}
          <button onClick={()=>{setSelectedPlanId(null);setProgress({})}}
            className="text-[12px] font-semibold text-ink-3 border border-surface-4 px-3 py-1.5 rounded-lg hover:border-brand hover:text-brand flex items-center gap-1.5">
            <RefreshCw size={12}/>Zmień
          </button>
        </div>
      </div>

      <KpiBar plan={selectedPlan} progress={progress}/>

      <div className="flex-1 overflow-y-auto mx-4 mb-4 bg-white rounded-xl border border-surface-4 shadow-card overflow-hidden">
        <ColumnHeader/>
        {sortedLines.map((line,idx)=>(
          <ProductionRow key={line.id} line={line} nr={idx+1} prog={progress[line.id]}
            onClick={()=>{if((progress[line.id]?.status??'PLANNED')!=='DONE')setModalState({lineId:line.id,mode:'add'})}}
            onEdit={()=>setModalState({lineId:line.id,mode:'edit'})}/>
        ))}
      </div>

      {modalState&&activeLine&&(
        <ProgressModal line={activeLine} prog={progress[modalState.lineId]} mode={modalState.mode}
          workers={productionWorkers} onSave={saveProgress} onSaveEdit={saveEdit} onClose={()=>setModalState(null)}/>
      )}

      {showFinish&&selectedPlan&&(
        <FinishDayModal plan={selectedPlan} progress={progress}
          onConfirm={handleFinishDay} onClose={()=>setShowFinish(false)}/>
      )}

      {toast&&(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full bg-success text-white text-sm font-semibold shadow-lg z-50 flex items-center gap-2">
          <CheckCircle size={16}/>{toast}
        </div>
      )}
    </div>
  )
}
