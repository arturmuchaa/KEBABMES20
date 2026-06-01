import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Sun, Moon, Play, Lock, AlertTriangle, Save, Flag, LogOut, Delete, X, BarChart3 } from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const THEME_KEY = 'rozbior_hmi_v5_theme'
const KG_PER_CONTAINER = 15

type Theme = 'light' | 'dark'
type ActiveField = 'taken' | 'meat'

const VARS: Record<Theme, CSSProperties> = {
  dark: {
    ['--app' as string]:    '#0a0f1a',
    ['--panel' as string]:  '#111827',
    ['--panel2' as string]: '#1e2d40',
    ['--bd' as string]:     '#1e293b',
    ['--ink' as string]:    '#f1f5f9',
    ['--mut' as string]:    '#64748b',
    ['--accent' as string]: '#3b82f6',
    ['--grn' as string]:    '#22c55e',
    ['--amb' as string]:    '#f59e0b',
    ['--red' as string]:    '#ef4444',
  },
  light: {
    ['--app' as string]:    '#f0f4f8',
    ['--panel' as string]:  '#ffffff',
    ['--panel2' as string]: '#f8fafc',
    ['--bd' as string]:     '#e2e8f0',
    ['--ink' as string]:    '#0f172a',
    ['--mut' as string]:    '#64748b',
    ['--accent' as string]: '#2563eb',
    ['--grn' as string]:    '#16a34a',
    ['--amb' as string]:    '#d97706',
    ['--red' as string]:    '#dc2626',
  },
}

// ─── Zegar (izolowany — nie re-renderuje gridu) ────────────────────
const TopClock = memo(function TopClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

// ─── Kafel partii ──────────────────────────────────────────────────
const BatchTile = memo(function BatchTile({ batch, selected, onSelect }: {
  batch: RawBatch; selected: boolean; onSelect: (b: RawBatch) => void
}) {
  const { daysLeft } = getExpiryStatus(batch.expiryDate)
  const kg = Number(batch.kgAvailable)
  const containers = Math.floor(kg / KG_PER_CONTAINER)
  const daysColor = daysLeft <= 0 ? 'var(--red)' : daysLeft <= 3 ? 'var(--amb)' : 'var(--mut)'
  const supplierLabel = batch.supplierDisplayName ?? batch.supplierName ?? '—'

  return (
    <button
      type="button"
      onClick={() => onSelect(batch)}
      className={cn(
        'flex flex-col justify-between p-3 rounded-xl border-2 h-full text-left select-none active:translate-y-px transition-colors',
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--bd)] bg-[var(--panel)] hover:border-[var(--accent)]'
      )}
      style={selected ? { color: '#fff' } : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono text-lg font-black leading-none" style={selected ? undefined : { color: 'var(--ink)' }}>
          {batch.internalBatchNo}
        </span>
        <span className="text-xs font-bold tabular-nums" style={{ color: selected ? 'rgba(255,255,255,0.8)' : daysColor }}>
          {daysLeft < 0 ? 'PRZETERM.' : daysLeft === 0 ? 'DZIŚ!' : `${daysLeft}d`}
        </span>
      </div>
      <span className="text-[11px] font-semibold truncate" style={{ color: selected ? 'rgba(255,255,255,0.85)' : 'var(--mut)' }}>
        {supplierLabel}
      </span>
      <span className="text-[11px] tabular-nums" style={{ color: selected ? 'rgba(255,255,255,0.75)' : 'var(--mut)' }}>
        {fmtKg(kg, 0)} kg · {containers} poj.
      </span>
    </button>
  )
})

