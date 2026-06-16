/**
 * HMI v2 — masowanie, panel 21" landscape, paleta Porcelana.
 * Zoptymalizowane pod mokre/brudne rękawice: ogromne przyciski (80px+),
 * duże cyfry, dotyk kciukiem. Ten sam flow co MixingTabletPage ale
 * przebudowany pod przemysłowy ekran dotykowy.
 */
import { useEffect, useRef, useState, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { mixingOrdersApi, machineLockApi, meatStockApi, productionSessionsApi } from '@/lib/apiClient'
import { useApi, useMutation } from '@/hooks/useApi'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import type { MixingOrder, MachineId, MachineLock } from '@/lib/mockApi'
import { Spinner } from '@/components/ui/widgets'
import {
  Play, CheckCircle, AlertTriangle, Lock, Timer,
  ClipboardList, Home, LogOut, CalendarDays, RefreshCw, Beef, RotateCcw,
} from 'lucide-react'

// ─── Paleta Porcelana ─────────────────────────────────────────────────────────
const VARS: CSSProperties = {
  ['--app' as string]:   '#EDF0F4',
  ['--panel' as string]: '#FFFFFF',
  ['--bd' as string]:    '#CDD5DE',
  ['--ink' as string]:   '#101820',
  ['--mut' as string]:   '#71808F',
  ['--grn' as string]:   '#15803D',
  ['--amb' as string]:   '#B45309',
  ['--red' as string]:   '#C0271E',
  ['--blu' as string]:   '#1D4ED8',
}

// ─── Zegar ────────────────────────────────────────────────────────────────────
const Clock = memo(function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="font-mono text-3xl font-black tabular-nums" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
})

// ─── PlanRail (szyna planu dnia) ──────────────────────────────────────────────
interface PlanItem {
  id: string; orderNo: string; recipeName: string
  meatKg: number; kgDone: number; status: string; daySeq: number
}

const ITEM_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  planned:     { label: 'W KOLEJCE',   color: 'var(--mut)', bg: 'var(--panel)' },
  confirmed:   { label: 'W KOLEJCE',   color: 'var(--mut)', bg: 'var(--panel)' },
  in_progress: { label: 'W MASOWNICY', color: 'var(--amb)', bg: '#FDF3E7' },
  done:        { label: 'GOTOWE',      color: 'var(--grn)', bg: '#EBF7EF' },
}

