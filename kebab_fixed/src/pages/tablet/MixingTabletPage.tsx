/**
 * MixingTabletPage v5
 *
 * Model: jedno zlecenie = wiele sesji masowania (każda = konkretna maszyna + konkretne kg partii)
 * Biuro planuje 1000 kg:
 *   Operator laduje Masownicę 1 → 200 kg (partia MIESO-001)
 *   Operator laduje Masownicę 2 → 200 kg (partia MIESO-001)
 *   Operator laduje Masownicę 3 → 600 kg (partia MIESO-002)
 * Po każdej sesji zlecenie wraca na "planned" z kgRemaining -= kgActual
 * Dopiero gdy kgRemaining < 0.1 → status "done"
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { mixingOrdersApi, machineLockApi, meatStockApi, productionSessionsApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import type { MixingOrder, MachineId, MachineLock } from '@/lib/mockApi'
import { Spinner } from '@/components/ui/widgets'
import {
  Play, CheckCircle, RotateCcw, AlertTriangle,
  Scale, ClipboardList, Lock, Timer, Beef, ChevronLeft, Home, Info, LogOut,
} from 'lucide-react'

const WEIGHT_TOLERANCE_KG = 0.050  // 50g

// ─── Machine status tile ──────────────────────────────────────
function MachineTile({ lock, order }: { lock: MachineLock; order?: any }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
  )
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
      setRemaining(s)
      if (s === 0) clearInterval(t)
    }, 1000)
    return () => clearInterval(t)
  }, [lock.unlocksAt])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  const kgMeat = order
    ? (order.kgInMachine > 0
        ? order.kgInMachine
        : (order.kgDone > 0 ? order.kgDone : order.meatKg))
    : 0
  const factor = order && order.meatKg > 0 ? kgMeat / order.meatKg : 1
  const additivesKg = order
    ? (order.steps ?? []).reduce((sum: number, s: any) =>
        sum + (parseFloat(s.qtyConfirmed ?? s.qtyRequired ?? 0)) * factor, 0)
    : 0

  return (
    <div className="bg-white border-2 border-orange-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
            <Timer size={16} className="text-orange-600" />
          </div>
          <div>
            <div className="text-xs font-bold text-orange-600 uppercase tracking-wide">W trakcie</div>
            <div className="text-base font-black text-ink">Masownica {lock.machineId}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black font-mono text-orange-600 tabular-nums">{mm}:{ss}</div>
          <div className="text-[10px] text-ink-3">pozostało</div>
        </div>
      </div>
      {order && (
        <div className="grid grid-cols-3 gap-2 mt-1">
          <div className="bg-surface-2 rounded-xl p-2 text-center">
            <div className="text-[10px] font-bold text-ink-3 uppercase mb-0.5">Receptura</div>
            <div className="text-[11px] font-bold text-ink leading-tight">{order.recipeName ?? '—'}</div>
          </div>
          <div className="bg-surface-2 rounded-xl p-2 text-center">
            <div className="text-[10px] font-bold text-ink-3 uppercase mb-0.5">Mięso</div>
            <div className="text-base font-black text-ink tabular-nums">{fmtKg(kgMeat, 0)}</div>
            <div className="text-[10px] text-ink-3">kg</div>
          </div>
          <div className="bg-surface-2 rounded-xl p-2 text-center">
            <div className="text-[10px] font-bold text-ink-3 uppercase mb-0.5">Dodatki</div>
            <div className="text-base font-black text-ink tabular-nums">{fmtKg(additivesKg, 1)}</div>
            <div className="text-[10px] text-ink-3">kg</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Cooldown timer ──────────────────────────────────────────
function CooldownTimer({ lock, isFullyDone, onComplete, onHome }: {
  lock: MachineLock; isFullyDone: boolean
  onComplete: () => void; onHome: () => void
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
  )
  const [expired, setExpired] = useState(remaining === 0)

  useEffect(() => {
    if (remaining === 0) { setExpired(true); return }
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
      setRemaining(s)
      if (s === 0) { clearInterval(t); setExpired(true) }
    }, 1000)
    return () => clearInterval(t)
  }, [lock.unlocksAt])

  const mm = String(Math.floor(remaining / 60)).padStart(2,'0')
  const ss = String(remaining % 60).padStart(2,'0')
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-5 text-center max-w-sm mx-auto">
      <div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center mb-5">
        <Timer size={48} className="text-amber-600" />
      </div>
      <h2 className="text-2xl font-black text-ink mb-1">Masownica {lock.machineId}</h2>
      <p className="text-base text-ink-3 mb-4">{lock.orderNo} — masowanie w trakcie</p>
      {!expired ? (
        <>
          <div className="text-7xl font-black tabular-nums text-amber-600 mb-4 font-mono">{mm}:{ss}</div>
          <div className="w-full max-w-xs h-3 bg-surface-3 rounded-full overflow-hidden mb-6">
            <div className="h-full bg-amber-400 rounded-full transition-all duration-1000"
              style={{ width: `${(remaining / 3000) * 100}%` }} />
          </div>
          <p className="text-[12px] text-amber-700 mb-6">Pozostałe maszyny są dostępne</p>
        </>
      ) : (
        <div className="mb-6">
          <div className="text-5xl font-black text-green-600 mb-2">00:00</div>
          <p className="text-[13px] text-green-700 font-semibold">Czas masowania upłynął</p>
        </div>
      )}
      <button onClick={onHome}
        className="w-full max-w-xs h-12 flex items-center justify-center gap-2 bg-white border-2 border-surface-4 text-ink rounded-2xl font-semibold mb-3">
        <Home size={16} /> Menu masowni
      </button>
      {isFullyDone && expired && (
        <button onClick={onComplete}
          className="w-full max-w-xs h-14 flex items-center justify-center gap-2 bg-success text-white rounded-2xl text-base font-bold shadow-[0_4px_18px_rgba(5,150,105,.3)]">
          <CheckCircle size={20} /> Zakończ masowanie
        </button>
      )}
      {!isFullyDone && (
        <p className="text-[12px] text-ink-3 max-w-xs">
          Wsad częściowy — po wymieszaniu zlecenie wróci na listę
          „Do wznowienia" z pozostałymi kg. Nie zamykaj zlecenia.
        </p>
      )}
    </div>
  )
}

// ─── Wybór maszyny ────────────────────────────────────────────
function MachineScreen({ order, locks, onConfirm, onBack, loading }: {
  order: MixingOrder; locks: MachineLock[]
  onConfirm: (m: MachineId) => void; onBack: () => void; loading: boolean
}) {
  const [sel, setSel] = useState<MachineId | null>(null)

  const kgRemaining = (order as any).kgRemaining ?? order.meatKg
  const kgDone      = (order as any).kgDone ?? 0

  const isLocked    = (m: MachineId) => locks.some(l => l.machineId === m)
  const getLockMins = (m: MachineId) => {
    const l = locks.find(x => x.machineId === m)
    return l ? Math.max(0, Math.ceil((new Date(l.unlocksAt).getTime() - Date.now()) / 60000)) : null
  }
  const PAL = [
    { idle:'bg-blue-50 border-blue-300',  sel:'bg-brand border-brand text-white',   lock:'bg-red-50 border-red-300' },
    { idle:'bg-green-50 border-green-300',sel:'bg-success border-success text-white',lock:'bg-red-50 border-red-300' },
    { idle:'bg-amber-50 border-amber-300',sel:'bg-warn border-warn text-white',      lock:'bg-red-50 border-red-300' },
  ]

  return (
    <div className="max-w-lg mx-auto px-5 py-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink mb-4">
        <ChevronLeft size={16} /> Wstecz
      </button>

      <div className="font-mono text-sm text-brand font-bold">{order.orderNo}</div>
      <h2 className="text-xl font-black text-ink mb-1">{order.recipeName}</h2>

      {/* Postęp zlecenia */}
      <div className="bg-surface-2 border border-surface-4 rounded-xl p-3 mb-4">
        <div className="text-[10px] font-bold text-ink-3 uppercase mb-2">Postęp zlecenia</div>
        <div className="h-2.5 bg-surface-3 rounded-full overflow-hidden mb-1.5">
          <div className="h-full bg-brand rounded-full"
            style={{ width: `${Math.min(100, (kgDone / order.meatKg) * 100)}%` }} />
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="text-green-700 font-semibold">Wykonano: {fmtKg(kgDone)} kg</span>
          <span className="font-bold text-ink">Plan: {fmtKg(order.meatKg)} kg</span>
          <span className="text-amber-600 font-bold">Pozostało: {fmtKg(kgRemaining)} kg</span>
        </div>
      </div>

      {/* Partie mięsa z przydziałem */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <div className="text-[10px] font-bold text-blue-700 uppercase mb-1.5">Partie mięsa w zleceniu</div>
        {order.meatLots.map(lot => (
          <div key={lot.meatLotId} className="flex justify-between text-[12px] py-1 border-b border-blue-100 last:border-0">
            <span className="font-mono font-bold text-ink">{lot.meatLotNo}</span>
            <span className="text-ink-3 text-[11px]">{lot.rawBatchNo}</span>
            <span className="font-bold text-blue-700">{fmtKg(lot.kgPlanned)} kg</span>
            <span className="text-[11px] text-ink-4">do: {fmtDatePl(lot.expiryDate)}</span>
          </div>
        ))}
      </div>

      {/* Poprzednie sesje */}
      {((order as any).sessions ?? []).length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <div className="text-[10px] font-bold text-green-700 uppercase mb-1.5">Poprzednie sesje</div>
          {((order as any).sessions ?? []).map((s: any) => (
            <div key={s.sessionId} className="flex items-center gap-2 text-[11px] py-0.5">
              <CheckCircle size={11} className="text-green-600" />
              <span>Masownica {s.machineId}</span>
              <span className="font-bold">{fmtKg(s.kgMeat)} kg</span>
              <span className="text-ink-3">→ {s.batchNo}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3">Wybierz masownicę dla tej sesji</div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {([1,2,3] as MachineId[]).map((m, i) => {
          const pal = PAL[i]; const locked = isLocked(m); const isSel = sel === m; const mins = getLockMins(m)
          return (
            <button key={m} onClick={() => !locked && setSel(m)} disabled={locked}
              className={cn('flex flex-col items-center justify-center h-28 rounded-2xl border-2 transition-all select-none',
                locked ? cn(pal.lock, 'cursor-not-allowed opacity-70') : isSel ? pal.sel : cn('bg-white', pal.idle, 'hover:shadow-md active:scale-95'))}>
              {locked && <Lock size={18} className="text-red-400 mb-1" />}
              <div className={cn('text-3xl font-black', isSel ? 'text-white' : locked ? 'text-red-500' : 'text-ink')}>{m}</div>
              <div className={cn('text-xs font-semibold mt-1', isSel ? 'text-white/80' : locked ? 'text-red-400' : 'text-ink-3')}>
                {locked ? `~${mins} min` : `Masownica ${m}`}
              </div>
            </button>
          )
        })}
      </div>
      <button onClick={() => sel && onConfirm(sel)} disabled={!sel || loading}
        className="w-full h-14 bg-brand text-white rounded-2xl text-base font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[.98]">
        {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={20} />}
        Dalej — wpisz ilość mięsa
      </button>
    </div>
  )
}

