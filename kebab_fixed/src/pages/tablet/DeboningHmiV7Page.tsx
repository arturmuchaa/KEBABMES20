/**
 * DeboningHmiV7Page — "Precision Light"
 * Filozofia: biała precyzja. Dane w ciemnej monospace na białym tle.
 * Aktywność = pełna inwersja (czarne tło, białe cyfry). Zero dekoracji.
 * Inspiracja: Bloomberg Terminal × Apple Numbers × Figma properties panel.
 * Brak przełącznika motywu — ten ekran jest zawsze jasny.
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Play, Lock, AlertTriangle, Save, Flag, LogOut, Delete, X, BarChart3 } from 'lucide-react'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const KG_PER_CONTAINER = 15

// ─── Paleta Precision Light ────────────────────────────────────────
const C = {
  bg:   '#eef0f3',
  s1:   '#ffffff',
  s2:   '#f6f7f9',
  s3:   '#ededf0',
  bd:   '#d2d5da',
  bd2:  '#b8bcc4',
  ink:  '#0d1117',
  mut:  '#8b949e',
  mut2: '#57606a',
  acc:  '#0969da',
  grn:  '#1a7f37',
  amb:  '#9a6700',
  red:  '#d1242f',
  inv:  '#0d1117',  // tło przy inwersji
} as const

// ─── Zegar ─────────────────────────────────────────────────────────
const V7Clock = memo(function V7Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: C.ink, letterSpacing: 1 }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

// ─── Kafel partii ──────────────────────────────────────────────────
const V7BatchTile = memo(function V7BatchTile({ batch, selected, onSelect }: {
  batch: RawBatch; selected: boolean; onSelect: (b: RawBatch) => void
}) {
  const { daysLeft } = getExpiryStatus(batch.expiryDate)
  const kg = Number(batch.kgAvailable)
  const containers = Math.floor(kg / KG_PER_CONTAINER)
  const statusColor = daysLeft <= 0 ? C.red : daysLeft <= 3 ? C.amb : C.grn
  const supplierLabel = batch.supplierDisplayName ?? batch.supplierName ?? '—'

  return (
    <button type="button" onClick={() => onSelect(batch)}
      className="flex flex-col justify-between h-full text-left select-none active:opacity-75"
      style={{
        background: selected ? C.inv : C.s1,
        borderTop: `4px solid ${statusColor}`,
        padding: '10px 16px',
        borderRadius: 3,
        border: `1px solid ${selected ? C.inv : C.bd}`,
        borderTopWidth: 4,
        borderTopColor: statusColor,
        transition: 'background 0.06s',
      }}>
      <div className="flex items-start justify-between gap-2">
        <span style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 900, color: selected ? '#fff' : C.ink, lineHeight: 1 }}>
          {batch.internalBatchNo}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 800, color: selected ? 'rgba(255,255,255,0.8)' : statusColor, paddingTop: 2 }}>
          {daysLeft < 0 ? 'PRZET.' : daysLeft === 0 ? 'DZIŚ!' : `${daysLeft}d`}
        </span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: selected ? 'rgba(255,255,255,0.75)' : C.mut2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {supplierLabel}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 13, color: selected ? 'rgba(255,255,255,0.6)' : C.mut }}>
        {fmtKg(kg, 0)} kg · {containers} poj.
      </span>
    </button>
  )
})

// ─── Kafel pracownika ──────────────────────────────────────────────
const V7WorkerTile = memo(function V7WorkerTile({ worker, selected, entryCount, onSelect }: {
  worker: User; selected: boolean; entryCount: number; onSelect: (w: User) => void
}) {
  const initials = worker.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className="relative flex flex-col items-center justify-center gap-1 select-none active:opacity-75"
      style={{
        background: selected ? C.inv : C.s1,
        borderRadius: 3,
        border: `1px solid ${selected ? C.inv : C.bd}`,
        transition: 'background 0.05s, border-color 0.05s',
      }}>
      <span style={{
        fontFamily: 'monospace', fontSize: 32, fontWeight: 900, lineHeight: 1,
        color: selected ? '#fff' : C.ink,
      }}>{initials}</span>
      <span style={{
        fontSize: 13, fontWeight: 700, color: selected ? 'rgba(255,255,255,0.85)' : C.ink,
        textAlign: 'center', padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
      }}>{worker.name}</span>
      {entryCount > 0 && (
        <span className="absolute top-1 right-1 min-w-[20px] h-5 px-1 flex items-center justify-center rounded-sm text-[11px] font-black"
          style={{ background: selected ? 'rgba(255,255,255,0.25)' : C.ink, color: '#fff', fontFamily: 'monospace' }}>
          {entryCount}
        </span>
      )}
    </button>
  )
})

// ─── Pole readout ──────────────────────────────────────────────────
function V7Readout({ label, value, active, locked, unit = 'kg', helper, onActivate }: {
  label: string; value: string; active: boolean; locked?: boolean
  unit?: string; helper?: string; onActivate: () => void
}) {
  return (
    <button type="button" onClick={locked ? undefined : onActivate}
      className="w-full text-left flex-shrink-0 flex flex-col"
      style={{
        background: active ? C.inv : locked ? C.s2 : C.s1,
        borderRadius: 3,
        padding: '10px 14px',
        border: `1px solid ${active ? C.inv : locked ? C.bd : C.bd}`,
        opacity: locked ? 0.72 : 1,
        cursor: locked ? 'default' : 'pointer',
        transition: 'background 0.06s',
      }}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: active ? 'rgba(255,255,255,0.5)' : C.mut2 }}>
          {label}
        </span>
        {locked && (
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: C.mut, background: C.s3, padding: '2px 6px', borderRadius: 2 }}>
            AUTO
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span style={{ fontFamily: 'monospace', fontSize: 68, fontWeight: 900, lineHeight: 1, color: active ? '#fff' : (value && value !== '0' ? C.ink : C.mut), letterSpacing: -1 }}>
          {value || '0'}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: active ? 'rgba(255,255,255,0.4)' : C.mut }}>{unit}</span>
        {active && <span className="ml-auto animate-pulse" style={{ width: 3, height: 36, background: 'rgba(255,255,255,0.6)', borderRadius: 1, alignSelf: 'center' }} />}
      </div>
      {helper && <span style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.5)' : C.mut2, fontFamily: 'monospace', marginTop: 2 }}>{helper}</span>}
    </button>
  )
}

// ─── Numpad ────────────────────────────────────────────────────────
const V7Numpad = memo(function V7Numpad({ onKey, onBsStart, onBsEnd, disabled }: {
  onKey: (k: string) => void; onBsStart: () => void; onBsEnd: () => void; disabled: boolean
}) {
  const rows = [['7','8','9'],['4','5','6'],['1','2','3']]
  const base: React.CSSProperties = { background: C.s1, border: `1px solid ${C.bd}`, borderRadius: 3, fontFamily: 'monospace', fontSize: 34, fontWeight: 900, color: C.ink, cursor: 'pointer', userSelect: 'none' }
  return (
    <div className={cn('flex flex-col gap-1.5 flex-1 min-h-0', disabled && 'opacity-25 pointer-events-none')}>
      {rows.map(row => (
        <div key={row[0]} className="flex gap-1.5 flex-1">
          {row.map(k => (
            <button key={k} type="button" onClick={() => onKey(k)}
              className="flex-1 flex items-center justify-center active:bg-[#0d1117] active:text-white active:border-[#0d1117]"
              style={base}>{k}</button>
          ))}
        </div>
      ))}
      <div className="flex gap-1.5 flex-1">
        <button type="button" onClick={() => onKey('0')} className="flex-[2] flex items-center justify-center active:bg-[#0d1117] active:text-white" style={base}>0</button>
        <button type="button" onClick={() => onKey('.')} className="flex-1 flex items-center justify-center active:bg-[#0d1117] active:text-white" style={{ ...base, color: C.mut2 }}>·</button>
        <button type="button" onClick={() => onKey('⌫')}
          onPointerDown={onBsStart} onPointerUp={onBsEnd} onPointerLeave={onBsEnd}
          className="flex-1 flex items-center justify-center active:bg-[#0d1117] active:text-white"
          style={{ ...base, color: C.amb }}>
          <Delete size={26} />
        </button>
      </div>
    </div>
  )
})

// ─── KPI bar ───────────────────────────────────────────────────────
const V7KpiBar = memo(function V7KpiBar({ entries, onEntries, onStats }: {
  entries: DeboningEntry[]; onEntries: () => void; onStats: () => void
}) {
  const totTaken = entries.reduce((s, e) => s + e.kgTaken, 0)
  const totMeat  = entries.reduce((s, e) => s + e.kgMeat, 0)
  const totBacks = entries.reduce((s, e) => s + (e.kgBacks ?? 0), 0)
  const totBones = entries.reduce((s, e) => s + (e.kgBones ?? 0), 0)
  const yPct = totTaken > 0 ? (totMeat / totTaken) * 100 : 0
  const yColor = yPct >= 75 ? C.grn : yPct >= 60 ? C.amb : totMeat > 0 ? C.red : C.mut

  const yBg   = yPct >= 75 ? 'rgba(26,127,55,0.07)' : yPct >= 60 ? 'rgba(154,103,0,0.07)' : totMeat > 0 ? 'rgba(209,36,47,0.07)' : 'transparent'

  return (
    <div className="flex-shrink-0 flex" style={{ height: 68, background: C.s1, borderTop: `2px solid ${C.bd}` }}>

      {/* Ćwiartka */}
      <div className="flex-1 flex flex-col items-center justify-center gap-0.5" style={{ borderRight: `1px solid ${C.bd}` }}>
        <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: C.ink, lineHeight: 1 }}>{fmtKg(totTaken, 0)} kg</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>ĆWIARTKA</span>
      </div>

      {/* Mięso */}
      <div className="flex-1 flex flex-col items-center justify-center gap-0.5" style={{ borderRight: `1px solid ${C.bd}` }}>
        <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: C.grn, lineHeight: 1 }}>{fmtKg(totMeat, 0)} kg</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>MIĘSO</span>
      </div>

      {/* Wydajność — wyróżnione tło */}
      <div className="flex-[1.4] flex flex-col items-center justify-center gap-0.5" style={{ borderRight: `1px solid ${C.bd}`, background: yBg }}>
        <span style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 900, color: yColor, lineHeight: 1 }}>
          {totMeat > 0 ? fmtPct(yPct, 1) : '—'}
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>WYDAJNOŚĆ</span>
      </div>

      {/* Grzbiety */}
      <div className="flex-1 flex flex-col items-center justify-center gap-0.5" style={{ borderRight: `1px solid ${C.bd}` }}>
        <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: C.amb, lineHeight: 1 }}>{fmtKg(totBacks, 0)} kg</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>GRZBIETY</span>
      </div>

      {/* Kości */}
      <div className="flex-1 flex flex-col items-center justify-center gap-0.5" style={{ borderRight: `1px solid ${C.bd}` }}>
        <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: C.amb, lineHeight: 1 }}>{fmtKg(totBones, 0)} kg</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>KOŚCI</span>
      </div>

      {/* Wpisy */}
      <div className="flex-[0.7] flex flex-col items-center justify-center gap-0.5" style={{ borderRight: `1px solid ${C.bd}` }}>
        <span style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 900, color: C.ink, lineHeight: 1 }}>{entries.length}</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>WPISY</span>
      </div>

      {/* Przycisk: lista wpisów */}
      <button type="button" onClick={onEntries}
        className="flex-[0.9] flex flex-col items-center justify-center gap-1 active:opacity-60"
        style={{ background: 'transparent', border: 'none', borderRight: `1px solid ${C.bd}`, cursor: 'pointer' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>📋</span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.acc }}>LISTA</span>
      </button>

      {/* Przycisk: statystyki */}
      <button type="button" onClick={onStats}
        className="flex-[0.9] flex flex-col items-center justify-center gap-1 active:opacity-60"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <BarChart3 size={18} style={{ color: C.grn }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.grn }}>RANKING</span>
      </button>

    </div>
  )
})