function PlanRail() {
  const [items, setItems] = useState<PlanItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [changed, setChanged] = useState(false)
  const revRef = useRef<string>('')

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const r = await mixingOrdersApi.dayPlan()
        if (cancelled) return
        const next = (r.items ?? []).map((o: any) => ({
          id: o.id, orderNo: o.orderNo, recipeName: o.recipeName,
          meatKg: o.meatKg, kgDone: o.kgDone, status: o.status, daySeq: o.daySeq,
        }))
        if (revRef.current && r.rev !== revRef.current) {
          setChanged(true)
          setTimeout(() => setChanged(false), 30000)
        }
        revRef.current = r.rev
        setItems(next)
        setLoaded(true)
      } catch { setLoaded(true) }
    }
    poll()
    const t = setInterval(poll, 10000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const totalKg = items.reduce((s, i) => s + i.meatKg, 0)
  const doneKg  = items.reduce((s, i) => s + Math.min(i.kgDone, i.meatKg), 0)
  const nextIdx = items.findIndex(i => i.status !== 'done')

  return (
    <aside className="w-[320px] flex-shrink-0 flex flex-col min-h-0 border-r-[3px]"
      style={{ borderColor: 'var(--bd)', background: 'var(--app)' }}>
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays size={18} style={{ color: 'var(--ink)' }} />
          <span className="text-[15px] font-black uppercase tracking-[.18em]" style={{ color: 'var(--ink)' }}>
            Plan dnia
          </span>
        </div>
        {loaded && items.length > 0 && (
          <div className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--mut)' }}>
            {fmtKg(doneKg, 0)} / {fmtKg(totalKg, 0)} kg · {items.filter(i => i.status === 'done').length}/{items.length} zleceń
          </div>
        )}
      </div>

      {changed && (
        <div className="mx-3 mb-2 rounded-xl border-[3px] px-3 py-2.5 flex items-center gap-2 flex-shrink-0 animate-pulse"
          style={{ borderColor: 'var(--amb)', background: '#FDF3E7', color: 'var(--amb)' }}>
          <RefreshCw size={18} />
          <span className="text-[13px] font-black uppercase">Plan zmieniony przez biuro</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2">
        {!loaded ? (
          <div className="text-center py-8 text-[14px] font-bold" style={{ color: 'var(--mut)' }}>Wczytuję…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border-[3px] border-dashed px-4 py-8 text-center text-[14px] font-bold"
            style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
            Brak planu na dziś.
          </div>
        ) : items.map((it, i) => {
          const st = ITEM_STATUS[it.status] ?? ITEM_STATUS.planned
          const isNext = i === nextIdx && it.status !== 'in_progress'
          const pct = it.meatKg > 0 ? Math.min(100, (it.kgDone / it.meatKg) * 100) : 0
          return (
            <div key={it.id} className="rounded-xl border-[3px] px-3 py-2.5"
              style={{
                borderColor: it.status === 'in_progress' ? 'var(--amb)' : isNext ? 'var(--ink)' : 'var(--bd)',
                background: st.bg,
              }}>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full border-[3px] flex items-center justify-center text-[15px] font-black flex-shrink-0"
                  style={it.status === 'done'
                    ? { background: 'var(--grn)', borderColor: 'var(--grn)', color: '#fff' }
                    : { borderColor: st.color, color: st.color, background: 'var(--panel)' }}>
                  {it.status === 'done' ? '✓' : (it.daySeq || i + 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-black truncate" style={{ color: 'var(--ink)' }}>{it.recipeName}</div>
                  <div className="text-[11px] font-bold" style={{ color: st.color }}>
                    {st.label}{isNext ? ' · NASTĘPNE' : ''}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[17px] font-black tabular-nums" style={{ color: 'var(--ink)' }}>{fmtKg(it.meatKg, 0)}</div>
                  <div className="text-[10px] font-bold" style={{ color: 'var(--mut)' }}>kg</div>
                </div>
              </div>
              {it.kgDone > 0 && it.status !== 'done' && (
                <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bd)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--amb)' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

// ─── Komponenty ekranów ───────────────────────────────────────────────────────

// Duży przycisk HMI
function HmiBtn({
  onClick, disabled, loading, color = 'grn', children, className = '',
}: {
  onClick: () => void; disabled?: boolean; loading?: boolean
  color?: 'grn' | 'amb' | 'ink' | 'red' | 'panel'; children: React.ReactNode; className?: string
}) {
  const bg = color === 'grn'   ? 'var(--grn)'
           : color === 'amb'   ? 'var(--amb)'
           : color === 'ink'   ? 'var(--ink)'
           : color === 'red'   ? 'var(--red)'
           : 'var(--panel)'
  const fg = color === 'panel' ? 'var(--ink)' : '#fff'
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'h-20 rounded-2xl flex items-center justify-center gap-3 text-xl font-black tracking-wide border-[3px] transition-all active:scale-[.97] disabled:opacity-40 select-none',
        className,
      )}
      style={{
        background: bg,
        color: fg,
        borderColor: color === 'panel' ? 'var(--bd)' : bg,
      }}
    >
      {loading
        ? <span className="w-7 h-7 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
        : children}
    </button>
  )
}

// ─── Ekran listy zleceń ───────────────────────────────────────────────────────
function ListScreenV2({
  orders, inProgress, locks, sessionOpen, loading,
  onSelect, onCloseDay, closeDayLoading,
}: {
  orders: any[]; inProgress: any[]; locks: MachineLock[]; sessionOpen: boolean; loading: boolean
  onSelect: (o: any) => void; onCloseDay: () => void; closeDayLoading: boolean
}) {
  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner size={48} />
    </div>
  )

  if (orders.length === 0) {
    const hasInProgress = inProgress.length > 0
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col items-center gap-4">
          <Lock size={64} style={{ color: hasInProgress ? 'var(--amb)' : 'var(--mut)' }} />
          <div className="text-3xl font-black" style={{ color: 'var(--ink)' }}>
            {hasInProgress ? 'Masowanie w toku' : 'Brak zleceń'}
          </div>
          <div className="text-lg text-center" style={{ color: 'var(--mut)' }}>
            {hasInProgress
              ? `Pozostało ${fmtKg(inProgress.reduce((s, o: any) => s + ((o.kgRemaining ?? o.meatKg) || 0), 0), 0)} kg — masownica chłodzi`
              : 'Biuro nie zaplanowało masowania'}
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <ActiveMachinesPanel locks={locks} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Wybierz zlecenie</div>
          {sessionOpen && (
            <button onClick={onCloseDay} disabled={closeDayLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-[3px] text-[15px] font-bold disabled:opacity-50 transition-all active:scale-[.97]"
              style={{ borderColor: 'var(--amb)', color: 'var(--amb)', background: '#FDF3E7' }}>
              <LogOut size={16} /> Zakończ dzień
            </button>
          )}
        </div>
        <div className="space-y-3">
          {orders.map(o => {
            const kgDone      = (o as any).kgDone ?? 0
            const kgRemaining = (o as any).kgRemaining ?? o.meatKg
            const pct         = o.meatKg > 0 ? (kgDone / o.meatKg) * 100 : 0
            const orderLocks  = locks.filter((l: any) => l.orderId === o.id)
            const isIP        = o.status === 'in_progress'
            return (
              <button key={o.id}
                onClick={() => onSelect(o)}
                className="w-full text-left rounded-2xl border-[3px] p-5 transition-all active:scale-[.99] select-none"
                style={{
                  borderColor: isIP ? 'var(--amb)' : 'var(--bd)',
                  background: isIP ? '#FDF3E7' : 'var(--panel)',
                }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-mono text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{o.orderNo}</div>
                    <div className="text-2xl font-black mt-0.5" style={{ color: 'var(--ink)' }}>{o.recipeName}</div>
                    {orderLocks.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {orderLocks.map((l: any) => {
                          const min = Math.max(0, Math.ceil((new Date(l.unlocksAt).getTime() - Date.now()) / 60000))
                          return (
                            <span key={l.machineId}
                              className="inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1 rounded-full"
                              style={{ background: '#FDF3E7', color: 'var(--amb)', border: '2px solid var(--amb)' }}>
                              <Timer size={12} /> Masownica {l.machineId} · {min} min
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {isIP && orderLocks.length === 0 && (
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1 rounded-full mt-2"
                        style={{ background: '#EBF0FF', color: 'var(--blu)', border: '2px solid #93C5FD' }}>
                        Do wznowienia
                      </span>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-4xl font-black tabular-nums" style={{ color: 'var(--ink)' }}>
                      {fmtKg(kgRemaining, 0)}
                    </div>
                    <div className="text-[13px] font-bold" style={{ color: 'var(--amb)' }}>kg pozostało</div>
                    <div className="text-[12px]" style={{ color: 'var(--mut)' }}>z {fmtKg(o.meatKg, 0)} kg</div>
                  </div>
                </div>
                {kgDone > 0 && (
                  <div className="mt-3">
                    <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bd)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: 'var(--grn)' }} />
                    </div>
                    <div className="flex justify-between text-[12px] mt-1">
                      <span style={{ color: 'var(--grn)' }}>Wykonano: {fmtKg(kgDone, 0)} kg</span>
                      <span style={{ color: 'var(--mut)' }}>{Math.round(pct)}%</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-4 mt-2 text-[13px]" style={{ color: 'var(--mut)' }}>
                  <span className="flex items-center gap-1"><Beef size={13} /> {o.meatLots.length} partie</span>
                  <span>{o.steps.length} składników</span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Aktywne masownice */}
        <ActiveMachinesPanel locks={locks} />
      </div>
    </div>
  )
}

function ActiveMachinesPanel({ locks }: { locks: MachineLock[] }) {
  if (locks.length === 0) return null
  return (
    <div className="mt-6">
      <div className="text-[13px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--mut)' }}>
        Masownice w pracy
      </div>
      <div className="grid grid-cols-3 gap-3">
        {locks.map(l => <ActiveMachineTile key={`${l.machineId}-${l.orderId}`} lock={l} />)}
      </div>
    </div>
  )
}

function ActiveMachineTile({ lock }: { lock: MachineLock }) {
  const [rem, setRem] = useState(() =>
    Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
  )
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
      setRem(s)
      if (s === 0) clearInterval(t)
    }, 1000)
    return () => clearInterval(t)
  }, [lock.unlocksAt])
  const mm = String(Math.floor(rem / 60)).padStart(2, '0')
  const ss = String(rem % 60).padStart(2, '0')
  return (
    <div className="rounded-2xl border-[3px] p-4 text-center"
      style={{ borderColor: 'var(--amb)', background: '#FDF3E7' }}>
      <Timer size={20} style={{ color: 'var(--amb)' }} className="mx-auto mb-1" />
      <div className="text-lg font-black" style={{ color: 'var(--ink)' }}>Masownica {lock.machineId}</div>
      <div className="text-[12px] font-mono font-bold truncate" style={{ color: 'var(--mut)' }}>
        {lock.orderNo}
      </div>
      <div className="text-3xl font-black font-mono tabular-nums" style={{ color: 'var(--amb)' }}>{mm}:{ss}</div>
    </div>
  )
}

// ─── Wybór maszyny ────────────────────────────────────────────────────────────
function MachineScreenV2({ order, locks, onConfirm, onBack, loading }: {
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

  return (
    <div className="flex-1 flex flex-col px-8 py-6 max-w-3xl mx-auto w-full">
      <div className="mb-1 font-mono font-bold text-[14px]" style={{ color: 'var(--mut)' }}>{order.orderNo}</div>
      <div className="text-3xl font-black mb-1" style={{ color: 'var(--ink)' }}>{order.recipeName}</div>

      {/* Postęp */}
      <div className="rounded-2xl border-[3px] p-4 mb-6" style={{ borderColor: 'var(--bd)', background: 'var(--panel)' }}>
        <div className="text-[12px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--mut)' }}>Postęp zlecenia</div>
        <div className="h-4 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bd)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (kgDone / order.meatKg) * 100)}%`, background: 'var(--grn)' }} />
        </div>
        <div className="flex justify-between text-[15px] font-bold">
          <span style={{ color: 'var(--grn)' }}>Wykonano: {fmtKg(kgDone)} kg</span>
          <span style={{ color: 'var(--ink)' }}>Plan: {fmtKg(order.meatKg)} kg</span>
          <span style={{ color: 'var(--amb)' }}>Pozostało: {fmtKg(kgRemaining)} kg</span>
        </div>
      </div>

      <div className="text-[14px] font-black uppercase tracking-widest mb-4" style={{ color: 'var(--mut)' }}>
        Wybierz masownicę
      </div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {([1, 2, 3] as MachineId[]).map(m => {
          const locked = isLocked(m)
          const isSel  = sel === m
          const mins   = getLockMins(m)
          return (
            <button key={m}
              onClick={() => !locked && setSel(m)}
              disabled={locked}
              className="flex flex-col items-center justify-center h-40 rounded-2xl border-[3px] transition-all active:scale-[.97] select-none"
              style={{
                borderColor: locked ? 'var(--red)' : isSel ? 'var(--grn)' : 'var(--bd)',
                background:  locked ? '#FEF2F2' : isSel ? '#ECFDF5' : 'var(--panel)',
                opacity: locked ? 0.7 : 1,
              }}>
              {locked && <Lock size={28} style={{ color: 'var(--red)' }} className="mb-1" />}
              <div className="text-6xl font-black" style={{ color: locked ? 'var(--red)' : isSel ? 'var(--grn)' : 'var(--ink)' }}>
                {m}
              </div>
              <div className="text-[14px] font-bold mt-1" style={{ color: locked ? 'var(--red)' : isSel ? 'var(--grn)' : 'var(--mut)' }}>
                {locked ? `~${mins} min` : 'Masownica'}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex gap-4 mt-auto">
        <HmiBtn onClick={onBack} color="panel" className="flex-1">← Wstecz</HmiBtn>
        <HmiBtn onClick={() => sel && onConfirm(sel)} disabled={!sel} loading={loading} color="grn" className="flex-2 flex-1">
          <Play size={24} /> Dalej — wpisz mięso
        </HmiBtn>
      </div>
    </div>
  )
}

// ─── Wprowadzanie mięsa ───────────────────────────────────────────────────────
interface MeatScreenLot {
  meatLotId: string; meatLotNo: string; rawBatchNo: string
  kgPlanned: number; expiryDate: string
}

function MeatScreenV2({ order, availableLots, onConfirm, onBack }: {
  order: MixingOrder; availableLots?: MeatScreenLot[]
  onConfirm: (allocs: { meatLotId: string; kg: number }[], total: number) => void
  onBack: () => void
}) {
  const kgRemaining = (order as any).kgRemaining ?? order.meatKg
  const lots: MeatScreenLot[] = order.meatLots.length > 0 ? (order.meatLots as any) : (availableLots ?? [])
  const [lotKgs, setLotKgs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    lots.forEach(lot => { init[lot.meatLotId] = '' })
    return init
  })
  const totalKg = Object.values(lotKgs).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const isOverRemaining = totalKg > kgRemaining + 0.01
  const lotErrors: Record<string, string> = {}
  lots.forEach(lot => {
    const kg = parseFloat(lotKgs[lot.meatLotId] || '0') || 0
    if (kg > lot.kgPlanned + 0.01) lotErrors[lot.meatLotId] = `Maks. ${fmtKg(lot.kgPlanned)} kg`
  })
  const hasErrors = Object.keys(lotErrors).length > 0 || isOverRemaining
  const canConfirm = totalKg > 0 && !hasErrors

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-8 py-5 max-w-2xl mx-auto w-full">
      <div className="mb-1 font-mono font-bold text-[14px]" style={{ color: 'var(--mut)' }}>
        {order.orderNo} · Masownica {order.machineId}
      </div>
      <div className="text-2xl font-black mb-1" style={{ color: 'var(--ink)' }}>{order.recipeName}</div>
      <div className="text-[16px] mb-5" style={{ color: 'var(--mut)' }}>
        Pozostało: <strong style={{ color: 'var(--amb)' }}>{fmtKg(kgRemaining)} kg</strong>
      </div>

      <div className="space-y-3 mb-5">
        {lots.map(lot => {
          const err   = lotErrors[lot.meatLotId]
          const hasKg = (parseFloat(lotKgs[lot.meatLotId] || '0') || 0) > 0
          return (
            <div key={lot.meatLotId}
              className="rounded-2xl border-[3px] p-4"
              style={{
                borderColor: err ? 'var(--red)' : hasKg ? 'var(--grn)' : 'var(--bd)',
                background: 'var(--panel)',
              }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[18px] font-black" style={{ color: 'var(--blu)' }}>{lot.meatLotNo}</span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{lot.rawBatchNo}</span>
                <span className="text-[14px] font-bold" style={{ color: 'var(--mut)' }}>maks. {fmtKg(lot.kgPlanned)} kg</span>
              </div>
              <div className="flex items-baseline gap-2">
                <input type="number" inputMode="decimal" min="0" step="0.1"
                  max={lot.kgPlanned}
                  placeholder="0"
                  value={lotKgs[lot.meatLotId]}
                  onFocus={e => e.target.select()}
                  onChange={e => setLotKgs(p => ({ ...p, [lot.meatLotId]: e.target.value }))}
                  className="flex-1 border-none bg-transparent outline-none font-black tabular-nums leading-none"
                  style={{
                    fontSize: '64px',
                    color: err ? 'var(--red)' : 'var(--ink)',
                  }} />
                <span className="text-2xl font-medium" style={{ color: 'var(--mut)' }}>kg</span>
              </div>
              {err && (
                <div className="text-[13px] font-bold mt-1 flex items-center gap-1" style={{ color: 'var(--red)' }}>
                  <AlertTriangle size={13} /> {err}
                </div>
              )}
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--mut)' }}>do: {fmtDatePl(lot.expiryDate)}</div>
            </div>
          )
        })}
      </div>

      {/* Suma */}
      <div className="rounded-2xl border-[3px] p-4 mb-5 flex items-center justify-between"
        style={{
          borderColor: isOverRemaining ? 'var(--red)' : totalKg > 0 ? 'var(--grn)' : 'var(--bd)',
          background: isOverRemaining ? '#FEF2F2' : totalKg > 0 ? '#ECFDF5' : 'var(--panel)',
        }}>
        <span className="text-[16px] font-bold" style={{ color: 'var(--mut)' }}>Łącznie do tej maszyny:</span>
        <span className="text-4xl font-black tabular-nums" style={{ color: isOverRemaining ? 'var(--red)' : 'var(--grn)' }}>
          {fmtKg(totalKg)} kg
        </span>
      </div>
      {isOverRemaining && (
        <div className="text-[14px] font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--red)' }}>
          <AlertTriangle size={16} /> Przekroczono pozostałe {fmtKg(kgRemaining)} kg!
        </div>
      )}

      <div className="flex gap-4">
        <HmiBtn onClick={onBack} color="panel" className="flex-1">← Wstecz</HmiBtn>
        <HmiBtn
          onClick={() => {
            const allocs = lots
              .map(lot => ({ meatLotId: lot.meatLotId, kg: parseFloat(lotKgs[lot.meatLotId] || '0') || 0 }))
              .filter(a => a.kg > 0)
            onConfirm(allocs, totalKg)
          }}
          disabled={!canConfirm} color="grn" className="flex-1">
          <Beef size={22} /> Przelicz składniki
        </HmiBtn>
      </div>
    </div>
  )
}

// ─── Krok składnika ───────────────────────────────────────────────────────────
const WEIGHT_TOLERANCE_KG = 0.050

function StepScreenV2({ order, kgActual, stepIdx, onConfirm, onBack, loading }: {
  order: MixingOrder; kgActual: number; stepIdx: number
  onConfirm: (stepNo: number, qty: number) => void
  onBack: () => void; loading: boolean
}) {
  const step = order.steps[stepIdx]
  const total = order.steps.length
  const qtyRequired = Math.round(step.qtyRequired * (kgActual / order.meatKg) * 1000) / 1000
  const [qty, setQty] = useState('0')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setQty('0'); setTimeout(() => { inputRef.current?.select(); inputRef.current?.focus() }, 80) }, [stepIdx])

  const qtyVal  = parseFloat(qty) || 0
  const diff    = qtyVal - qtyRequired
  const absDiff = Math.abs(diff)
  const isOk    = qtyVal > 0 && absDiff <= WEIGHT_TOLERANCE_KG
  const isWarn  = qtyVal > 0 && absDiff > WEIGHT_TOLERANCE_KG && absDiff <= 0.2
  const isOver  = qtyVal > 0 && absDiff > 0.2
  const diffG   = Math.round(diff * 1000)

  return (
    <div className="flex-1 flex flex-col px-8 py-5 max-w-2xl mx-auto w-full">
      {/* Pasek postępu kroków */}
      <div className="flex items-center gap-2 mb-5">
        {order.steps.map((s, i) => (
          <div key={i} className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bd)' }}>
            <div className="h-full rounded-full" style={{
              width: i < stepIdx ? '100%' : i === stepIdx ? '50%' : '0%',
              background: i < stepIdx ? 'var(--grn)' : 'var(--amb)',
            }} />
          </div>
        ))}
        <span className="text-[14px] font-black" style={{ color: 'var(--mut)' }}>{stepIdx + 1}/{total}</span>
      </div>

      {/* Poprzednie kroki */}
      {stepIdx > 0 && (
        <div className="mb-4 space-y-1.5">
          {order.steps.slice(0, stepIdx).map(s => (
            <div key={s.stepNo} className="flex items-center gap-3 rounded-xl px-4 py-2.5"
              style={{ background: '#ECFDF5', border: '2px solid #86EFAC' }}>
              <CheckCircle size={18} style={{ color: 'var(--grn)' }} />
              <span className="text-[15px] font-bold" style={{ color: 'var(--grn)' }}>{s.ingredientName}</span>
              <span className="ml-auto font-mono text-[15px] font-black" style={{ color: 'var(--grn)' }}>
                {((s as any).qtyConfirmed ?? s.qtyRequired).toFixed(2)} {s.unit}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Aktualny składnik */}
      <div className="rounded-2xl border-[3px] p-5 mb-4 text-center flex-shrink-0"
        style={{
          borderColor: isOk ? 'var(--grn)' : isWarn ? 'var(--amb)' : isOver ? 'var(--red)' : 'var(--bd)',
          background:  isOk ? '#ECFDF5'   : isWarn ? '#FDF3E7'   : isOver ? '#FEF2F2'   : 'var(--panel)',
        }}>
        <div className="text-[13px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--mut)' }}>Dodaj składnik</div>
        <div className="text-3xl font-black mb-2" style={{ color: 'var(--ink)' }}>{step.ingredientName}</div>
        <div className="font-black tabular-nums" style={{ fontSize: '72px', lineHeight: 1, color: 'var(--ink)' }}>
          {qtyRequired.toFixed(2)}
        </div>
        <div className="text-2xl font-medium mt-1" style={{ color: 'var(--mut)' }}>{step.unit}</div>
        <div className="text-[12px] mt-1" style={{ color: 'var(--mut)' }}>Tolerancja: ±50 g</div>
      </div>

      {/* Pole wpisania */}
      <div className="rounded-2xl border-[3px] px-5 py-4 mb-2"
        style={{
          borderColor: isOk ? 'var(--grn)' : isWarn ? 'var(--amb)' : isOver ? 'var(--red)' : 'var(--bd)',
          background: 'var(--panel)',
        }}>
        <div className="text-[12px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--mut)' }}>Wpisz zważoną ilość</div>
        <div className="flex items-baseline gap-2">
          <input ref={inputRef} type="number" inputMode="decimal" min="0" step="0.001"
            value={qty} onFocus={e => e.target.select()} onChange={e => setQty(e.target.value)}
            className="flex-1 border-none bg-transparent outline-none font-black tabular-nums leading-none"
            style={{
              fontSize: '64px',
              color: isOk ? 'var(--grn)' : isWarn ? 'var(--amb)' : isOver ? 'var(--red)' : 'var(--ink)',
            }} />
          <span className="text-2xl font-medium" style={{ color: 'var(--mut)' }}>{step.unit}</span>
        </div>
        {qtyVal > 0 && (
          <div className="text-[14px] font-black mt-1 flex items-center gap-1.5"
            style={{ color: isOk ? 'var(--grn)' : isWarn ? 'var(--amb)' : 'var(--red)' }}>
            {isOk
              ? <><CheckCircle size={16} /> OK — {diffG > 0 ? '+' : ''}{diffG} g</>
              : <><AlertTriangle size={16} /> {isOver ? `Za duże! ${diffG > 0 ? '+' : ''}${diffG} g (max ±50g)` : `${diffG > 0 ? '+' : ''}${diffG} g`}</>}
          </div>
        )}
      </div>

      <div className="flex gap-4 mt-auto">
        <HmiBtn onClick={onBack} color="panel" className="flex-1">← Wstecz</HmiBtn>
        <HmiBtn onClick={() => isOk && onConfirm(step.stepNo, qtyVal)} disabled={!isOk} loading={loading} color="grn" className="flex-1">
          <CheckCircle size={22} /> POTWIERDŹ
        </HmiBtn>
      </div>
    </div>
  )
}

// ─── Podsumowanie (review) ────────────────────────────────────────────────────
function ReviewScreenV2({ order, kgActual, lotAllocs, onStart, loading }: {
  order: MixingOrder; kgActual: number
  lotAllocs: { meatLotId: string; kg: number }[]
  onStart: () => void; loading: boolean
}) {
  return (
    <div className="flex-1 flex flex-col px-8 py-5 max-w-2xl mx-auto w-full">
      <div className="font-mono text-[14px] font-bold mb-1" style={{ color: 'var(--mut)' }}>
        {order.orderNo} · Masownica {order.machineId}
      </div>
      <div className="text-2xl font-black mb-1" style={{ color: 'var(--ink)' }}>{order.recipeName}</div>
      <div className="text-[15px] mb-5" style={{ color: 'var(--mut)' }}>Sprawdź składniki przed uruchomieniem masownicy</div>

      {/* Mięso */}
      <div className="rounded-2xl border-[3px] p-4 mb-3" style={{ borderColor: '#93C5FD', background: '#EFF6FF' }}>
        <div className="text-[12px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--blu)' }}>Mięso załadowane</div>
        {order.meatLots.map(lot => {
          const loaded = lotAllocs.find(a => a.meatLotId === lot.meatLotId)?.kg ?? 0
          if (loaded <= 0) return null
          return (
            <div key={lot.meatLotId} className="flex justify-between text-[15px] py-1.5 border-b last:border-0"
              style={{ borderColor: '#BFDBFE' }}>
              <span className="font-mono font-bold">{lot.meatLotNo}</span>
              <span style={{ color: 'var(--mut)' }}>{lot.rawBatchNo}</span>
              <span className="font-bold" style={{ color: 'var(--blu)' }}>{fmtKg(loaded)} kg</span>
            </div>
          )
        })}
        <div className="flex justify-between text-[17px] pt-2 font-black" style={{ color: 'var(--blu)' }}>
          <span>Łącznie mięso:</span><span>{fmtKg(kgActual)} kg</span>
        </div>
      </div>

      {/* Składniki */}
      <div className="rounded-2xl border-[3px] overflow-hidden mb-6" style={{ borderColor: 'var(--bd)' }}>
        <div className="text-[12px] font-black uppercase tracking-widest px-4 py-2.5 border-b" style={{ borderColor: 'var(--bd)', background: 'var(--app)', color: 'var(--mut)' }}>
          Składniki na {fmtKg(kgActual)} kg mięsa
        </div>
        {order.steps.map(s => {
          const factor = order.meatKg > 0 ? kgActual / order.meatKg : 1
          const qty    = (s as any).qtyConfirmed != null ? (s as any).qtyConfirmed : s.qtyRequired * factor
          return (
            <div key={s.stepNo} className="flex items-center justify-between px-4 py-3 border-b last:border-0"
              style={{ borderColor: 'var(--bd)', background: 'var(--panel)' }}>
              <div className="flex items-center gap-2">
                <CheckCircle size={18} style={{ color: 'var(--grn)' }} />
                <span className="text-[17px] font-bold" style={{ color: 'var(--ink)' }}>{s.ingredientName}</span>
              </div>
              <span className="text-[22px] font-black tabular-nums" style={{ color: 'var(--grn)' }}>
                {qty.toFixed(2)} <span className="text-[14px] font-medium" style={{ color: 'var(--mut)' }}>{s.unit}</span>
              </span>
            </div>
          )
        })}
      </div>

      <HmiBtn onClick={onStart} loading={loading} color="grn" className="w-full text-2xl h-24">
        <Play size={28} /> ROZPOCZNIJ MASOWANIE
      </HmiBtn>
    </div>
  )
}

// ─── Ekran po zakończeniu sesji ───────────────────────────────────────────────
function DoneScreenV2({ order, kgActual, seasonedBatchNo, isFullyDone, onNext, onHome }: {
  order: MixingOrder; kgActual: number; seasonedBatchNo: string
  isFullyDone: boolean; onNext: () => void; onHome: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <div className={cn('w-28 h-28 rounded-full flex items-center justify-center mb-6')}
        style={{ background: isFullyDone ? 'var(--grn)' : 'var(--amb)' }}>
        <CheckCircle size={60} color="#fff" strokeWidth={2.5} />
      </div>
      <div className="text-4xl font-black mb-2" style={{ color: 'var(--ink)' }}>
        {isFullyDone ? 'Zlecenie ukończone!' : 'Sesja zakończona!'}
      </div>
      <div className="font-mono text-[16px] font-bold mb-4" style={{ color: 'var(--mut)' }}>
        {order.orderNo} · Masownica {order.machineId}
      </div>

      {!isFullyDone && (
        <div className="w-full max-w-sm rounded-2xl border-[3px] p-5 mb-4 text-left"
          style={{ borderColor: 'var(--amb)', background: '#FDF3E7' }}>
          <div className="text-[12px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--amb)' }}>
            Pozostało do wymieszania
          </div>
          <div className="text-4xl font-black" style={{ color: 'var(--amb)' }}>
            {fmtKg((order as any).kgRemaining ?? 0)} kg
          </div>
          <div className="text-[14px] mt-1" style={{ color: 'var(--amb)' }}>
            Wykonano {fmtKg(kgActual)} kg w tej sesji.
          </div>
        </div>
      )}

      <div className="w-full max-w-sm rounded-2xl border-[3px] p-5 mb-6 text-left"
        style={{ borderColor: '#86EFAC', background: '#ECFDF5' }}>
        <div className="text-[12px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--grn)' }}>
          Dodano do magazynu
        </div>
        <div className="font-mono text-[22px] font-black" style={{ color: 'var(--grn)' }}>{seasonedBatchNo}</div>
        <div className="text-[14px] mt-0.5" style={{ color: 'var(--grn)' }}>{order.recipeName} · {fmtKg(kgActual)} kg</div>
      </div>

      <div className="flex gap-4 w-full max-w-sm">
        <HmiBtn onClick={onHome} color="panel" className="flex-1"><Home size={20} /> Menu</HmiBtn>
        {!isFullyDone && (
          <HmiBtn onClick={onNext} color="amb" className="flex-1"><Play size={20} /> Kolejna maszyna</HmiBtn>
        )}
        {isFullyDone && (
          <HmiBtn onClick={onHome} color="grn" className="flex-1"><RotateCcw size={20} /> Nowe zlecenie</HmiBtn>
        )}
      </div>
    </div>
  )
}

// ─── Cooldown masownicy ───────────────────────────────────────────────────────
function CooldownV2({ lock, isFullyDone, onComplete, onHome }: {
  lock: MachineLock; isFullyDone: boolean; onComplete: () => void; onHome: () => void
}) {
  const [rem, setRem] = useState(() =>
    Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
  )
  const [expired, setExpired] = useState(rem === 0)
  useEffect(() => {
    if (rem === 0) { setExpired(true); return }
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
      setRem(s)
      if (s === 0) { clearInterval(t); setExpired(true) }
    }, 1000)
    return () => clearInterval(t)
  }, [lock.unlocksAt])
  const mm = String(Math.floor(rem / 60)).padStart(2, '0')
  const ss = String(rem % 60).padStart(2, '0')

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <Timer size={72} style={{ color: 'var(--amb)' }} className="mb-4" />
      <div className="text-3xl font-black mb-1" style={{ color: 'var(--ink)' }}>Masownica {lock.machineId}</div>
      <div className="text-[16px] mb-4" style={{ color: 'var(--mut)' }}>{lock.orderNo} — masowanie w trakcie</div>
      {!expired ? (
        <div className="font-mono font-black tabular-nums mb-6" style={{ fontSize: '96px', lineHeight: 1, color: 'var(--amb)' }}>
          {mm}:{ss}
        </div>
      ) : (
        <div className="mb-6">
          <div className="font-mono font-black tabular-nums" style={{ fontSize: '72px', lineHeight: 1, color: 'var(--grn)' }}>00:00</div>
          <div className="text-[16px] font-bold mt-1" style={{ color: 'var(--grn)' }}>Czas masowania upłynął</div>
        </div>
      )}
      <div className="flex gap-4">
        <HmiBtn onClick={onHome} color="panel" className="w-48"><Home size={20} /> Menu</HmiBtn>
        {isFullyDone && expired && (
          <HmiBtn onClick={onComplete} color="grn" className="w-64">
            <CheckCircle size={22} /> Zakończ masowanie
          </HmiBtn>
        )}
      </div>
    </div>
  )
}

// ─── Dzień zamknięty ──────────────────────────────────────────────────────────
function DayClosedScreen({ isApproved, closedAt }: { isApproved: boolean; closedAt: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="w-28 h-28 rounded-3xl flex items-center justify-center mb-6"
        style={{ background: isApproved ? '#DCFCE7' : '#FEF3C7' }}>
        <CheckCircle size={56} style={{ color: isApproved ? 'var(--grn)' : 'var(--amb)' }} />
      </div>
      <div className="text-4xl font-black mb-3" style={{ color: 'var(--ink)' }}>
        {isApproved ? 'Dzień zatwierdzony' : 'Dzień zakończony'}
      </div>
      <div className="text-[18px]" style={{ color: 'var(--mut)' }}>
        {isApproved ? 'Biuro zatwierdziło sesję.' : `Czeka na potwierdzenie biura · zamknięte ${closedAt}`}
      </div>
    </div>
  )
}

// ─── Główna logika HMI V2 ─────────────────────────────────────────────────────
type Phase = 'list' | 'machine' | 'meat' | 'steps' | 'review' | 'done'

function MixingHmiV2Main() {
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
  const { data: inProgress, refetch: rIP } = useApi(() => mixingOrdersApi.list('in_progress'))
  const { data: locks, refetch: rL }       = useApi(() => machineLockApi.list())
  const { data: mixingSession, refetch: refetchSession } = useApi(() => productionSessionsApi.active('mixing'))
  const { data: meatStockData, refetch: refetchMeatStock } = useApi(() => meatStockApi.list())

  const availableMeatLots = useMemo(() =>
    ((meatStockData as any)?.data ?? [])
      .filter((m: any) => m.status !== 'DEPLETED' && Number(m.kgAvailable) - Number(m.kgReserved ?? 0) > 0.01)
      .sort((a: any, b: any) => (a.expiryDate > b.expiryDate ? 1 : -1))
      .map((m: any) => ({
        meatLotId: m.id, meatLotNo: m.lotNo, rawBatchNo: m.rawBatchNo ?? '',
        kgPlanned: Math.max(0, Number(m.kgAvailable) - Number(m.kgReserved ?? 0)),
        expiryDate: m.expiryDate ?? '',
      })),
    [meatStockData])

  const startSessionMut = useMutation(() => productionSessionsApi.start({ processType: 'mixing' }))
  const closeSessionMut = useMutation((id: string) => productionSessionsApi.close(id, {}))
  const startMut       = useMutation(({ id, dto }: { id: string; dto: any }) => mixingOrdersApi.start(id, dto))
  const allocMut       = useMutation(({ id, m, kg }: { id: string; m: MachineId; kg: number }) => mixingOrdersApi.allocateToMachine(id, m, kg))
  const confirmMut     = useMutation(({ id, dto }: { id: string; dto: any }) => mixingOrdersApi.confirmStep(id, dto))
  const finishMut      = useMutation(({ id, kg, batchNo, lotAllocations }: { id: string; kg: number; batchNo: string; lotAllocations?: any[] }) => mixingOrdersApi.finishSession(id, kg, batchNo, lotAllocations))
  const lockMut        = useMutation(({ m, id, no }: { m: MachineId; id: string; no: string }) => machineLockApi.lock(m, id, no, 50))
  const autoApproveMut = useMutation((id: string) => mixingOrdersApi.autoApprove(id))

  const [phase,    setPhase]    = useState<Phase>('list')
  const [selOrder, setSelOrder] = useState<MixingOrder | null>(null)
  const [liveOrder, setLiveOrder] = useState<MixingOrder | null>(null)
  const [kgActual, setKgActual] = useState(0)
  const [lotAllocs, setLotAllocs] = useState<{ meatLotId: string; kg: number }[]>([])
  const [stepIdx,  setStepIdx]  = useState(0)
  const [seasonedBatchNo, setSeasonedBatchNo] = useState('')
  const [activeLock, setActiveLock] = useState<MachineLock | null>(null)
  const [sessionFullyDone, setSessionFullyDone] = useState(false)
  const [toast, setToast] = useState('')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4500) }

  const ensureSession = useCallback(async () => {
    if (mixingSession && mixingSession.status === 'open') return
    try { await startSessionMut.mutate(); await refetchSession() } catch { /* ignore */ }
  }, [mixingSession, startSessionMut, refetchSession])

  const handleHome = useCallback(() => {
    setPhase('list'); setSelOrder(null); setLiveOrder(null)
    setKgActual(0); setLotAllocs([]); setStepIdx(0)
    refetch(); rIP(); rL(); refetchMeatStock()
  }, [refetch, rIP, rL, refetchMeatStock])

  const handleComplete = useCallback(async () => {
    if (liveOrder) { try { await autoApproveMut.mutate(liveOrder.id) } catch { /* ignore */ } }
    handleHome()
  }, [liveOrder, autoApproveMut, handleHome])

  const handleStartMachine = useCallback(async (machineId: MachineId) => {
    if (!selOrder) return
    try {
      await ensureSession()
      const updated = await startMut.mutate({ id: selOrder.id, dto: { machineId } })
      setLiveOrder(updated)
      setPhase('meat')
      refetch(); rIP()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Błąd') }
  }, [selOrder, startMut, ensureSession, refetch, rIP])

  const handleMeatConfirm = useCallback(async (allocs: { meatLotId: string; kg: number }[], total: number) => {
    if (!liveOrder) return
    setKgActual(total); setLotAllocs(allocs)
    try { await allocMut.mutate({ id: liveOrder.id, m: liveOrder.machineId!, kg: total }) } catch { /* ignore */ }
    setStepIdx(0); setPhase('steps')
  }, [liveOrder, allocMut])

  const handleConfirmStep = useCallback(async (stepNo: number, qty: number) => {
    if (!liveOrder) return
    try {
      const updated = await confirmMut.mutate({ id: liveOrder.id, dto: { stepNo, qtyConfirmed: qty } })
      setLiveOrder(updated)
      const next = updated.steps.findIndex((s: any) => !s.confirmed)
      if (next === -1) setPhase('review')
      else setStepIdx(next)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Błąd') }
  }, [liveOrder, confirmMut])

  const handleStartMixing = useCallback(async () => {
    if (!liveOrder) return
    try {
      const finished = await finishMut.mutate({ id: liveOrder.id, kg: kgActual, batchNo: '', lotAllocations: lotAllocs })
      setLiveOrder(finished)
      const sess = (finished as any).sessions ?? []
      const batchNo = sess.length ? (sess[sess.length - 1]?.batchNo || '') : ''
      setSeasonedBatchNo(batchNo)
      const fullyDone = (finished as any).kgRemaining < 0.1 || finished.status === 'done'
      setSessionFullyDone(fullyDone)
      const lock = await lockMut.mutate({ m: liveOrder.machineId!, id: liveOrder.id, no: liveOrder.orderNo })
      setActiveLock(fullyDone ? lock : null)
      setPhase('done')
      refetch(); rIP(); rL()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Błąd') }
  }, [liveOrder, kgActual, lotAllocs, finishMut, lockMut, refetch, rIP, rL])

  const currentLocks = locks ?? []
  const sessionClosed = mixingSession && (mixingSession.status === 'closed' || mixingSession.status === 'approved')
  if (sessionClosed && phase === 'list') {
    const closedAt = mixingSession.endedAt ? new Date(mixingSession.endedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : ''
    return <DayClosedScreen isApproved={mixingSession.status === 'approved'} closedAt={closedAt} />
  }

  const handleCloseDay = async () => {
    if (!mixingSession || mixingSession.status !== 'open') return
    if (!confirm('Zakończyć dzień masowania? Biuro musi potwierdzić zamknięcie.')) return
    try {
      await closeSessionMut.mutate(mixingSession.id)
      await refetchSession()
      showToast('Dzień masowania zamknięty — czeka na biuro')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Błąd zamknięcia') }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: 'var(--app)' }}>
      {phase === 'done' && activeLock && liveOrder && (
        <CooldownV2 lock={activeLock} isFullyDone={sessionFullyDone} onComplete={handleComplete} onHome={handleHome} />
      )}
      {phase === 'done' && !activeLock && liveOrder && (
        <DoneScreenV2 order={liveOrder} kgActual={kgActual} seasonedBatchNo={seasonedBatchNo}
          isFullyDone={sessionFullyDone}
          onNext={() => { setPhase('list'); refetch(); rIP(); rL() }} onHome={handleHome} />
      )}
      {phase === 'machine' && selOrder && (
        <MachineScreenV2 order={selOrder} locks={currentLocks}
          onConfirm={handleStartMachine} onBack={handleHome} loading={startMut.loading} />
      )}
      {phase === 'meat' && liveOrder && (
        <MeatScreenV2 order={liveOrder} availableLots={availableMeatLots}
          onConfirm={handleMeatConfirm} onBack={() => setPhase('machine')} />
      )}
      {phase === 'steps' && liveOrder && (
        <StepScreenV2 order={liveOrder} kgActual={kgActual} stepIdx={stepIdx}
          onConfirm={handleConfirmStep} onBack={() => setPhase('meat')} loading={confirmMut.loading} />
      )}
      {phase === 'review' && liveOrder && (
        <ReviewScreenV2 order={liveOrder} kgActual={kgActual} lotAllocs={lotAllocs}
          onStart={handleStartMixing} loading={finishMut.loading || lockMut.loading} />
      )}
      {phase === 'list' && (
        <ListScreenV2
          orders={plannedAll ?? []} inProgress={inProgress ?? []} locks={currentLocks}
          sessionOpen={mixingSession?.status === 'open'}
          loading={loading}
          onSelect={o => { setSelOrder(o); setLiveOrder(o); setPhase('machine') }}
          onCloseDay={handleCloseDay}
          closeDayLoading={closeSessionMut.loading}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full text-[15px] font-bold shadow-lg z-50"
          style={{ background: 'var(--red)', color: '#fff' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Główna strona ────────────────────────────────────────────────────────────
export function MixingHmiV2Page() {
  return (
    <div className="h-screen flex flex-col overflow-hidden select-none" style={{ ...VARS, background: 'var(--app)' }}>
      {/* Nagłówek */}
      <header className="h-16 flex items-center gap-4 px-5 border-b-[3px] flex-shrink-0"
        style={{ borderColor: 'var(--bd)', background: 'var(--panel)' }}>
        <span className="text-[18px] font-black uppercase tracking-[.22em]" style={{ color: 'var(--ink)' }}>
          Masowanie
        </span>
        <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>
          {new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: '2-digit' })}
        </span>
        <div className="flex-1" />
        <Clock />
      </header>

      {/* Trzon */}
      <div className="flex-1 min-h-0 flex">
        <PlanRail />
        <main className="flex-1 min-w-0 overflow-hidden flex">
          <MixingHmiV2Main />
        </main>
      </div>
    </div>
  )
}