// ─── Ekran wpisywania kg mięsa ────────────────────────────────
interface MeatScreenLot {
  meatLotId: string; meatLotNo: string; rawBatchNo: string
  kgPlanned: number; expiryDate: string; materialName?: string
}

function MeatScreen({ order, availableLots, onConfirm, onBack }: {
  order: MixingOrder
  // Zlecenie z planu dnia nie ma prealokowanych lotów — operator wybiera
  // z dostępnych na magazynie mięsa (FEFO)
  availableLots?: MeatScreenLot[]
  onConfirm: (lotAllocations: { meatLotId: string; kg: number }[], totalKg: number) => void
  onBack: () => void
}) {
  const kgRemaining = (order as any).kgRemaining ?? order.meatKg
  const [showRecipe, setShowRecipe] = useState(false)
  const lots: MeatScreenLot[] = order.meatLots.length > 0
    ? (order.meatLots as any)
    : (availableLots ?? [])

  // Każda partia ma własne pole kg — operator wpisuje ile z każdej ładuje
  const [lotKgs, setLotKgs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    lots.forEach(lot => { init[lot.meatLotId] = '' })
    return init
  })

  const totalKg = Object.values(lotKgs).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const isOverRemaining = totalKg > kgRemaining + 0.01

  // Walidacja per lot
  const lotErrors: Record<string, string> = {}
  lots.forEach(lot => {
    const kg = parseFloat(lotKgs[lot.meatLotId] || '0') || 0
    if (kg > lot.kgPlanned + 0.01) {
      lotErrors[lot.meatLotId] = `Maks. ${fmtKg(lot.kgPlanned)} kg`
    }
  })
  const hasErrors = Object.keys(lotErrors).length > 0 || isOverRemaining
  const canConfirm = totalKg > 0 && !hasErrors

  function handleConfirm() {
    const allocs = lots
      .map(lot => ({ meatLotId: lot.meatLotId, kg: parseFloat(lotKgs[lot.meatLotId] || '0') || 0 }))
      .filter(a => a.kg > 0)
    onConfirm(allocs, totalKg)
  }

  return (
    <div className="max-w-md mx-auto px-5 py-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink mb-4">
        <ChevronLeft size={16} /> Wstecz
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <div className="font-mono text-sm text-brand font-bold">{order.orderNo} · Masownica {order.machineId}</div>
          <h2 className="text-xl font-black text-ink">{order.recipeName}</h2>
        </div>
        {totalKg > 0 && (
          <button onClick={() => setShowRecipe(true)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl text-[12px] font-semibold hover:bg-purple-100">
            <ClipboardList size={14} /> Podgląd receptury
          </button>
        )}
      </div>
      <p className="text-sm text-ink-3 mb-4">Pozostało do wymieszania: <strong className="text-amber-600">{fmtKg(kgRemaining)} kg</strong></p>

      {/* Modal podglądu receptury */}
      {showRecipe && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-black text-ink">{order.recipeName}</h3>
              <button onClick={() => setShowRecipe(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-3 text-ink-3 hover:bg-surface-4">
                ✕
              </button>
            </div>
            <div className="text-[10px] font-bold text-ink-4 uppercase tracking-wider mb-2">
              Składniki na {fmtKg(totalKg)} kg mięsa
            </div>
            <div className="space-y-2">
              {order.steps.map(s => {
                const qty = Math.round(s.qtyRequired * (totalKg / order.meatKg) * 1000) / 1000
                return (
                  <div key={s.stepNo} className="flex items-center justify-between bg-surface-2 rounded-xl px-3 py-2.5">
                    <span className="font-semibold text-ink text-[14px]">{s.ingredientName}</span>
                    <span className="font-black text-brand text-[18px] tabular-nums">{qty.toFixed(2)} <span className="text-[12px] font-medium text-ink-3">{s.unit}</span></span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
                <span className="font-semibold text-blue-700 text-[14px]">Mięso</span>
                <span className="font-black text-blue-700 text-[18px] tabular-nums">{fmtKg(kgRemaining)} <span className="text-[12px] font-medium">kg</span></span>
              </div>
            </div>
            <button onClick={() => setShowRecipe(false)}
              className="w-full h-12 mt-4 bg-brand text-white rounded-2xl font-bold">
              Zamknij
            </button>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-1">
        <div className="text-[10px] font-bold text-blue-700 uppercase mb-2 flex items-center gap-1.5">
          <Info size={12} /> Wpisz ile kg z każdej partii ładujesz do tej maszyny
        </div>
        <div className="space-y-3">
          {lots.map(lot => {
            const kg    = parseFloat(lotKgs[lot.meatLotId] || '0') || 0
            const err   = lotErrors[lot.meatLotId]
            const hasKg = kg > 0
            return (
              <div key={lot.meatLotId} className={cn('bg-white border-2 rounded-xl p-3 transition-all',
                err ? 'border-red-400' : hasKg ? 'border-brand' : 'border-surface-4')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-brand">{lot.meatLotNo}</span>
                  <span className="text-[11px] text-ink-3">{lot.rawBatchNo}</span>
                  <span className="text-[11px] font-semibold text-blue-700">maks. {fmtKg(lot.kgPlanned)} kg</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <input type="number" inputMode="decimal" min="0" step="0.1"
                    max={lot.kgPlanned}
                    placeholder="0"
                    value={lotKgs[lot.meatLotId]}
                    onFocus={e => e.target.select()}
                    onChange={e => setLotKgs(p => ({ ...p, [lot.meatLotId]: e.target.value }))}
                    className={cn('flex-1 text-[48px] font-black tabular-nums border-none bg-transparent outline-none leading-none',
                      err ? 'text-red-600' : 'text-ink',
                      '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none')} />
                  <span className="text-xl font-medium text-ink-3">kg</span>
                </div>
                {err && <div className="text-[11px] text-red-600 font-semibold mt-0.5"><AlertTriangle size={11} className="inline mr-1" />{err}</div>}
                <div className="text-[11px] text-ink-4 mt-0.5">do: {fmtDatePl(lot.expiryDate)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Suma */}
      <div className={cn('border-2 rounded-xl p-3 mb-4 mt-3 flex items-center justify-between',
        isOverRemaining ? 'border-red-400 bg-red-50' : totalKg > 0 ? 'border-success bg-green-50' : 'border-surface-4')}>
        <span className="text-[12px] font-bold text-ink-3">Łącznie do tej maszyny:</span>
        <span className={cn('text-2xl font-black tabular-nums', isOverRemaining ? 'text-red-600' : 'text-success')}>
          {fmtKg(totalKg)} kg
        </span>
      </div>
      {isOverRemaining && (
        <div className="text-[12px] text-red-600 font-semibold mb-3 flex items-center gap-1.5">
          <AlertTriangle size={13} /> Przekroczono pozostałe {fmtKg(kgRemaining)} kg!
        </div>
      )}

      <button onClick={handleConfirm} disabled={!canConfirm}
        className="w-full h-14 bg-brand text-white rounded-2xl text-base font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[.98]">
        <Beef size={20} /> Przelicz składniki ({fmtKg(totalKg)} kg)
      </button>
    </div>
  )
}

// ─── Krok składnika ───────────────────────────────────────────
function StepScreen({ order, kgActual, stepIdx, onConfirm, onBack, loading }: {
  order: MixingOrder; kgActual: number; stepIdx: number
  onConfirm: (stepNo: number, qty: number) => void
  onBack: () => void; loading: boolean
}) {
  const step = order.steps[stepIdx]
  const total = order.steps.length
  const qtyRequired = Math.round(step.qtyRequired * (kgActual / order.meatKg) * 1000) / 1000
  const [qty, setQty] = useState('0')
  const qtyVal = parseFloat(qty) || 0
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setQty('0'); setTimeout(() => { inputRef.current?.select(); inputRef.current?.focus() }, 80) }, [stepIdx])

  const diff = qtyVal - qtyRequired
  const absDiff = Math.abs(diff)
  const isOk   = qtyVal > 0 && absDiff <= WEIGHT_TOLERANCE_KG
  const isWarn = qtyVal > 0 && absDiff > WEIGHT_TOLERANCE_KG && absDiff <= 0.2
  const isOver = qtyVal > 0 && absDiff > 0.2
  const diffG  = Math.round(diff * 1000)

  return (
    <div className="max-w-md mx-auto px-5 py-5">
      <div className="flex items-center justify-between mb-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
          <ChevronLeft size={16} /> Wstecz
        </button>
        <span className="text-[12px] text-ink-3">
          <span className="font-mono font-bold text-brand">{order.orderNo}</span>
          {' '}· Masownica {order.machineId} · {stepIdx+1}/{total}
        </span>
      </div>
      <div className="h-2 bg-surface-3 rounded-full overflow-hidden mb-4">
        <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round(stepIdx/total*100)}%` }} />
      </div>

      {Math.abs(kgActual - order.meatKg) > 0.01 && (
        <div className="bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl mb-3 text-[11px] text-amber-700">
          Składniki przeliczone na faktyczne <strong>{fmtKg(kgActual)} kg</strong> mięsa (plan: {fmtKg(order.meatKg)} kg)
        </div>
      )}

      {stepIdx > 0 && (
        <div className="mb-3 space-y-1">
          {order.steps.slice(0,stepIdx).map(s => (
            <div key={s.stepNo} className="flex items-center gap-2 text-[11px] text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">
              <CheckCircle size={12} />
              <span className="font-semibold">{s.ingredientName}</span>
              <span className="ml-auto font-mono">{(s.qtyConfirmed ?? s.qtyRequired).toFixed(2)} {s.unit}</span>
            </div>
          ))}
        </div>
      )}

      <div className={cn('border-2 rounded-2xl p-5 mb-4 text-center',
        isOk?'border-success bg-green-50/30':isWarn?'border-warn bg-amber-50/30':isOver?'border-red-400 bg-red-50/30':'border-brand bg-blue-50/20')}>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Dodaj składnik</div>
        <div className="text-3xl font-black text-ink mb-1">{step.ingredientName}</div>
        <div className="text-5xl font-black text-brand tabular-nums mt-2">{qtyRequired.toFixed(2)}</div>
        <div className="text-xl font-medium text-ink-3">{step.unit}</div>
        <div className="text-[11px] text-ink-4 mt-1">Tolerancja: ±50 g</div>
      </div>

      <div className={cn('border-2 rounded-2xl px-5 py-4 mb-2',
        isOk?'border-success':isWarn?'border-warn':isOver?'border-red-400':'border-surface-4')}>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">Wpisz zważoną ilość</div>
        <div className="flex items-baseline gap-2">
          <input ref={inputRef} type="number" inputMode="decimal" min="0" step="0.001"
            value={qty} onFocus={e => e.target.select()} onChange={e => setQty(e.target.value)}
            className={cn('flex-1 border-none bg-transparent outline-none text-[52px] font-black tabular-nums leading-none',
              isOk?'text-success':isWarn?'text-warn':isOver?'text-red-600':'text-ink',
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none')} />
          <span className="text-xl font-medium text-ink-3">{step.unit}</span>
        </div>
        {qtyVal > 0 && (
          <div className={cn('text-[12px] font-bold mt-1 flex items-center gap-1', isOk?'text-success':isWarn?'text-warn':'text-red-600')}>
            {isOk ? <><CheckCircle size={13}/> OK — {diffG>0?'+':''}{diffG}g</> :
              <><AlertTriangle size={13}/> {isOver ? `Za duże! ${diffG>0?'+':''}${diffG}g (max ±50g)` : `${diffG>0?'+':''}${diffG}g`}</>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-ink-4 mb-4 px-1">
        <Scale size={12}/> Gotowe pod podłączenie wagi elektronicznej
      </div>
      <button onClick={() => isOk && onConfirm(step.stepNo, qtyVal)} disabled={!isOk || loading}
        className="w-full h-14 bg-success text-white rounded-2xl text-base font-bold flex items-center justify-center gap-3 disabled:opacity-40 active:scale-[.98] shadow-[0_4px_18px_rgba(5,150,105,.3)]">
        {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={20} />}
        POTWIERDŹ
      </button>
    </div>
  )
}

// ─── Ekran po zakończeniu sesji ───────────────────────────────
function DoneScreen({ order, kgActual, seasonedBatchNo, onNext, onHome }: {
  order: MixingOrder; kgActual: number; seasonedBatchNo: string
  onNext: () => void; onHome: () => void
}) {
  const kgRemaining = (order as any).kgRemaining ?? 0
  const isFullyDone = kgRemaining < 0.1

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-5 text-center max-w-sm mx-auto">
      <div className={cn('w-20 h-20 rounded-full flex items-center justify-center mb-5', isFullyDone?'bg-success':'bg-amber-400')}>
        <CheckCircle size={44} className="text-white" strokeWidth={2.5} />
      </div>
      <h2 className="text-3xl font-black text-ink mb-1">
        {isFullyDone ? 'Zlecenie ukończone!' : 'Sesja zakończona!'}
      </h2>
      <div className="font-mono font-bold text-brand mb-1">{order.orderNo} · Masownica {order.machineId}</div>

      {!isFullyDone && (
        <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 text-left">
          <div className="text-[11px] font-bold text-amber-700 uppercase mb-1">Pozostało do wymieszania</div>
          <div className="text-2xl font-black text-amber-700">{fmtKg(kgRemaining)} kg</div>
          <div className="text-[12px] text-amber-600 mt-0.5">
            Wykonano {fmtKg(kgActual)} kg. Załaduj kolejną masownicę.
          </div>
          {/* Postęp */}
          <div className="h-2 bg-amber-200 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full"
              style={{ width: `${Math.min(100, (((order as any).kgDone ?? 0) / order.meatKg) * 100)}%` }} />
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">
            {fmtKg((order as any).kgDone ?? 0)} / {fmtKg(order.meatKg)} kg
          </div>
        </div>
      )}

      <div className="w-full bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-left">
        <div className="text-[10px] font-bold text-green-700 uppercase mb-1">Dodano do magazynu</div>
        <div className="font-mono font-black text-green-700 text-lg">{seasonedBatchNo}</div>
        <div className="text-[12px] text-green-600 mt-0.5">{order.recipeName} · {fmtKg(kgActual)} kg</div>
      </div>

      <div className="w-full bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 text-left">
        <div className="text-[10px] font-bold text-blue-700 uppercase mb-1">Traceability</div>
        {order.meatLots.map(lot => (
          <div key={lot.meatLotId} className="flex justify-between text-[12px] py-0.5">
            <span className="font-mono font-bold">{lot.meatLotNo}</span>
            <span className="text-ink-3">{lot.rawBatchNo}</span>
            <span className="font-semibold text-blue-700">{fmtKg(lot.kgPlanned)} kg</span>
          </div>
        ))}
      </div>

      <div className="flex gap-3 w-full">
        <button onClick={onHome}
          className="flex-1 h-12 bg-white border-2 border-surface-4 text-ink rounded-2xl font-semibold flex items-center justify-center gap-2">
          <Home size={16} /> Menu
        </button>
        {!isFullyDone && (
          <button onClick={onNext}
            className="flex-1 h-12 bg-amber-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2">
            <Play size={16} /> Kolejna maszyna
          </button>
        )}
        {isFullyDone && (
          <button onClick={onHome}
            className="flex-1 h-12 bg-brand text-white rounded-2xl font-bold flex items-center justify-center gap-2">
            <RotateCcw size={16} /> Nowe zlecenie
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Ekran podsumowania przed uruchomieniem masownicy ────────
function ReviewScreen({ order, kgActual, lotAllocs, onStart, loading }: {
  order: MixingOrder; kgActual: number
  lotAllocs: { meatLotId: string; kg: number }[]
  onStart: () => void; loading: boolean
}) {
  return (
    <div className="max-w-md mx-auto px-5 py-5">
      <div className="font-mono text-sm text-brand font-bold mb-1">{order.orderNo} · Masownica {order.machineId}</div>
      <h2 className="text-xl font-black text-ink mb-1">{order.recipeName}</h2>
      <p className="text-sm text-ink-3 mb-4">Sprawdź składniki przed uruchomieniem masownicy</p>

      {/* Mięso — pokaż ile faktycznie załadowano z każdej partii */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3">
        <div className="text-[10px] font-bold text-blue-700 uppercase mb-2">Mięso załadowane</div>
        {order.meatLots.map(lot => {
          const loaded = lotAllocs.find(a => a.meatLotId === lot.meatLotId)?.kg ?? 0
          if (loaded <= 0) return null
          return (
            <div key={lot.meatLotId} className="flex justify-between text-[13px] py-1 border-b border-blue-100 last:border-0">
              <span className="font-mono font-bold">{lot.meatLotNo}</span>
              <span className="text-ink-3 text-[11px]">{lot.rawBatchNo}</span>
              <span className="font-bold text-blue-700">{fmtKg(loaded)} kg</span>
            </div>
          )
        })}
        <div className="flex justify-between text-[13px] pt-2 font-black text-blue-800">
          <span>Łącznie mięso:</span>
          <span>{fmtKg(kgActual)} kg</span>
        </div>
      </div>

      {/* Składniki — skalowane do faktycznie załadowanego mięsa (kgActual) */}
      <div className="bg-surface-2 border border-surface-4 rounded-xl overflow-hidden mb-4">
        <div className="text-[10px] font-bold text-ink-3 uppercase px-3 py-2 border-b">
          Składniki na {fmtKg(kgActual)} kg mięsa
        </div>
        {order.steps.map(s => {
          const factor = order.meatKg > 0 ? kgActual / order.meatKg : 1
          const qty = ((s as any).qtyConfirmed != null)
            ? (s as any).qtyConfirmed
            : s.qtyRequired * factor
          return (
            <div key={s.stepNo} className="flex items-center justify-between px-3 py-2.5 border-b last:border-0">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-success flex-shrink-0" />
                <span className="font-semibold text-ink text-[14px]">{s.ingredientName}</span>
              </div>
              <span className="font-black text-success text-[18px] tabular-nums">
                {qty.toFixed(2)}
                <span className="text-[12px] font-medium text-ink-3 ml-1">{s.unit}</span>
              </span>
            </div>
          )
        })}
      </div>

      <button onClick={onStart} disabled={loading}
        className="w-full h-16 bg-success text-white rounded-2xl text-lg font-black flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[.98] shadow-[0_4px_18px_rgba(5,150,105,.3)]">
        {loading
          ? <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          : <Play size={24} />}
        Rozpocznij masowanie
      </button>
      <p className="text-center text-[11px] text-ink-4 mt-2">Po kliknięciu masownica zostanie uruchomiona</p>
    </div>
  )
}

// ─── Główna strona ────────────────────────────────────────────
type Phase = 'list' | 'machine' | 'meat' | 'steps' | 'review' | 'done'

export function MixingTabletPage() {
  // confirmed + in_progress z pozostałymi kg — operator widzi zlecenie nawet
  // gdy masownica już pracuje i może załadować kolejną masownicę od razu.
  const { data: plannedAll, loading, refetch } = useApi(() =>
    mixingOrdersApi.list().then((all: any[]) =>
      all
        .filter((o: any) =>
          o.status === 'confirmed' ||
          (o.status === 'in_progress' && ((o as any).kgRemaining ?? o.meatKg) > 0.1)
        )
        .sort((a: any, b: any) =>
          a.status === 'in_progress' && b.status !== 'in_progress' ? -1
          : b.status === 'in_progress' && a.status !== 'in_progress' ? 1
          : 0
        )
    )
  )
  const planned = plannedAll
  const { data: inProgress, refetch:rIP} = useApi(() => mixingOrdersApi.list('in_progress'))
  const { data: locks,                   refetch:rL } = useApi(() => machineLockApi.list())

  const { data: mixingSession, refetch: refetchSession } = useApi(() => productionSessionsApi.active('mixing'))
  // Dostępne loty mięsa (FEFO) — dla zleceń z planu dnia bez prealokacji
  const { data: meatStockData, refetch: refetchMeatStock } = useApi(() => meatStockApi.list())
  const availableMeatLots = useMemo(() =>
    ((meatStockData as any)?.data ?? [])
      .filter((m: any) => m.status !== 'DEPLETED' && Number(m.kgAvailable) - Number(m.kgReserved ?? 0) > 0.01)
      .sort((a: any, b: any) => (a.expiryDate > b.expiryDate ? 1 : -1))
      .map((m: any) => ({
        meatLotId: m.id, meatLotNo: m.lotNo, rawBatchNo: m.rawBatchNo ?? '',
        kgPlanned: Math.max(0, Number(m.kgAvailable) - Number(m.kgReserved ?? 0)),
        expiryDate: m.expiryDate ?? '', materialName: m.materialName ?? '',
      })),
    [meatStockData])
  const startSessionMut = useMutation(() => productionSessionsApi.start({ processType: 'mixing' }))
  const closeSessionMut = useMutation((id: string) => productionSessionsApi.close(id, {}))

  // Sesja startuje LAZILY: dopiero gdy operator naprawdę zaczyna pracę
  // (pierwsza maszyna). Brak auto-startu na otwarcie tabletu — inaczej
  // "Na żywo" świeci się mimo braku zleceń / faktycznej aktywności.
  const ensureSession = useCallback(async () => {
    if (mixingSession && mixingSession.status === 'open') return
    try {
      await startSessionMut.mutate()
      await refetchSession()
    } catch {/* ignore — istniejąca sesja zwróci 200 z istniejącą */}
  }, [mixingSession, startSessionMut, refetchSession])

  const startMut       = useMutation(({id,dto}:{id:string;dto:any}) => mixingOrdersApi.start(id,dto))
  const allocMut       = useMutation(({id,m,kg}:{id:string;m:MachineId;kg:number}) => mixingOrdersApi.allocateToMachine(id,m,kg))
  const confirmMut     = useMutation(({id,dto}:{id:string;dto:any}) => mixingOrdersApi.confirmStep(id,dto))
  const finishMut      = useMutation(({id,kg,batchNo,lotAllocations}:{id:string;kg:number;batchNo:string;lotAllocations?:any[]}) => mixingOrdersApi.finishSession(id,kg,batchNo,lotAllocations))
  const lockMut        = useMutation(({m,id,no}:{m:MachineId;id:string;no:string}) => machineLockApi.lock(m,id,no,50))
  const autoApproveMut = useMutation((id:string) => mixingOrdersApi.autoApprove(id))

  const [phase,    setPhase]    = useState<Phase>('list')
  const [selOrder, setSelOrder] = useState<MixingOrder | null>(null)
  const [liveOrder,setLiveOrder]= useState<MixingOrder | null>(null)
  const [kgActual, setKgActual] = useState(0)
  const [lotAllocs,setLotAllocs]= useState<{ meatLotId: string; kg: number }[]>([])
  const [stepIdx,  setStepIdx]  = useState(0)
  const [seasonedBatchNo, setSeasonedBatchNo] = useState('')
  const [activeLock, setActiveLock] = useState<MachineLock | null>(null)
  const [sessionFullyDone, setSessionFullyDone] = useState(false)
  const [toast, setToast] = useState('')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4500) }

  const handleComplete = useCallback(async () => {
    if (!liveOrder) { handleHome(); return }
    try {
      await autoApproveMut.mutate(liveOrder.id)
    } catch(e) { console.warn('autoApprove:', e) }
    handleHome()
  }, [liveOrder, autoApproveMut])

  function handleHome() {
    setPhase('list'); setSelOrder(null); setLiveOrder(null)
    setKgActual(0); setLotAllocs([]); setStepIdx(0)
    refetch(); rIP(); rL(); refetchMeatStock()
  }

  const handleStartMachine = useCallback(async (machineId: MachineId) => {
    if (!selOrder) return
    try {
      // Sesja masowania startuje przy pierwszym realnym działaniu operatora.
      await ensureSession()
      const updated = await startMut.mutate({ id: selOrder.id, dto: { machineId } })
      setLiveOrder(updated)
      setPhase('meat')
      refetch(); rIP()
    } catch(e) { showToast(e instanceof Error ? e.message : 'Błąd') }
  }, [selOrder, startMut, ensureSession, refetch, rIP])

  const handleMeatConfirm = useCallback(async (allocs: { meatLotId: string; kg: number }[], totalKg: number) => {
    if (!liveOrder) return
    setKgActual(totalKg)
    setLotAllocs(allocs)
    // Alokuj do maszyny atomowo
    try { await allocMut.mutate({ id: liveOrder.id, m: liveOrder.machineId!, kg: totalKg }) }
    catch(e) { console.warn('allocate:', e) }
    setStepIdx(0)
    setPhase('steps')
  }, [liveOrder, allocMut])

  const handleConfirmStep = useCallback(async (stepNo: number, qty: number) => {
    if (!liveOrder) return
    try {
      const updated = await confirmMut.mutate({ id: liveOrder.id, dto: { stepNo, qtyConfirmed: qty } })
      setLiveOrder(updated)
      const next = updated.steps.findIndex((s: any) => !s.confirmed)
      if (next === -1) {
        // Wszystkie kroki potwierdzone — przejdź do ekranu podsumowania
        setPhase('review')
      } else {
        setStepIdx(next)
      }
    } catch(e) { showToast(e instanceof Error ? e.message : 'Błąd') }
  }, [liveOrder, kgActual, confirmMut, finishMut, lockMut, refetch, rIP, rL])

  const handleStartMixing = useCallback(async () => {
    if (!liveOrder) return
    try {
      const finished = await finishMut.mutate({ id: liveOrder.id, kg: kgActual, batchNo: '', lotAllocations: lotAllocs })
      setLiveOrder(finished)
      // Prawdziwy numer partii nadaje backend (np. 326 / PP1) — bierzemy go z ostatniej sesji,
      // a nie budujemy z numeru zlecenia (który jest teraz MAS/dd/mm/rr).
      const sess = (finished as any).sessions || []
      const batchNo = sess.length ? (sess[sess.length - 1]?.batchNo || '') : ''
      setSeasonedBatchNo(batchNo)
      // Zlecenie skończone TYLKO gdy całe zaplanowane kg przeszło przez maszynę.
      // BUG (zgłoszony: "3000 kg znika po 600 kg"): warunek miał odwrócony status
      // ('in_progress' zamiast 'done') — częściowy wsad pokazywał "Zakończ
      // masowanie", a klik robił auto-approve całego zlecenia.
      const fullyDone = (finished as any).kgRemaining < 0.1 || finished.status === 'done'
      setSessionFullyDone(fullyDone)
      const lock = await lockMut.mutate({ m: liveOrder.machineId!, id: liveOrder.id, no: liveOrder.orderNo })
      // Pełna sesja → CooldownTimer (operator czeka na ostygnięcie).
      // Częściowa sesja → DoneScreen z "Kolejna maszyna" — operator może od razu
      // załadować kolejną masownicę. Blokada maszyny i tak jest w DB i widać ją
      // jako "🔒 X min" w MachineScreen przy wyborze maszyny dla kolejnej sesji.
      setActiveLock(fullyDone ? lock : null)
      setPhase('done')
      refetch(); rIP(); rL()
    } catch(e) { showToast(e instanceof Error ? e.message : 'Błąd') }
  }, [liveOrder, kgActual, lotAllocs, finishMut, lockMut, refetch, rIP, rL])

  const currentLocks = locks ?? []
  // Zlecenia in_progress z aktywną blokadą = masownica pracuje (chłodzenie).
  // Używane w sekcji "Masownice w pracy" i "Suma wszystkich masownic".
  const cooling = (inProgress ?? []).filter(o =>
    currentLocks.some(l => l.orderId === o.id)
  )

  // Dzień zamknięty na tablecie — czeka na biuro (lub już potwierdzone)
  const sessionClosed = mixingSession && (mixingSession.status === 'closed' || mixingSession.status === 'approved')
  if (sessionClosed && phase === 'list') {
    const closedAt = mixingSession.endedAt ? new Date(mixingSession.endedAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'}) : ''
    const isApproved = mixingSession.status === 'approved'
    return (
      <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className={cn('w-20 h-20 rounded-3xl flex items-center justify-center mb-5 mx-auto',
            isApproved ? 'bg-green-100' : 'bg-amber-100')}>
            <CheckCircle size={40} className={isApproved ? 'text-green-600' : 'text-amber-600'}/>
          </div>
          <h2 className="text-2xl font-black text-ink mb-2">
            {isApproved ? 'Dzień zatwierdzony' : 'Dzień zakończony'}
          </h2>
          <p className="text-sm text-ink-3 mb-1">
            {isApproved
              ? `Biuro zatwierdziło sesję ${mixingSession.sessionDate}`
              : `Czeka na potwierdzenie biura · zamknięte ${closedAt}`}
          </p>
          <p className="text-xs text-ink-4 mt-6">Wróć jutro lub poczekaj na nową sesję.</p>
        </div>
      </div>
    )
  }

  const handleCloseDay = async () => {
    if (!mixingSession || mixingSession.status !== 'open') return
    if (!confirm('Zakończyć dzień masowania? Biuro musi potwierdzić zamknięcie.')) return
    try {
      await closeSessionMut.mutate(mixingSession.id)
      await refetchSession()
      showToast('Dzień masowania zamknięty — czeka na biuro')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Błąd zamknięcia dnia')
    }
  }

  return (
    <div className="min-h-screen bg-surface-2">

      {phase === 'done' && activeLock && (
        <CooldownTimer lock={activeLock} isFullyDone={sessionFullyDone}
          onComplete={handleComplete} onHome={handleHome} />
      )}
      {phase === 'done' && !activeLock && liveOrder && (
        <DoneScreen order={liveOrder} kgActual={kgActual} seasonedBatchNo={seasonedBatchNo}
          onNext={() => { setPhase('list'); refetch(); rIP(); rL() }} onHome={handleHome} />
      )}
      {phase === 'machine' && selOrder && (
        <MachineScreen order={selOrder} locks={currentLocks}
          onConfirm={handleStartMachine} onBack={handleHome} loading={startMut.loading} />
      )}
      {phase === 'meat' && liveOrder && (
        <MeatScreen order={liveOrder} availableLots={availableMeatLots}
          onConfirm={handleMeatConfirm} onBack={() => setPhase('machine')} />
      )}
      {phase === 'steps' && liveOrder && (
        <StepScreen order={liveOrder} kgActual={kgActual} stepIdx={stepIdx}
          onConfirm={handleConfirmStep} onBack={() => setPhase('meat')} loading={confirmMut.loading} />
      )}
      {phase === 'review' && liveOrder && (
        <ReviewScreen order={liveOrder} kgActual={kgActual} lotAllocs={lotAllocs}
          onStart={handleStartMixing} loading={finishMut.loading || lockMut.loading} />
      )}

      {phase === 'list' && (
        <>
          {loading
            ? <div className="flex justify-center py-16"><Spinner size={32} /></div>
            : (planned??[]).length === 0
              ? (inProgress ?? []).length > 0
                // Reszta zlecenia jest w toku / masownica chłodzi — NIE jest tak,
                // że biuro nic nie zaplanowało. Pokaż pozostałe kg + wskaż sekcję
                // „Masownice w pracy" (poniżej), gdzie operator wznowi po ostygnięciu.
                ? <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
                    <Lock size={48} className="text-amber-500 mb-4" />
                    <h2 className="text-2xl font-black text-ink mb-2">Masowanie w toku</h2>
                    <p className="text-base text-ink-3 max-w-md">
                      Masownica chłodzi. Zostało <strong className="text-amber-600">{fmtKg((inProgress ?? []).reduce((s, o: any) => s + ((o.kgRemaining ?? o.meatKg) || 0), 0), 0)} kg</strong> do dokończenia — szczegóły niżej w „Masownice w pracy", wznów po ostygnięciu.
                    </p>
                  </div>
                : <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
                    <ClipboardList size={48} className="text-ink-5 mb-4" />
                    <h2 className="text-2xl font-black text-ink mb-2">Brak zleceń</h2>
                    <p className="text-base text-ink-3">Biuro nie zaplanowało masowania.</p>
                  </div>
              : <div className="max-w-2xl mx-auto px-5 py-5">
                  <div className="flex items-start justify-between mb-4 gap-3">
                    <div>
                      <h2 className="text-xl font-black text-ink mb-1">Wybierz zlecenie</h2>
                      <p className="text-sm text-ink-3">{(planned??[]).length} zleceń</p>
                    </div>
                    {mixingSession?.status === 'open' && (
                      <button onClick={handleCloseDay} disabled={closeSessionMut.loading}
                        className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 self-start">
                        <LogOut size={13}/>Zakończ dzień
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {(planned??[]).map(o => {
                      const kgDone      = (o as any).kgDone ?? 0
                      const kgRemaining = (o as any).kgRemaining ?? o.meatKg
                      const pct         = o.meatKg > 0 ? (kgDone / o.meatKg) * 100 : 0
                      const orderLocks  = currentLocks.filter((l: any) => l.orderId === o.id)
                      return (
                        <button key={o.id}
                          onClick={() => { setSelOrder(o); setLiveOrder(o); setPhase('machine') }}
                          className={`w-full text-left border-2 rounded-2xl p-4 hover:border-brand hover:shadow-md active:scale-[.99] transition-all ${
                            o.status === 'in_progress' ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-surface-4'
                          }`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-mono font-bold text-brand">{o.orderNo}</div>
                              <div className="text-lg font-black text-ink mt-0.5">{o.recipeName}</div>
                              {o.productTypeName && <div className="text-sm text-ink-3">{o.productTypeName}</div>}
                              {o.status === 'in_progress' && orderLocks.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {orderLocks.map((l: any) => {
                                    const minsLeft = Math.max(0, Math.ceil((new Date(l.unlocksAt).getTime() - Date.now()) / 60000))
                                    return (
                                      <span key={l.machineId}
                                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                        <Timer size={9}/> Masownica {l.machineId} · {minsLeft} min
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                              {o.status === 'in_progress' && orderLocks.length === 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 mt-1">
                                  Do wznowienia
                                </span>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-2xl font-black text-ink">{fmtKg(kgRemaining, 0)}</div>
                              <div className="text-xs text-amber-600 font-semibold">kg pozostało</div>
                              <div className="text-[10px] text-ink-3">z {fmtKg(o.meatKg, 0)} kg planu</div>
                            </div>
                          </div>
                          {/* Pasek postępu */}
                          {kgDone > 0 && (
                            <div className="mt-2">
                              <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100,pct)}%` }} />
                              </div>
                              <div className="flex justify-between text-[10px] mt-0.5">
                                <span className="text-green-700">Wykonano: {fmtKg(kgDone, 0)} kg</span>
                                <span className="text-ink-3">{Math.round(pct)}%</span>
                              </div>
                            </div>
                          )}
                          <div className="mt-2 flex gap-3 text-sm text-ink-3">
                            <span className="flex items-center gap-1"><Beef size={13}/>{o.meatLots.length} partie</span>
                            <span>{o.steps.length} składników</span>
                            <span className="text-green-700 font-semibold">→ {fmtKg(o.plannedOutputKg,0)} kg</span>
                          </div>
                          <div className="mt-2 flex gap-1 flex-wrap">
                            {o.meatLots.map((lot: any) => (
                              <span key={lot.meatLotId} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">
                                {lot.meatLotNo} {fmtKg(lot.kgPlanned,0)}kg
                              </span>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
          }

          {/* Kafelki aktywnych masownic — na dole */}
          {currentLocks.length > 0 && (
            <div className="max-w-2xl mx-auto px-5 pb-6">
              <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2 mt-4 flex items-center gap-1.5">
                <Lock size={12} /> Masownice w pracy
              </div>
              <div className="space-y-3">
                {currentLocks.map(l => {
                  const order = cooling.find(o => o.id === l.orderId)
                  return <MachineTile key={`${l.machineId}-${l.orderId}`} lock={l} order={order} />
                })}
                {/* Kafelek sumy wszystkich masownic */}
                {currentLocks.length > 1 && (() => {
                  const totalMeat = cooling.reduce((s, o) =>
                    s + (o.kgInMachine > 0 ? o.kgInMachine : (o.kgDone > 0 ? o.kgDone : o.meatKg)), 0)
                  const totalAdd  = cooling.reduce((s, o) => {
                    const km = o.kgInMachine > 0 ? o.kgInMachine : (o.kgDone > 0 ? o.kgDone : o.meatKg)
                    const f  = o.meatKg > 0 ? km / o.meatKg : 1
                    return s + (o.steps ?? []).reduce((a: number, st: any) =>
                      a + parseFloat(st.qtyConfirmed ?? st.qtyRequired ?? 0) * f, 0)
                  }, 0)
                  return (
                    <div className="bg-ink/5 border border-ink/10 rounded-2xl p-4">
                      <div className="text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-2">Suma wszystkich masownic</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white rounded-xl p-2 text-center">
                          <div className="text-[10px] font-bold text-ink-3 uppercase mb-0.5">Mięso łącznie</div>
                          <div className="text-lg font-black text-ink tabular-nums">{fmtKg(totalMeat, 0)}</div>
                          <div className="text-[10px] text-ink-3">kg</div>
                        </div>
                        <div className="bg-white rounded-xl p-2 text-center">
                          <div className="text-[10px] font-bold text-ink-3 uppercase mb-0.5">Dodatki łącznie</div>
                          <div className="text-lg font-black text-ink tabular-nums">{fmtKg(totalAdd, 1)}</div>
                          <div className="text-[10px] text-ink-3">kg</div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full bg-danger text-white text-sm font-semibold shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
