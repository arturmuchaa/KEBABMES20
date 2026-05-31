/**
 * DeboningHmiV3Page — HMI v3 „Control Room" dla dużego zakładu rozbiorowego.
 *
 * Język wizualny: ciemny panel sterowni / instrument przemysłowy (SCADA-like).
 * Odczyty wagi jak cyfrowa waga (świecący monospace), akcent cyan, przycisk
 * akcji w kolorze maszynowego „START" (emerald), semantyczne stany.
 * Pełen kontrast, wielkie cele dotykowe, stałe pozycje, zero ruchu-szumu.
 *
 * Dane i logika identyczne jak v2 — to wyłącznie odrębna warstwa prezentacji.
 * Klasyk i HMI v2 pozostają nietknięte (wybór przez przełącznik w nagłówku).
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn, calcDeboning } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  AlertTriangle, Save, Package, LogOut, Play, Lock, Flag, Delete, Info, X, Check, Activity,
} from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const KG_PER_CONTAINER = 15
const GRID_BG = {
  backgroundImage:
    'radial-gradient(120% 80% at 50% -10%, rgba(34,211,238,.10), transparent 60%),' +
    'linear-gradient(rgba(148,163,184,.05) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(148,163,184,.05) 1px, transparent 1px)',
  backgroundSize: '100% 100%, 40px 40px, 40px 40px',
}

// ─── Toast ─────────────────────────────────────────────────────────
function HmiToast({ msg, type, visible }: { msg: string; type: 'success'|'error'; visible: boolean }) {
  return (
    <div className={cn(
      'fixed top-4 left-1/2 -translate-x-1/2 z-[120] px-7 py-4 rounded-xl text-base font-bold flex items-center gap-3 transition-all duration-200 max-w-[90vw] border backdrop-blur',
      type === 'success'
        ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
        : 'bg-rose-500/15 border-rose-400/40 text-rose-200',
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none',
    )}>
      {type === 'success' ? <Check size={26} className="flex-shrink-0" /> : <AlertTriangle size={26} className="flex-shrink-0" />}
      <span className="leading-tight">{msg}</span>
    </div>
  )
}

// ─── Block screen ──────────────────────────────────────────────────
function BlockScreen({ icon, title, subtitle, action }: {
  icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-10 text-center" style={GRID_BG}>
      <div className="w-28 h-28 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-7 text-cyan-300">{icon}</div>
      <h2 className="text-4xl font-black text-slate-100 mb-3 tracking-tight">{title}</h2>
      <p className="text-xl text-slate-400 mb-8 leading-relaxed max-w-md">{subtitle}</p>
      {action}
    </div>
  )
}

// ─── Kafel partii ──────────────────────────────────────────────────
const BatchTile = memo(function BatchTile({ batch, selected, entryCount, onSelect }: {
  batch: RawBatch; selected: boolean; entryCount: number; onSelect: (b: RawBatch) => void
}) {
  const kg = Number(batch.kgAvailable)
  const containers = Math.floor(kg / KG_PER_CONTAINER)
  const d = getExpiryStatus(batch.expiryDate).daysLeft
  const expWarn = d <= 0, expSoon = d > 0 && d <= 2
  return (
    <button type="button" onClick={() => onSelect(batch)}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1 rounded-xl border min-h-[112px] p-2 text-center transition-all active:scale-[.97] select-none',
        selected
          ? 'bg-cyan-500/15 border-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,.5),0_8px_28px_rgba(34,211,238,.18)]'
          : 'bg-slate-800/50 border-slate-700 hover:border-slate-500',
      )}>
      {entryCount > 0 && (
        <span className={cn('absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1 rounded-full text-[12px] font-black flex items-center justify-center',
          selected ? 'bg-cyan-400 text-slate-900' : 'bg-emerald-500 text-slate-900')}>{entryCount}</span>
      )}
      <div className={cn('font-mono text-2xl font-bold leading-none', selected ? 'text-cyan-300' : 'text-slate-100')}>
        {batch.internalBatchNo}
      </div>
      <div className={cn('font-mono text-base font-semibold leading-tight tabular-nums', selected ? 'text-cyan-200/80' : 'text-slate-400')}>
        {fmtKg(kg, 0)} kg · {containers} poj.
      </div>
      <span className={cn('text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded mt-0.5 border',
        expWarn ? 'bg-rose-500/15 border-rose-400/40 text-rose-300'
          : expSoon ? 'bg-amber-500/15 border-amber-400/40 text-amber-300'
          : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300')}>
        {d < 0 ? 'PRZETERM.' : d === 0 ? 'DZIŚ!' : `${d} dni`}
      </span>
    </button>
  )
})

// ─── Kafel pracownika ──────────────────────────────────────────────
const WorkerTile = memo(function WorkerTile({ worker, selected, onSelect }: {
  worker: User; selected: boolean; onSelect: (w: User) => void
}) {
  const init = worker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border min-h-[96px] p-2 text-center transition-all active:scale-[.97] select-none',
        selected
          ? 'bg-cyan-500/15 border-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,.5)]'
          : 'bg-slate-800/50 border-slate-700 hover:border-slate-500',
      )}>
      <div className={cn('w-12 h-12 rounded-full flex items-center justify-center text-lg font-black border',
        selected ? 'bg-cyan-400/20 border-cyan-400/50 text-cyan-200' : 'bg-slate-700/50 border-slate-600 text-slate-300')}>
        {init}
      </div>
      <div className={cn('text-sm font-bold leading-tight', selected ? 'text-cyan-100' : 'text-slate-200')}>{worker.name}</div>
    </button>
  )
})

// ─── Numpad ────────────────────────────────────────────────────────
const KEYS = ['7','8','9','4','5','6','1','2','3','0','.','⌫'] as const
const Numpad = memo(function Numpad({ onKey, disabled }: { onKey: (k: string) => void; disabled: boolean }) {
  return (
    <div className={cn('grid grid-cols-3 gap-2.5 transition-opacity', disabled && 'opacity-40 pointer-events-none')}>
      {KEYS.map(k => (
        <button key={k} type="button" onClick={() => onKey(k)}
          className={cn(
            'min-h-[68px] rounded-xl font-mono text-3xl font-bold tabular-nums select-none flex items-center justify-center border transition-all active:scale-95',
            k === '⌫'
              ? 'bg-slate-800/60 border-slate-700 text-amber-300/90 hover:border-amber-400/50 active:bg-amber-500/15'
              : 'bg-gradient-to-b from-slate-700/60 to-slate-800/80 border-slate-600 text-slate-100 hover:border-cyan-400/60 active:bg-cyan-500/20 shadow-[0_2px_0_0_rgba(0,0,0,.4)]',
          )}>
          {k === '⌫' ? <Delete size={30} /> : k}
        </button>
      ))}
    </div>
  )
})

// ─── Pasek wpisów „DZIŚ" ───────────────────────────────────────────
const EntriesStrip = memo(function EntriesStrip({ entries }: { entries: DeboningEntry[] }) {
  if (entries.length === 0) {
    return <div className="flex-1 text-base text-slate-500 font-medium px-2">Brak wpisów z dziś</div>
  }
  return (
    <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-thin py-1">
      {entries.slice().reverse().map(e => (
        <div key={e.id} className="flex-shrink-0 flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5">
          <span className="font-mono text-sm font-bold text-cyan-300">{e.rawBatchNo}</span>
          <span className="text-sm font-semibold text-slate-300">{e.workerName.split(' ')[0]}</span>
          <span className="font-mono text-sm text-slate-400 tabular-nums">{fmtKg(e.kgTaken, 0)}→{fmtKg(e.kgMeat, 0)}</span>
          <span className={cn('font-mono text-sm font-black tabular-nums', e.yieldPct >= 75 ? 'text-emerald-400' : e.yieldPct >= 60 ? 'text-amber-400' : 'text-rose-400')}>
            {fmtPct(e.yieldPct, 0)}
          </span>
        </div>
      ))}
    </div>
  )
})

// ─── Wyświetlacz wagi — instrument SCADA ───────────────────────────
function WeightDisplay({ label, value, unit, active, error, onActivate }: {
  label: string; value: string; unit: string; active: boolean; error?: boolean; onActivate: () => void
}) {
  return (
    <button type="button" onClick={onActivate}
      className={cn(
        'group w-full text-left rounded-xl border p-3 transition-all',
        error ? 'border-rose-400/60 bg-rose-500/10'
          : active ? 'border-cyan-400/70 bg-cyan-500/[.07] shadow-[0_0_0_1px_rgba(34,211,238,.35)]'
          : 'border-slate-700 bg-slate-800/40',
      )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn('text-sm font-black uppercase tracking-[.14em]', error ? 'text-rose-300' : active ? 'text-cyan-300' : 'text-slate-400')}>{label}</span>
        {active && <span className="flex items-center gap-1 text-[11px] font-black text-cyan-300 uppercase tracking-wide"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> wpisuję</span>}
      </div>
      {/* Wyświetlacz wpuszczony, świecące cyfry mono */}
      <div className="flex items-baseline justify-end gap-2 rounded-lg px-4 py-1.5 bg-black/40 border border-black/40 shadow-[inset_0_2px_8px_rgba(0,0,0,.5)]">
        <span className={cn('font-mono text-[58px] leading-none font-bold tabular-nums tracking-tight',
          error ? 'text-rose-400 [text-shadow:0_0_18px_rgba(251,113,133,.5)]'
            : value ? 'text-cyan-300 [text-shadow:0_0_18px_rgba(34,211,238,.45)]'
            : 'text-slate-600')}>
          {value || '0'}
        </span>
        <span className="text-xl font-bold text-slate-500 uppercase">{unit}</span>
      </div>
    </button>
  )
}