// ─── Kafel pracownika ──────────────────────────────────────────────
const WorkerTile = memo(function WorkerTile({ worker, selected, entryCount, onSelect }: {
  worker: User; selected: boolean; entryCount: number; onSelect: (w: User) => void
}) {
  const initials = worker.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button
      type="button"
      onClick={() => onSelect(worker)}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 select-none active:scale-[0.98] transition-all',
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--bd)] bg-[var(--panel)] hover:border-[var(--accent)]'
      )}
    >
      <span className="text-4xl font-black leading-none" style={{ color: selected ? '#fff' : 'var(--ink)' }}>
        {initials}
      </span>
      <span className="text-sm font-semibold leading-tight text-center px-2 truncate w-full"
        style={{ color: selected ? 'rgba(255,255,255,0.9)' : 'var(--ink)' }}>
        {worker.name}
      </span>
      {entryCount > 0 && (
        <span className="absolute bottom-2 right-2 min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-black flex items-center justify-center"
          style={{ background: selected ? '#fff' : 'var(--grn)', color: selected ? 'var(--accent)' : '#fff' }}>
          {entryCount}
        </span>
      )}
    </button>
  )
})

// ─── Pole wagi ─────────────────────────────────────────────────────
function Readout({ label, value, active, extra, onActivate }: {
  label: string; value: string; active: boolean; extra?: React.ReactNode; onActivate: () => void
}) {
  return (
    <button type="button" onClick={onActivate}
      className="w-full rounded-xl border-2 p-3 text-left flex-shrink-0 transition-colors"
      style={{ background: 'var(--panel)', borderColor: active ? 'var(--accent)' : 'var(--bd)' }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-black uppercase tracking-[.18em]"
          style={{ color: active ? 'var(--accent)' : 'var(--mut)' }}>
          {label}
        </span>
        {extra}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-black tabular-nums leading-none" style={{ fontSize: 56, color: value ? 'var(--ink)' : 'var(--mut)' }}>
          {value || '0'}
        </span>
        <span className="text-xl font-bold" style={{ color: 'var(--mut)' }}>kg</span>
        {active && <span className="ml-auto w-2 h-8 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />}
      </div>
    </button>
  )
}

// ─── Numpad ────────────────────────────────────────────────────────
const V5Numpad = memo(function V5Numpad({ onKey, onBackspaceStart, onBackspaceEnd, disabled }: {
  onKey: (k: string) => void
  onBackspaceStart: () => void
  onBackspaceEnd: () => void
  disabled: boolean
}) {
  const rows = [['7','8','9'],['4','5','6'],['1','2','3']]
  return (
    <div className={cn('flex flex-col gap-2 flex-1 min-h-0', disabled && 'opacity-40 pointer-events-none')}>
      {rows.map(row => (
        <div key={row[0]} className="flex gap-2 flex-1">
          {row.map(k => (
            <button key={k} type="button" onClick={() => onKey(k)}
              className="flex-1 rounded-xl border-2 font-mono text-4xl font-black flex items-center justify-center select-none active:scale-[0.96] transition-transform"
              style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
              {k}
            </button>
          ))}
        </div>
      ))}
      <div className="flex gap-2 flex-1">
        <button type="button" onClick={() => onKey('0')}
          className="flex-[2] rounded-xl border-2 font-mono text-4xl font-black flex items-center justify-center select-none active:scale-[0.96] transition-transform"
          style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
          0
        </button>
        <button type="button" onClick={() => onKey('.')}
          className="flex-1 rounded-xl border-2 font-mono text-4xl font-black flex items-center justify-center select-none active:scale-[0.96]"
          style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--mut)' }}>
          .
        </button>
        <button type="button"
          onClick={() => onKey('⌫')}
          onPointerDown={onBackspaceStart}
          onPointerUp={onBackspaceEnd}
          onPointerLeave={onBackspaceEnd}
          className="flex-1 rounded-xl border-2 flex items-center justify-center select-none active:scale-[0.96]"
          style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--amb)' }}>
          <Delete size={32} />
        </button>
      </div>
    </div>
  )
})