// ─── Główny komponent ──────────────────────────────────────────────
export function DeboningHmiV7Page() {
  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())
  const { session, timeWindow, loading: sessionLoading, startDay, startLoading, closeDay, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<'taken' | 'meat'>('taken')
  const [takenMode, setTakenMode] = useState<'kg' | 'poj'>('kg')
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal,  setFinishModal]  = useState(false)
  const [shiftModal,   setShiftModal]   = useState(false)
  const [statsModal,   setStatsModal]   = useState(false)
  const [entriesModal, setEntriesModal] = useState(false)
  const [statsSort,    setStatsSort]    = useState<'taken' | 'meat' | 'yield'>('taken')
  const [statsDir,     setStatsDir]     = useState<'asc' | 'desc'>('asc')
  const [inputBacks,   setInputBacks]   = useState('')
  const [inputBones,   setInputBones]   = useState('')
  const [toastMsg,     setToastMsg]     = useState('')
  const [toastOk,      setToastOk]      = useState(true)
  const [toastVis,     setToastVis]     = useState(false)
  const toastRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (toastRef.current) clearTimeout(toastRef.current)
      if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
      if (longPressRef.current) clearTimeout(longPressRef.current)
    }
  }, [])

  const showToast = useCallback((msg: string, ok = true) => {
    setToastMsg(msg); setToastOk(ok); setToastVis(true)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastVis(false), 3000)
  }, [])

  const allActiveBatches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)),
    [batchData.data])

  const batches  = useMemo(() => allActiveBatches.slice(0, 6), [allActiveBatches])
  const totalKgM = useMemo(() => allActiveBatches.reduce((s, b) => s + Number(b.kgAvailable), 0), [allActiveBatches])
  const workers  = useMemo(() => (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'), [workerData.data])

  const entryCountByWorkerId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.workerId, (m.get(e.workerId) ?? 0) + 1)
    return m
  }, [entries])

  const workerStats = useMemo(() => {
    const m = new Map<string, { name: string; taken: number; meat: number }>()
    for (const e of entries) {
      const cur = m.get(e.workerId) ?? { name: e.workerName, taken: 0, meat: 0 }
      cur.taken += e.kgTaken; cur.meat += e.kgMeat; m.set(e.workerId, cur)
    }
    const rows = Array.from(m.values()).map(s => ({ ...s, yieldPct: s.taken > 0 ? (s.meat / s.taken) * 100 : 0 }))
    const key = statsSort === 'taken' ? 'taken' : statsSort === 'meat' ? 'meat' : 'yieldPct'
    return rows.sort((a, b) => statsDir === 'asc' ? a[key] - b[key] : b[key] - a[key])
  }, [entries, statsSort, statsDir])

  const pendingFinalize    = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)
  const fefoAlerts         = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 3)

  const takenRaw = parseFloat(kgTaken) || 0
  const taken    = takenMode === 'poj' ? takenRaw * KG_PER_CONTAINER : takenRaw
  const meat     = parseFloat(kgMeat) || 0
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
    if (active === 'taken') setKgTaken(apply); else setKgMeat(apply)
  }, [active])

  const clearField = useCallback(() => { if (active === 'taken') setKgTaken(''); else setKgMeat('') }, [active])
  const onBsStart  = useCallback(() => { longPressRef.current = setTimeout(clearField, 600) }, [clearField])
  const onBsEnd    = useCallback(() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }, [])

  const switchTakenMode = useCallback((mode: 'kg' | 'poj') => { setTakenMode(mode); setKgTaken(''); setActive('taken') }, [])
  const pickBatch  = useCallback((b: RawBatch) => { setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken') }, [])
  const pickWorker = useCallback((w: User) => { setSelWorker(w); setActive('taken') }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, false); else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (addLoading) return
    if (!selBatch || !selWorker || !canSave || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, false); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 300)
    setKgTaken(''); setKgMeat(''); setActive('taken')
    showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

  async function handleCloseShift() {
    const err = await closeDay()
    if (err) showToast(err, false); else { setShiftModal(false); showToast('Zmiana zakończona') }
  }

  async function handleFinishBatchConfirm() {
    if (!session) return
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', false); return }
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', false); return }
    const sumTaken = finalizeTotalTaken || 1; let rb = 0, rn = 0
    for (let i = 0; i < pendingFinalize.length; i++) {
      const e = pendingFinalize[i], isLast = i === pendingFinalize.length - 1, share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - rb) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - rn) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      rb += kb; rn += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
    }
    setFinishModal(false); setInputBacks(''); setInputBones('')
    showToast(`Zakończono ${pendingFinalize.length} wpisów`)
  }

  const root: React.CSSProperties = { background: C.bg, color: C.ink, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }

  if (sessionLoading) return <div style={root}><div className="flex flex-1 items-center justify-center"><Spinner size={48} /></div></div>

  if (!session) return (
    <div style={root}>
      <div className="flex flex-col flex-1 items-center justify-center gap-8">
        <div style={{ width: 96, height: 96, background: C.s1, border: `2px solid ${C.grn}`, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.grn }}>
          <Play size={52} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 40, fontWeight: 900, margin: 0, color: C.ink }}>Rozpocznij dzień</h2>
          <p style={{ fontSize: 18, color: C.mut2, marginTop: 8 }}>Data produkcyjna: {timeWindow.productionDate}</p>
        </div>
        <button type="button" onClick={handleStartDay} disabled={startLoading}
          className="flex items-center gap-4 active:opacity-75"
          style={{ height: 72, padding: '0 56px', background: C.inv, color: '#fff', fontSize: 22, fontWeight: 900, borderRadius: 3, border: 'none', cursor: 'pointer' }}>
          {startLoading ? <span className="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={28} />}
          Rozpocznij dzień
        </button>
      </div>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return (
    <div style={root}>
      <div className="flex flex-col flex-1 items-center justify-center gap-6">
        <div style={{ width: 96, height: 96, background: C.s1, border: `2px solid ${C.amb}`, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.amb }}>
          <Lock size={52} />
        </div>
        <h2 style={{ fontSize: 36, fontWeight: 900, color: C.ink }}>{session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}</h2>
        <p style={{ fontSize: 18, color: C.mut2, maxWidth: 480, textAlign: 'center' }}>
          {session.status === 'approved' ? `Dane z dnia ${session.sessionDate} są zablokowane.` : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'}
        </p>
      </div>
    </div>
  )

  return (
    <div style={root}>

      {/* TOAST */}
      <div className={cn('fixed top-3 left-1/2 -translate-x-1/2 z-50 px-5 py-3 flex items-center gap-3 font-bold transition-opacity duration-150', toastVis ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        style={{ background: C.s1, border: `1px solid ${toastOk ? C.grn : C.red}`, color: toastOk ? C.grn : C.red, borderRadius: 3, fontSize: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
        {toastOk ? '✓' : '⚠'} {toastMsg}
      </div>

      {/* NAGŁÓWEK */}
      <header className="flex-shrink-0 flex items-center gap-5 px-5" style={{ height: 60, background: C.s1, borderBottom: `1px solid ${C.bd}` }}>
        <span style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 900, letterSpacing: 3, color: C.ink }}>ROZBIÓR</span>
        <span style={{ fontSize: 12, color: C.mut, fontFamily: 'monospace' }}>{session.sessionDate}</span>

        {[
          { label: 'MAGAZYN', val: `${fmtKg(totalKgM, 0)} kg` },
          { label: 'PARTIE',  val: String(allActiveBatches.length) },
          { label: 'OPERATOR', val: selWorker?.name.split(' ')[0] ?? '—', accent: !!selWorker },
        ].map(c => (
          <div key={c.label} className="flex flex-col justify-center pl-4" style={{ borderLeft: `1px solid ${C.bd}` }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', color: C.mut }}>{c.label}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 900, color: c.accent ? C.acc : C.ink, lineHeight: 1.2 }}>{c.val}</span>
          </div>
        ))}

        <div className="flex-1" />
        {fefoAlerts.length > 0 && (
          <span className="flex items-center gap-2 px-3 py-1" style={{ border: `1px solid ${C.red}`, color: C.red, borderRadius: 3, fontSize: 13, fontWeight: 700 }}>
            <AlertTriangle size={14} />
            {fefoAlerts.length === 1 ? `Partia ${fefoAlerts[0].internalBatchNo} — termin!` : `${fefoAlerts.length} partii — termin!`}
          </span>
        )}
        <V7Clock />
        <button type="button" onClick={() => setShiftModal(true)}
          className="flex items-center gap-2 active:opacity-75" style={{ height: 34, padding: '0 14px', border: `1px solid ${C.bd}`, borderRadius: 3, background: 'transparent', color: C.mut2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <LogOut size={14} /> Zakończ zmianę
        </button>
        <button type="button" onClick={() => setFinishModal(true)}
          className="flex items-center gap-2 active:opacity-75" style={{ height: 34, padding: '0 14px', border: `1px solid ${C.amb}`, borderRadius: 3, background: 'transparent', color: C.amb, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Flag size={14} /> Zakończ partię
        </button>
      </header>

      {/* PASEK PARTII */}
      <div className="flex-shrink-0 grid gap-1.5 px-1.5 py-1.5" style={{ height: 100, background: C.bg, gridTemplateColumns: `repeat(${Math.max(batches.length, 1)}, 1fr)` }}>
        {batchData.loading
          ? <div className="col-span-6 flex items-center justify-center"><Spinner size={22} /></div>
          : batches.length === 0
            ? <div className="col-span-6 flex items-center justify-center" style={{ fontSize: 13, color: C.mut }}>Brak aktywnych partii</div>
            : batches.map(b => <V7BatchTile key={b.id} batch={b} selected={selBatch?.id === b.id} onSelect={pickBatch} />)
        }
      </div>

      {/* OBSZAR GŁÓWNY */}
      <div className="flex-1 flex min-h-0">

        {/* LEWY: pracownicy */}
        <div className="flex-shrink-0 p-1.5" style={{ width: '45%', background: C.bg, borderRight: `1px solid ${C.bd}` }}>
          {workerData.loading
            ? <div className="flex h-full items-center justify-center"><Spinner size={30} /></div>
            : <div className="grid grid-cols-4 grid-rows-4 gap-1 h-full">
                {Array.from({ length: 16 }, (_, i) => {
                  const w = workers[i]
                  if (!w) return <div key={`e-${i}`} />
                  return <V7WorkerTile key={w.id} worker={w} selected={selWorker?.id === w.id} entryCount={entryCountByWorkerId.get(w.id) ?? 0} onSelect={pickWorker} />
                })}
              </div>
          }
        </div>

        {/* PRAWY: panel wag */}
        <div className="flex-1 flex flex-col gap-2 p-3 min-h-0" style={{ background: C.bg }}>

          {/* Pola ćwiartki — split 75/25 kg|poj */}
          <div className="flex gap-2 flex-shrink-0">
            <div style={{ flex: 3 }}>
              <V7Readout
                label="Ćwiartka kg"
                value={takenMode === 'kg' ? kgTaken : (takenRaw > 0 ? fmtKg(takenRaw * KG_PER_CONTAINER, 0) : '')}
                active={active === 'taken' && takenMode === 'kg'}
                locked={takenMode === 'poj'}
                unit="kg"
                onActivate={() => switchTakenMode('kg')}
              />
            </div>
            <div style={{ flex: 1 }}>
              <V7Readout
                label="Pojemniki"
                value={takenMode === 'poj' ? kgTaken : (takenRaw > 0 ? String(Math.floor(takenRaw / KG_PER_CONTAINER)) : '')}
                active={active === 'taken' && takenMode === 'poj'}
                locked={takenMode === 'kg'}
                unit="poj."
                onActivate={() => switchTakenMode('poj')}
              />
            </div>
          </div>

          {/* Pole mięsa */}
          <V7Readout label="Mięso Z/S" value={kgMeat} active={active === 'meat'} unit="kg"
            helper={yieldPct > 0 ? `${fmtPct(yieldPct, 1)} wydajność` : undefined}
            onActivate={() => setActive('meat')} />

          {/* Numpad */}
          <V7Numpad onKey={pressKey} onBsStart={onBsStart} onBsEnd={onBsEnd} disabled={!selBatch || !selWorker} />

          {/* ZAPISZ */}
          <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
            className={cn('flex-shrink-0 flex items-center justify-center gap-4 active:opacity-80', saveFlash && 'scale-[1.01]')}
            style={{
              height: 82, borderRadius: 3, fontSize: 20, fontWeight: 900, fontFamily: 'monospace', letterSpacing: 2,
              background: canSave ? C.inv : C.s3,
              color: canSave ? '#fff' : C.mut,
              border: `1px solid ${canSave ? C.inv : C.bd}`,
              opacity: !canSave ? 0.35 : 1,
              cursor: canSave ? 'pointer' : 'not-allowed',
              transition: 'background 0.08s',
            }}>
            {addLoading ? <span className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={28} />}
            ZAPISZ WPIS
          </button>
        </div>
      </div>

      {/* KPI BAR */}
      <V7KpiBar entries={entries} onEntries={() => setEntriesModal(true)} onStats={() => setStatsModal(true)} />

      {/* MODAL: Wpisy */}
      {entriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="flex flex-col" style={{ width: 820, maxHeight: '85vh', background: C.s1, border: `1px solid ${C.bd2}`, borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: `1px solid ${C.bd}` }}>
              <span style={{ fontSize: 22 }}>📋</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.ink, flex: 1 }}>Wpisy dzisiaj</span>
              <span style={{ fontSize: 13, color: C.mut, fontFamily: 'monospace' }}>{entries.length} wpisów</span>
              <button type="button" onClick={() => setEntriesModal(false)} style={{ width: 36, height: 36, border: `1px solid ${C.bd}`, borderRadius: 3, background: 'transparent', color: C.mut, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-5 px-4 py-2 sticky top-0" style={{ background: C.s2, fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: C.mut }}>
                <span>GODZINA</span><span>PRACOWNIK</span><span>PARTIA</span><span style={{ textAlign: 'right' }}>ĆWIARTKA → MIĘSO</span><span style={{ textAlign: 'right' }}>WYDAJNOŚĆ</span>
              </div>
              {entries.length === 0
                ? <div className="py-10 text-center" style={{ color: C.mut, fontSize: 14 }}>Brak wpisów z dziś</div>
                : entries.slice().reverse().map(e => {
                  const yc = e.yieldPct >= 75 ? C.grn : e.yieldPct >= 60 ? C.amb : C.red
                  const time = new Date(e.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={e.id} className="grid grid-cols-5 px-4 py-3 items-center" style={{ borderTop: `1px solid ${C.bd}`, fontSize: 13 }}>
                      <span style={{ fontFamily: 'monospace', color: C.mut }}>{time}</span>
                      <span style={{ fontWeight: 600, color: C.ink }}>{e.workerName}</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.acc }}>{e.rawBatchNo}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', color: C.ink }}>{fmtKg(e.kgTaken, 1)} → {fmtKg(e.kgMeat, 1)} kg</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 900, color: yc }}>{fmtPct(e.yieldPct, 1)}</span>
                    </div>
                  )
                })
              }
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Statystyki */}
      {statsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="flex flex-col" style={{ width: 660, maxHeight: '80vh', background: C.s1, border: `1px solid ${C.bd2}`, borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: `1px solid ${C.bd}` }}>
              <BarChart3 size={24} style={{ color: C.grn }} />
              <span style={{ fontSize: 22, fontWeight: 900, color: C.ink, flex: 1 }}>Statystyki dnia</span>
              <button type="button" onClick={() => setStatsModal(false)} style={{ width: 36, height: 36, border: `1px solid ${C.bd}`, borderRadius: 3, background: 'transparent', color: C.mut, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-4 sticky top-0" style={{ background: C.s2 }}>
                <div className="px-4 py-3" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: C.mut }}>PRACOWNIK</div>
                {(['taken', 'meat', 'yield'] as const).map(k => (
                  <button key={k} type="button"
                    onClick={() => { if (statsSort === k) setStatsDir(d => d === 'asc' ? 'desc' : 'asc'); else { setStatsSort(k); setStatsDir('asc') } }}
                    className="px-4 py-3 flex items-center justify-end gap-1 active:opacity-70"
                    style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: statsSort === k ? C.acc : C.mut, background: 'transparent', border: 'none', cursor: 'pointer', textTransform: 'uppercase' }}>
                    {k === 'taken' ? 'ĆWIARTKA' : k === 'meat' ? 'MIĘSO' : 'PROCENT'}
                    {statsSort === k && <span>{statsDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                ))}
              </div>
              {workerStats.length === 0
                ? <div className="py-10 text-center" style={{ color: C.mut, fontSize: 14 }}>Brak wpisów z dziś</div>
                : workerStats.map(s => {
                  const yc = s.yieldPct >= 75 ? C.grn : s.yieldPct >= 60 ? C.amb : C.red
                  return (
                    <div key={s.name} className="grid grid-cols-4 px-4 py-4 items-center" style={{ borderTop: `1px solid ${C.bd}` }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: C.ink }}>{s.name}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: statsSort === 'taken' ? C.ink : C.mut }}>{fmtKg(s.taken, 1)} kg</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: statsSort === 'meat' ? C.grn : C.mut }}>{fmtKg(s.meat, 1)} kg</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 900, fontSize: 20, color: yc }}>{fmtPct(s.yieldPct, 1)}</span>
                    </div>
                  )
                })
              }
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Zakończenie partii */}
      {finishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="flex flex-col gap-5 p-7" style={{ width: 480, background: C.s1, border: `1px solid ${C.bd2}`, borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-4">
              <div style={{ width: 52, height: 52, border: `2px solid ${C.amb}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.amb }}><Flag size={26} /></div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.ink }}>Zakończenie partii</div>
                <div style={{ fontSize: 13, color: C.mut, fontFamily: 'monospace' }}>{pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg</div>
              </div>
            </div>
            {(['Grzbiety (kg)', 'Kości (kg)'] as const).map((label, i) => (
              <label key={label} className="flex flex-col gap-1.5">
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: C.mut }}>{label}</span>
                <input type="number" min="0" step="0.01" value={i === 0 ? inputBacks : inputBones}
                  onChange={e => i === 0 ? setInputBacks(e.target.value) : setInputBones(e.target.value)}
                  style={{ height: 52, border: `1px solid ${C.bd}`, borderRadius: 3, padding: '0 14px', fontSize: 22, fontFamily: 'monospace', fontWeight: 700, background: C.s2, color: C.ink, outline: 'none' }} />
              </label>
            ))}
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)} style={{ flex: 1, height: 50, border: `1px solid ${C.bd}`, borderRadius: 3, background: 'transparent', color: C.mut2, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Anuluj</button>
              <button type="button" onClick={handleFinishBatchConfirm} style={{ flex: 2, height: 50, border: 'none', borderRadius: 3, background: C.amb, color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>Zatwierdź zakończenie</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Zakończenie zmiany */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="flex flex-col gap-5 p-7" style={{ width: 400, background: C.s1, border: `1px solid ${C.bd2}`, borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-4">
              <div style={{ width: 52, height: 52, border: `2px solid ${C.red}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.red }}><LogOut size={26} /></div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.ink }}>Zakończyć zmianę?</div>
                <div style={{ fontSize: 13, color: C.mut }}>Sesja zostanie zamknięta.</div>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)} style={{ flex: 1, height: 50, border: `1px solid ${C.bd}`, borderRadius: 3, background: 'transparent', color: C.mut2, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Anuluj</button>
              <button type="button" onClick={handleCloseShift} disabled={closeLoading}
                className="flex items-center justify-center gap-3" style={{ flex: 2, height: 50, border: 'none', borderRadius: 3, background: C.red, color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>
                {closeLoading ? <span className="w-5 h-5 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <LogOut size={20} />}
                Zakończ zmianę
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