export function DeboningHmiV3Page() {
  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())

  const { session, timeWindow, loading: sessionLoading, startDay, closeDay, startLoading, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<'taken' | 'meat'>('taken')

  const [finishModal, setFinishModal] = useState(false)
  const [inputBacks,  setInputBacks]  = useState('')
  const [inputBones,  setInputBones]  = useState('')
  const [shiftModal,  setShiftModal]  = useState(false)
  const [toast, setToast] = useState({ msg: '', type: 'success' as 'success'|'error', visible: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000)
  }, [])

  useEffect(() => {
    if (!selBatch) return
    const updated = (batchData.data?.data ?? []).find(b => b.id === selBatch.id)
    if (updated && updated.kgAvailable !== selBatch.kgAvailable) setSelBatch(updated)
  }, [batchData.data]) // eslint-disable-line

  const batches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => {
        if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
        return (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)
      }),
    [batchData.data])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  const entryCountByBatchId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.rawBatchId, (m.get(e.rawBatchId) ?? 0) + 1)
    return m
  }, [entries])

  const taken = parseFloat(kgTaken) || 0
  const meat  = parseFloat(kgMeat)  || 0
  const kgAvailableNow = Number(selBatch?.kgAvailable ?? 0)
  const isOver  = taken > 0 && !!selBatch && taken > kgAvailableNow + 0.01
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && meat <= taken && !isOver
  const yieldPct = taken > 0 && meat > 0 && meat <= taken ? (meat / taken) * 100 : 0

  const batchEntries = selBatch ? entries.filter(e => e.rawBatchId === selBatch.id) : []
  const batchTotalTaken = batchEntries.reduce((s, e) => s + e.kgTaken, 0)

  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)
  const finalizeTotalMeat  = pendingFinalize.reduce((s, e) => s + e.kgMeat, 0)
  const batchSuggestion = finalizeTotalTaken > 0 && finalizeTotalMeat > 0
    ? calcDeboning(finalizeTotalTaken, finalizeTotalMeat) : null

  const pressKey = useCallback((k: string) => {
    const apply = (prev: string): string => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev === '' ? '0.' : prev + '.')
      const next = prev + k
      if (next.replace('.', '').length > 6) return prev
      const dot = next.indexOf('.')
      if (dot >= 0 && next.length - dot - 1 > 2) return prev
      return next
    }
    if (active === 'taken') setKgTaken(apply)
    else setKgMeat(apply)
  }, [active])

  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [])
  const pickWorker = useCallback((w: User) => {
    setSelWorker(w); setActive('taken')
  }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'error')
    else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate,
    )
    if (err) { showToast(err, 'error'); return }
    batchData.refetch()
    const totalTaken = batchTotalTaken + taken
    const isFullyUsed = kgAvailableNow > 0 && totalTaken >= kgAvailableNow - 0.1
    setKgTaken(''); setKgMeat(''); setActive('taken')
    if (isFullyUsed) showToast(`✓ Ćwiartka ${selBatch.internalBatchNo} rozebrana — kliknij "Zakończ partię"`)
    else showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

  function handleFinishBatch() {
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', 'error'); return }
    setInputBacks(batchSuggestion ? batchSuggestion.kgBacks.toFixed(2) : '')
    setInputBones(batchSuggestion ? batchSuggestion.kgBones.toFixed(2) : '')
    setFinishModal(true)
  }

  async function handleFinishConfirm() {
    if (!session) return
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', 'error'); return }
    const toFinalize = pendingFinalize
    if (toFinalize.length === 0) { setFinishModal(false); return }
    const sumTaken = toFinalize.reduce((s, e) => s + e.kgTaken, 0) || 1
    let runningBacks = 0, runningBones = 0
    for (let i = 0; i < toFinalize.length; i++) {
      const e = toFinalize[i]
      const isLast = i === toFinalize.length - 1
      const share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - runningBacks) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - runningBones) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      runningBacks += kb; runningBones += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }
    setFinishModal(false)
    showToast(`Zakończono ${toFinalize.length} ${toFinalize.length === 1 ? 'wpis' : 'wpisów'} (${fmtKg(kbTotal, 2)} kg grzb., ${fmtKg(knTotal, 2)} kg kości)`)
    setSelBatch(null); setKgTaken(''); setKgMeat(''); setActive('taken')
  }

  // ─── Block screens ───────────────────────────────────────────────
  if (sessionLoading) return (
    <div className="flex items-center justify-center h-full bg-[#0a0f1c]"><Spinner size={40} /></div>
  )

  if (!session) return (
    <BlockScreen icon={<Play size={56} />} title="Rozpocznij dzień"
      subtitle={`Data produkcyjna: ${timeWindow.productionDate}`}
      action={
        <button type="button" onClick={handleStartDay} disabled={startLoading}
          className="h-20 px-12 bg-emerald-500 text-slate-900 rounded-2xl text-2xl font-black flex items-center justify-center gap-4 active:scale-95 shadow-[0_8px_30px_rgba(16,185,129,.35)]">
          {startLoading ? <span className="w-8 h-8 border-[3px] border-slate-900/30 border-t-slate-900 rounded-full animate-spin" /> : <Play size={30} />}
          Rozpocznij dzień
        </button>
      } />
  )

  if (session.status === 'closed' || session.status === 'approved') return (
    <BlockScreen icon={<Lock size={56} />}
      title={session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}
      subtitle={session.status === 'approved'
        ? `Dane z dnia ${session.sessionDate} zablokowane.`
        : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'} />
  )

  const fefoAlerts = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 2)

  return (
    <div className="h-full flex flex-col overflow-hidden text-slate-100 bg-[#0a0f1c]" style={GRID_BG}>

      {/* Pasek statusu */}
      <div className="flex items-center gap-4 px-5 py-2 bg-slate-900/70 border-b border-slate-700/70 flex-shrink-0 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 animate-ping" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
          </span>
          <span className="text-base font-black text-emerald-300 uppercase tracking-[.14em]">Sesja otwarta</span>
          <span className="font-mono text-base text-slate-400 font-semibold tabular-nums">{session.sessionDate}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-slate-500">
          <Activity size={16} className="text-cyan-400" />
          <span className="text-sm font-bold uppercase tracking-wider">Control Room</span>
        </div>
        {fefoAlerts.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-400/40 text-rose-300 text-sm font-bold">
            <AlertTriangle size={16} />
            {fefoAlerts.length === 1
              ? <>Partia {fefoAlerts[0].internalBatchNo} — {getExpiryStatus(fefoAlerts[0].expiryDate).daysLeft <= 0 ? 'PRZETERMINOWANA!' : 'wygasa wkrótce!'}</>
              : <>{fefoAlerts.length} partii blisko terminu!</>}
          </div>
        )}
      </div>

      {/* Główna pętla */}
      <div className="flex-1 grid grid-cols-[minmax(360px,42%)_1fr] gap-3 p-3 overflow-hidden">

        {/* LEWA */}
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="flex flex-col bg-slate-900/50 rounded-2xl border border-slate-700/70 p-3 flex-1 overflow-hidden backdrop-blur">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <span className="w-1.5 h-5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,.6)]" />
              <span className="text-sm font-black uppercase tracking-[.16em] text-slate-300">1 · Partia</span>
              {selBatch && <span className="flex items-center gap-1 text-sm font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-mono">{selBatch.internalBatchNo}</span>}
            </div>
            {batchData.loading
              ? <div className="flex justify-center py-8"><Spinner size={32} /></div>
              : batches.length === 0
                ? <div className="flex flex-col items-center justify-center flex-1 text-slate-600"><Package size={36} className="mb-2" /><span className="text-base">Brak partii</span></div>
                : <div className="grid grid-cols-3 gap-2 overflow-y-auto scrollbar-thin pr-1 content-start">
                    {batches.map(b => (
                      <BatchTile key={b.id} batch={b}
                        selected={selBatch?.id === b.id}
                        entryCount={entryCountByBatchId.get(b.id) ?? 0}
                        onSelect={pickBatch} />
                    ))}
                  </div>
            }
          </div>
          <div className="flex flex-col bg-slate-900/50 rounded-2xl border border-slate-700/70 p-3 flex-shrink-0 max-h-[42%] overflow-hidden backdrop-blur">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <span className="w-1.5 h-5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,.6)]" />
              <span className="text-sm font-black uppercase tracking-[.16em] text-slate-300">2 · Pracownik</span>
              {selWorker && <span className="flex items-center gap-1 text-sm font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/40 text-cyan-300">{selWorker.name}</span>}
            </div>
            {workerData.loading
              ? <div className="flex justify-center py-6"><Spinner size={28} /></div>
              : <div className="grid grid-cols-4 gap-2 overflow-y-auto scrollbar-thin pr-1 content-start">
                  {workers.map(w => (
                    <WorkerTile key={w.id} worker={w} selected={selWorker?.id === w.id} onSelect={pickWorker} />
                  ))}
                </div>
            }
          </div>
        </div>

        {/* PRAWA */}
        <div className={cn('flex flex-col gap-3 bg-slate-900/50 rounded-2xl border border-slate-700/70 p-3 overflow-hidden transition-opacity backdrop-blur',
          (!selBatch || !selWorker) && 'opacity-60')}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="w-1.5 h-5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,.6)]" />
            <span className="text-sm font-black uppercase tracking-[.16em] text-slate-300">3 · Waga</span>
            {selBatch && (
              <span className="font-mono text-sm font-semibold text-slate-400">
                Dostępne: <strong className="text-slate-100">{fmtKg(kgAvailableNow, 0)} kg</strong>
                {batchEntries.length > 0 && <> · wpis {batchEntries.length}.</>}
              </span>
            )}
          </div>

          <div className="flex-1 grid grid-cols-2 gap-3 overflow-hidden">
            <div className="flex flex-col gap-2.5 overflow-hidden">
              <WeightDisplay label="Ćwiartka" value={kgTaken} unit="kg" active={active === 'taken'} error={isOver} onActivate={() => setActive('taken')} />
              <WeightDisplay label="Mięso Z/S" value={kgMeat} unit="kg" active={active === 'meat'} onActivate={() => setActive('meat')} />

              {isOver ? (
                <div className="flex items-center gap-3 bg-rose-500/15 border border-rose-400/50 text-rose-200 rounded-xl px-4 py-3">
                  <span className="text-3xl">⛔</span>
                  <div>
                    <div className="text-lg font-black">ZA DUŻO!</div>
                    <div className="text-sm font-semibold">Dostępne {fmtKg(kgAvailableNow)} kg w partii {selBatch?.internalBatchNo}</div>
                  </div>
                </div>
              ) : yieldPct > 0 ? (
                <div className="rounded-xl px-4 py-3 flex items-center gap-4 bg-slate-800/50 border border-slate-700">
                  <div className={cn('font-mono text-5xl font-black leading-none tabular-nums',
                    yieldPct >= 75 ? 'text-emerald-400 [text-shadow:0_0_16px_rgba(52,211,153,.4)]' : yieldPct >= 60 ? 'text-amber-400' : 'text-rose-400')}>
                    {fmtPct(yieldPct, 0)}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-black uppercase tracking-[.14em] text-slate-400 mb-1.5">Wydajność</div>
                    <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', yieldPct >= 75 ? 'bg-emerald-400' : yieldPct >= 60 ? 'bg-amber-400' : 'bg-rose-400')}
                        style={{ width: `${Math.min(100, yieldPct)}%` }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-600 text-center text-base px-4">
                  {!selBatch ? 'Wybierz partię' : !selWorker ? 'Wybierz pracownika' : 'Wpisz wagę ćwiartki i mięsa'}
                </div>
              )}
            </div>

            <div className="flex flex-col">
              <Numpad onKey={pressKey} disabled={!selBatch || !selWorker} />
            </div>
          </div>

          <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
            className="h-[72px] flex-shrink-0 flex items-center justify-center gap-3 bg-emerald-500 text-slate-900 rounded-xl text-2xl font-black shadow-[0_6px_24px_rgba(16,185,129,.4)] active:scale-[.98] transition-all disabled:opacity-30 disabled:shadow-none disabled:bg-slate-700 disabled:text-slate-500">
            {addLoading ? <span className="w-7 h-7 border-[3px] border-slate-900/30 border-t-slate-900 rounded-full animate-spin" /> : <Save size={28} />}
            ZAPISZ WPIS
          </button>
        </div>
      </div>

      {/* Pasek dolny */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900/70 border-t border-slate-700/70 flex-shrink-0 backdrop-blur">
        <span className="text-xs font-black uppercase tracking-[.16em] text-slate-500 flex-shrink-0">Dziś</span>
        <EntriesStrip entries={entries} />
        <button type="button" onClick={handleFinishBatch} disabled={pendingFinalize.length === 0}
          className="flex-shrink-0 flex items-center gap-2 h-12 px-4 bg-amber-500/90 text-slate-900 rounded-xl text-base font-bold active:scale-95 transition-transform disabled:opacity-30 disabled:bg-slate-700 disabled:text-slate-500">
          <Flag size={18} /> Zakończ partię
        </button>
        <button type="button" onClick={() => setShiftModal(true)}
          className="flex-shrink-0 flex items-center gap-2 h-12 px-4 bg-slate-800 border border-slate-600 text-slate-300 rounded-xl text-base font-bold hover:border-rose-400/60 hover:text-rose-300 active:scale-95 transition-all">
          <LogOut size={18} /> Zakończ zmianę
        </button>
      </div>

      {/* Modal: zakończenie partii */}
      {finishModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl p-7 text-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-amber-500/15 border border-amber-400/40 rounded-xl flex items-center justify-center"><Flag size={28} className="text-amber-400" /></div>
              <div>
                <h3 className="text-2xl font-black">Zakończenie partii</h3>
                <p className="text-base text-slate-400">{pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki</p>
              </div>
            </div>
            {batchSuggestion && (
              <div className="flex items-start gap-2 bg-cyan-500/10 border border-cyan-400/30 px-4 py-3 rounded-xl mb-4 text-sm text-cyan-200">
                <Info size={18} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-black mb-0.5">Sugestia (z sumy wpisów)</div>
                  Grzbiety ~{batchSuggestion.kgBacks.toFixed(2)} kg · Kości ~{batchSuggestion.kgBones.toFixed(2)} kg
                  <div className="text-xs text-cyan-300/60 mt-0.5">Wpisz faktycznie zważone wartości</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-5">
              {[
                { label: 'Grzbiety (kg)', val: inputBacks, set: setInputBacks },
                { label: 'Kości (kg)', val: inputBones, set: setInputBones },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-sm font-black uppercase tracking-wide text-slate-400 block mb-1.5">{f.label}</label>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={f.val}
                    onChange={e => f.set(e.target.value)}
                    className="w-full h-20 px-4 font-mono text-4xl font-bold text-cyan-300 bg-black/40 rounded-xl border border-slate-600 focus:outline-none focus:border-cyan-400 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)}
                className="flex-1 h-16 rounded-xl bg-slate-800 font-bold text-lg text-slate-300 border border-slate-600">Anuluj</button>
              <button type="button" onClick={handleFinishConfirm}
                className="flex-[2] h-16 rounded-xl bg-amber-500 text-slate-900 font-black text-lg flex items-center justify-center gap-2"><Flag size={22} /> Potwierdź i zakończ</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: zakończ zmianę */}
      {shiftModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={() => setShiftModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-7 text-slate-100" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 bg-rose-500/15 border border-rose-400/40 rounded-xl flex items-center justify-center"><LogOut size={28} className="text-rose-400" /></div>
              <h3 className="text-2xl font-black">Zakończyć zmianę?</h3>
            </div>
            <p className="text-lg text-slate-400 mb-6">Sesja zostanie zamknięta. Biuro zatwierdzi dane.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)}
                className="flex-1 h-16 rounded-xl bg-slate-800 text-slate-300 font-bold text-lg border border-slate-600 flex items-center justify-center gap-2"><X size={22} /> Anuluj</button>
              <button type="button" disabled={closeLoading}
                onClick={async () => { setShiftModal(false); const err = await closeDay(); if (err) showToast(err, 'error'); else showToast('Zmiana zakończona') }}
                className="flex-1 h-16 rounded-xl bg-rose-500 text-white font-black text-lg disabled:opacity-50 flex items-center justify-center gap-2"><LogOut size={22} /> Zakończ</button>
            </div>
          </div>
        </div>
      )}

      <HmiToast msg={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