// ─── Pasek KPI ─────────────────────────────────────────────────────
const V5KpiBar = memo(function V5KpiBar({ entries, onShowEntries, onShowStats }: {
  entries: DeboningEntry[]; onShowEntries: () => void; onShowStats: () => void
}) {
  const totTaken = entries.reduce((s, e) => s + e.kgTaken, 0)
  const totMeat  = entries.reduce((s, e) => s + e.kgMeat, 0)
  const totBacks = entries.reduce((s, e) => s + (e.kgBacks ?? 0), 0)
  const totBones = entries.reduce((s, e) => s + (e.kgBones ?? 0), 0)
  const yieldPct = totTaken > 0 ? (totMeat / totTaken) * 100 : 0
  const yColor = yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : totMeat > 0 ? 'var(--red)' : 'var(--mut)'

  return (
    <div className="flex-shrink-0 h-[60px] grid grid-cols-8 border-t-2" style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
      {[
        { label: 'Ćwiartka dziś', val: `${fmtKg(totTaken, 0)} kg`, color: 'var(--ink)' },
        { label: 'Mięso',         val: `${fmtKg(totMeat, 0)} kg`,  color: 'var(--grn)' },
        { label: 'Wydajność',     val: totMeat > 0 ? fmtPct(yieldPct, 1) : '—', color: yColor },
        { label: 'Grzbiety',      val: `${fmtKg(totBacks, 0)} kg`, color: 'var(--amb)' },
        { label: 'Kości',         val: `${fmtKg(totBones, 0)} kg`, color: 'var(--amb)' },
        { label: 'Wpisy',         val: String(entries.length),      color: 'var(--ink)' },
      ].map(c => (
        <div key={c.label} className="flex flex-col items-center justify-center border-r-2" style={{ borderColor: 'var(--bd)' }}>
          <span className="font-mono text-xl font-black tabular-nums leading-none" style={{ color: c.color }}>{c.val}</span>
          <span className="text-[10px] font-bold uppercase tracking-[.14em] mt-0.5" style={{ color: 'var(--mut)' }}>{c.label}</span>
        </div>
      ))}
      {/* Przycisk: Wpisy dzisiaj */}
      <button type="button" onClick={onShowEntries}
        className="flex flex-col items-center justify-center gap-0.5 border-r-2 active:scale-95 transition-transform"
        style={{ color: 'var(--accent)', borderColor: 'var(--bd)' }}>
        <span className="text-xl font-black leading-none">📋</span>
        <span className="text-[10px] font-black uppercase tracking-[.14em]">Wpisy</span>
      </button>
      {/* Przycisk: Statystyki */}
      <button type="button" onClick={onShowStats}
        className="flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform"
        style={{ color: 'var(--grn)' }}>
        <BarChart3 size={20} />
        <span className="text-[10px] font-black uppercase tracking-[.14em]">Statystyki</span>
      </button>
    </div>
  )
})

export function DeboningHmiV5Page() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const n = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(THEME_KEY, n) } catch { /**/ }
      return n
    })
  }, [])

  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())
  const { session, timeWindow, loading: sessionLoading, startDay, startLoading, closeDay, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<ActiveField>('taken')
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal, setFinishModal] = useState(false)
  const [shiftModal,  setShiftModal]  = useState(false)
  const [statsModal,   setStatsModal]   = useState(false)
  const [entriesModal, setEntriesModal] = useState(false)
  const [statsSort,    setStatsSort]    = useState<'taken' | 'meat' | 'yield'>('taken')
  const [inputBacks,  setInputBacks]  = useState('')
  const [inputBones,  setInputBones]  = useState('')
  const [toastMsg,    setToastMsg]    = useState('')
  const [toastType,   setToastType]   = useState<'ok' | 'err'>('ok')
  const [toastVis,    setToastVis]    = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg(msg); setToastType(type); setToastVis(true)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastVis(false), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastRef.current) clearTimeout(toastRef.current)
      if (longPressRef.current) clearTimeout(longPressRef.current)
      if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    }
  }, [])

  // Partii — memoizacja stabilna, FEFO sort, max 6
  const batches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0))
      .slice(0, 6),
    [batchData.data])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  const entryCountByWorkerId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.workerId, (m.get(e.workerId) ?? 0) + 1)
    return m
  }, [entries])

  const workerStats = useMemo(() => {
    const m = new Map<string, { name: string; taken: number; meat: number }>()
    for (const e of entries) {
      const cur = m.get(e.workerId) ?? { name: e.workerName, taken: 0, meat: 0 }
      cur.taken += e.kgTaken; cur.meat += e.kgMeat
      m.set(e.workerId, cur)
    }
    const rows = Array.from(m.values())
      .map(s => ({ ...s, yieldPct: s.taken > 0 ? (s.meat / s.taken) * 100 : 0 }))
    const key = statsSort === 'taken' ? 'taken' : statsSort === 'meat' ? 'meat' : 'yieldPct'
    return rows.sort((a, b) => a[key] - b[key])
  }, [entries, statsSort])

  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)

  async function handleFinishBatchConfirm() {
    if (!session) return
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', 'err'); return }
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', 'err'); return }
    const sumTaken = finalizeTotalTaken || 1
    let rb = 0, rn = 0
    for (let i = 0; i < pendingFinalize.length; i++) {
      const e = pendingFinalize[i]
      const isLast = i === pendingFinalize.length - 1
      const share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - rb) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - rn) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      rb += kb; rn += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }
    setFinishModal(false)
    setInputBacks(''); setInputBones('')
    showToast(`Zakończono ${pendingFinalize.length} wpisów`)
  }

  const taken = parseFloat(kgTaken) || 0
  const meat  = parseFloat(kgMeat)  || 0
  const yieldPct = taken > 0 && meat > 0 && meat <= taken ? (meat / taken) * 100 : 0
  const canSave  = !!selBatch && !!selWorker && taken > 0 && meat > 0 && meat <= taken

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

  const clearActiveField = useCallback(() => {
    if (active === 'taken') setKgTaken('')
    else setKgMeat('')
  }, [active])

  const handleStartBackspaceHold = useCallback(() => {
    longPressRef.current = setTimeout(clearActiveField, 600)
  }, [clearActiveField])

  const handleEndBackspaceHold = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }, [])

  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [])

  const pickWorker = useCallback((w: User) => {
    setSelWorker(w); setActive('taken')
  }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'err'); else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (addLoading) return
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 300)
    setKgTaken(''); setKgMeat(''); setActive('taken')
    showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

  async function handleCloseShift() {
    const err = await closeDay()
    if (err) showToast(err, 'err')
    else { setShiftModal(false); showToast('Zmiana zakończona') }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--app)] text-[var(--ink)]" style={VARS[theme]}>
      {children}
    </div>
  )

  if (sessionLoading) return wrap(
    <div className="flex items-center justify-center flex-1"><Spinner size={48} /></div>
  )

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-8">
      <div className="w-28 h-28 rounded-2xl border-2 flex items-center justify-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--grn)', color: 'var(--grn)' }}>
        <Play size={56} />
      </div>
      <div className="text-center">
        <h2 className="text-4xl font-black mb-2">Rozpocznij dzień</h2>
        <p className="text-xl" style={{ color: 'var(--mut)' }}>Data produkcyjna: {timeWindow.productionDate}</p>
      </div>
      <button type="button" onClick={handleStartDay} disabled={startLoading}
        className="h-20 px-16 rounded-xl text-2xl font-black flex items-center gap-4"
        style={{ background: 'var(--grn)', color: '#fff' }}>
        {startLoading
          ? <span className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          : <Play size={32} />}
        Rozpocznij dzień
      </button>
      <button type="button" onClick={toggleTheme} aria-label="Motyw"
        className="absolute top-4 right-4 w-12 h-12 rounded-xl border-2 flex items-center justify-center"
        style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
        {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="w-28 h-28 rounded-2xl border-2 flex items-center justify-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--amb)', color: 'var(--amb)' }}>
        <Lock size={56} />
      </div>
      <h2 className="text-4xl font-black">
        {session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}
      </h2>
      <p className="text-xl max-w-lg text-center" style={{ color: 'var(--mut)' }}>
        {session.status === 'approved'
          ? `Dane z dnia ${session.sessionDate} są zablokowane.`
          : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'}
      </p>
    </div>
  )

  const fefoAlerts = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 3)

  return wrap(
    <>
      {/* ─── TOAST ─── */}
      <div className={cn(
        'fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-xl border-2 text-base font-bold flex items-center gap-3 transition-opacity duration-150',
        toastVis ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )} style={{ background: 'var(--panel)', borderColor: toastType === 'ok' ? 'var(--grn)' : 'var(--red)', color: toastType === 'ok' ? 'var(--grn)' : 'var(--red)' }}>
        {toastType === 'ok' ? '✓' : '⚠'} {toastMsg}
      </div>

      {/* ─── NAGŁÓWEK (60px) ─── */}
      <header className="flex-shrink-0 h-[60px] flex items-center gap-4 px-5 border-b-2"
        style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
        <div className="font-black text-xl tracking-tight" style={{ color: 'var(--ink)' }}>ROZBIÓR</div>
        <div className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--mut)' }}>
          {session.sessionDate}
        </div>
        <div className="flex-1" />
        {fefoAlerts.length > 0 && (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold border-2"
            style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
            <AlertTriangle size={16} />
            {fefoAlerts.length === 1 ? `Partia ${fefoAlerts[0].internalBatchNo} — termin!` : `${fefoAlerts.length} partii — termin!`}
          </span>
        )}
        <TopClock />
        <button type="button" onClick={toggleTheme} aria-label="Motyw"
          className="w-10 h-10 rounded-lg border-2 flex items-center justify-center"
          style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button type="button" onClick={() => setShiftModal(true)}
          className="h-9 px-4 rounded-lg border-2 text-sm font-bold flex items-center gap-2"
          style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
          <LogOut size={16} /> Zakończ zmianę
        </button>
        <button type="button" onClick={() => setFinishModal(true)}
          className="h-9 px-4 rounded-lg border-2 text-sm font-bold flex items-center gap-2"
          style={{ borderColor: 'var(--amb)', color: 'var(--amb)' }}>
          <Flag size={16} /> Zakończ partię
        </button>
      </header>

      {/* ─── PASEK PARTII (88px) ─── */}
      <div className="flex-shrink-0 h-[88px] px-3 py-2 grid gap-2 border-b-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(batches.length, 1)}, 1fr)`, background: 'var(--app)', borderColor: 'var(--bd)' }}>
        {batchData.loading
          ? <div className="col-span-6 flex items-center justify-center"><Spinner size={24} /></div>
          : batches.length === 0
            ? <div className="col-span-6 flex items-center justify-center text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak aktywnych partii</div>
            : batches.map(b => (
                <BatchTile key={b.id} batch={b} selected={selBatch?.id === b.id} onSelect={pickBatch} />
              ))
        }
      </div>

      {/* ─── OBSZAR GŁÓWNY ─── */}
      <div className="flex-1 flex min-h-0">

        {/* LEWY: grid pracowników 54% */}
        <div className="flex-shrink-0 w-[54%] p-3 border-r-2" style={{ borderColor: 'var(--bd)', background: 'var(--app)' }}>
          {workerData.loading
            ? <div className="flex items-center justify-center h-full"><Spinner size={32} /></div>
            : (
              <div className="grid grid-cols-4 grid-rows-4 gap-2 h-full">
                {Array.from({ length: 16 }, (_, i) => {
                  const w = workers[i]
                  if (!w) return <div key={`empty-${i}`} />
                  return (
                    <WorkerTile
                      key={w.id}
                      worker={w}
                      selected={selWorker?.id === w.id}
                      entryCount={entryCountByWorkerId.get(w.id) ?? 0}
                      onSelect={pickWorker}
                    />
                  )
                })}
              </div>
            )
          }
        </div>

        {/* PRAWY: panel wag 46% */}
        <div className="flex-1 flex flex-col gap-3 p-4 min-h-0" style={{ background: 'var(--app)' }}>
          {/* Pole ĆWIARTKA */}
          <Readout
            label="Ćwiartka pobrana"
            value={kgTaken}
            active={active === 'taken'}
            onActivate={() => setActive('taken')}
          />

          {/* Pole MIĘSO Z/S + wydajność */}
          <Readout
            label="Mięso Z/S"
            value={kgMeat}
            active={active === 'meat'}
            onActivate={() => setActive('meat')}
            extra={
              yieldPct > 0 ? (
                <span className="text-sm font-black tabular-nums"
                  style={{ color: yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : 'var(--red)' }}>
                  {fmtPct(yieldPct, 1)} wydajność
                </span>
              ) : undefined
            }
          />

          {/* Numpad */}
          <V5Numpad
            onKey={pressKey}
            onBackspaceStart={handleStartBackspaceHold}
            onBackspaceEnd={handleEndBackspaceHold}
            disabled={!selBatch || !selWorker}
          />

          {/* Przycisk ZAPISZ */}
          <button type="button" onClick={handleSave}
            disabled={!canSave || addLoading}
            className={cn(
              'flex-shrink-0 h-[90px] w-full rounded-xl text-2xl font-black flex items-center justify-center gap-4 transition-all active:scale-[0.98]',
              saveFlash && 'scale-[1.02]'
            )}
            style={{
              background: canSave ? (saveFlash ? '#15803d' : 'var(--grn)') : 'var(--panel)',
              color: canSave ? '#fff' : 'var(--mut)',
              border: `2px solid ${canSave ? 'var(--grn)' : 'var(--bd)'}`,
              opacity: !canSave ? 0.45 : 1,
            }}>
            {addLoading
              ? <span className="w-9 h-9 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              : <Save size={34} />}
            ZAPISZ WPIS
          </button>
        </div>
      </div>

      {/* ─── KPI BAR ─── */}
      <V5KpiBar entries={entries} onShowEntries={() => setEntriesModal(true)} onShowStats={() => setStatsModal(true)} />

      {/* ─── MODAL: Wpisy dzisiaj ─── */}
      {entriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" style={VARS[theme]}>
          <div className="w-[820px] max-h-[85vh] rounded-2xl border-2 flex flex-col"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4 px-6 py-4 border-b-2 flex-shrink-0" style={{ borderColor: 'var(--bd)' }}>
              <span className="text-2xl">📋</span>
              <h3 className="text-2xl font-black flex-1">Wpisy dzisiaj</h3>
              <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>{entries.length} wpisów</span>
              <button type="button" onClick={() => setEntriesModal(false)}
                className="w-10 h-10 rounded-xl border-2 flex items-center justify-center"
                style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-5 px-4 py-2 text-[11px] font-black uppercase tracking-[.14em] sticky top-0"
                style={{ background: 'var(--panel2)', color: 'var(--mut)' }}>
                <span>Godzina</span>
                <span>Pracownik</span>
                <span>Partia</span>
                <span className="text-right">Ćwiartka → Mięso</span>
                <span className="text-right">Wydajność</span>
              </div>
              {entries.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : entries.slice().reverse().map(e => {
                const yColor = e.yieldPct >= 75 ? 'var(--grn)' : e.yieldPct >= 60 ? 'var(--amb)' : 'var(--red)'
                const time = new Date(e.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={e.id} className="grid grid-cols-5 px-4 py-3 border-t-2 items-center"
                    style={{ borderColor: 'var(--bd)' }}>
                    <span className="font-mono text-sm" style={{ color: 'var(--mut)' }}>{time}</span>
                    <span className="text-sm font-semibold">{e.workerName}</span>
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>{e.rawBatchNo}</span>
                    <span className="text-right font-mono text-sm tabular-nums">{fmtKg(e.kgTaken, 1)} → {fmtKg(e.kgMeat, 1)} kg</span>
                    <span className="text-right font-mono font-black tabular-nums" style={{ color: yColor }}>{fmtPct(e.yieldPct, 1)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Statystyki dnia ─── */}
      {statsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" style={VARS[theme]}>
          <div className="w-[680px] max-h-[80vh] rounded-2xl border-2 flex flex-col"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4 px-6 py-4 border-b-2 flex-shrink-0" style={{ borderColor: 'var(--bd)' }}>
              <BarChart3 size={26} style={{ color: 'var(--grn)' }} />
              <h3 className="text-2xl font-black flex-1">Statystyki dnia</h3>
              <button type="button" onClick={() => setStatsModal(false)}
                className="w-10 h-10 rounded-xl border-2 flex items-center justify-center"
                style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {/* Nagłówki — klikalne, sortują rosnąco */}
              <div className="grid grid-cols-4 sticky top-0" style={{ background: 'var(--panel2)' }}>
                <div className="px-4 py-3 text-[11px] font-black uppercase tracking-[.14em]" style={{ color: 'var(--mut)' }}>
                  Pracownik
                </div>
                {([['taken', 'Ćwiartka'], ['meat', 'Mięso'], ['yield', 'Procent']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setStatsSort(key)}
                    className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[.14em] flex items-center justify-end gap-1 transition-colors"
                    style={{ color: statsSort === key ? 'var(--accent)' : 'var(--mut)' }}>
                    {label}
                    <span className="text-[10px]">{statsSort === key ? '▲' : ''}</span>
                  </button>
                ))}
              </div>
              {workerStats.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : workerStats.map(s => {
                const yColor = s.yieldPct >= 75 ? 'var(--grn)' : s.yieldPct >= 60 ? 'var(--amb)' : 'var(--red)'
                return (
                  <div key={s.name} className="grid grid-cols-4 px-4 py-4 border-t-2 items-center"
                    style={{ borderColor: 'var(--bd)' }}>
                    <span className="font-semibold text-base">{s.name}</span>
                    <span className="text-right font-mono font-bold tabular-nums text-base"
                      style={{ color: statsSort === 'taken' ? 'var(--ink)' : 'var(--mut)' }}>
                      {fmtKg(s.taken, 1)} kg
                    </span>
                    <span className="text-right font-mono font-bold tabular-nums text-base"
                      style={{ color: statsSort === 'meat' ? 'var(--grn)' : 'var(--mut)' }}>
                      {fmtKg(s.meat, 1)} kg
                    </span>
                    <span className="text-right font-mono font-black tabular-nums text-xl" style={{ color: yColor }}>
                      {fmtPct(s.yieldPct, 1)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Zakończenie partii ─── */}
      {finishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" style={VARS[theme]}>
          <div className="w-[480px] rounded-2xl border-2 p-8 flex flex-col gap-6"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl border-2 flex items-center justify-center"
                style={{ borderColor: 'var(--amb)', color: 'var(--amb)' }}><Flag size={30} /></div>
              <div>
                <h3 className="text-2xl font-black">Zakończenie partii</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>
                  {pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--mut)' }}>Grzbiety (kg)</span>
                <input type="number" min="0" step="0.01" value={inputBacks}
                  onChange={e => setInputBacks(e.target.value)}
                  className="h-14 rounded-xl border-2 px-4 text-2xl font-mono font-bold bg-transparent outline-none"
                  style={{ borderColor: 'var(--bd)', color: 'var(--ink)' }} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--mut)' }}>Kości (kg)</span>
                <input type="number" min="0" step="0.01" value={inputBones}
                  onChange={e => setInputBones(e.target.value)}
                  className="h-14 rounded-xl border-2 px-4 text-2xl font-mono font-bold bg-transparent outline-none"
                  style={{ borderColor: 'var(--bd)', color: 'var(--ink)' }} />
              </label>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)}
                className="flex-1 h-14 rounded-xl border-2 text-lg font-bold"
                style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
                Anuluj
              </button>
              <button type="button" onClick={handleFinishBatchConfirm}
                className="flex-[2] h-14 rounded-xl text-lg font-bold"
                style={{ background: 'var(--amb)', color: '#fff' }}>
                Zatwierdź zakończenie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Zakończenie zmiany ─── */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" style={VARS[theme]}>
          <div className="w-[400px] rounded-2xl border-2 p-8 flex flex-col gap-6"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl border-2 flex items-center justify-center"
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}><LogOut size={30} /></div>
              <div>
                <h3 className="text-2xl font-black">Zakończyć zmianę?</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>Sesja zostanie zamknięta.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)}
                className="flex-1 h-14 rounded-xl border-2 text-lg font-bold"
                style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
                Anuluj
              </button>
              <button type="button" onClick={handleCloseShift} disabled={closeLoading}
                className="flex-[2] h-14 rounded-xl text-lg font-bold flex items-center justify-center gap-3"
                style={{ background: 'var(--red)', color: '#fff' }}>
                {closeLoading
                  ? <span className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                  : <LogOut size={22} />}
                Zakończ zmianę
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
