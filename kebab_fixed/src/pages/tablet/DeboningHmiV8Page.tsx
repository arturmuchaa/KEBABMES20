/**
 * HMI v8 — „PORCELANA". Jasny przemysłowy HMI rozbioru pod panel
 * nierdzewny 21" (landscape, dotyk w rękawicy, mocne oświetlenie hali).
 *
 * Założenia (wymagania właściciela):
 *  - tylko jasny motyw, duże i czytelne przyciski,
 *  - pracownicy = MAŁE kafelki (pasek chipów), partie i wagi = DUŻE,
 *  - idiotoodporność: kroki ①②③, przycisk ZAPISZ zawsze mówi czego
 *    brakuje, mięso > zabrane blokuje zapis i świeci na czerwono.
 *
 * Logika (sesja, wpisy, FEFO, kości/grzbiety) przeniesiona 1:1 z HMI v5 —
 * zmienia się wyłącznie warstwa prezentacji.
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Play, Lock, Save, Flag, LogOut, X, BarChart3, ListChecks } from 'lucide-react'
import type { RawBatch, User } from '@/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'

const KG_PER_CONTAINER = 15

type ActiveField = 'taken' | 'meat'

/** Paleta „porcelana" — ciepła biel hali, atrament, akcenty sygnalizacyjne. */
const VARS: CSSProperties = {
  ['--app' as string]:   '#F3F1EC',
  ['--panel' as string]: '#FFFFFF',
  ['--key' as string]:   '#FBFAF7',
  ['--bd' as string]:    '#D9D4CA',
  ['--ink' as string]:   '#191613',
  ['--mut' as string]:   '#8A8276',
  ['--grn' as string]:   '#157A3A',
  ['--amb' as string]:   '#B07A12',
  ['--red' as string]:   '#BE2B1C',
}

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

/** Numer kroku — wypełnia się po zaliczeniu. */
function StepDot({ no, done }: { no: number; done: boolean }) {
  return (
    <span className="w-9 h-9 rounded-full border-[3px] flex items-center justify-center text-lg font-black flex-shrink-0"
      style={done
        ? { background: 'var(--grn)', borderColor: 'var(--grn)', color: '#fff' }
        : { borderColor: 'var(--bd)', color: 'var(--mut)', background: 'var(--panel)' }}>
      {done ? '✓' : no}
    </span>
  )
}

function SectionLabel({ no, done, children }: { no: number; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-2 flex-shrink-0">
      <StepDot no={no} done={done} />
      <span className="text-[15px] font-black uppercase tracking-[.18em]" style={{ color: 'var(--ink)' }}>
        {children}
      </span>
    </div>
  )
}

// ─── Kafel partii (DUŻY — lewa szyna) ──────────────────────────────
const V8BatchTile = memo(function V8BatchTile({ batch, selected, first, onSelect }: {
  batch: RawBatch; selected: boolean; first: boolean; onSelect: (b: RawBatch) => void
}) {
  const { daysLeft } = getExpiryStatus(batch.expiryDate)
  const kg = Number(batch.kgAvailable)
  const expiry = daysLeft < 0
    ? { txt: 'PRZETERMINOWANA', c: 'var(--red)' }
    : daysLeft === 0
      ? { txt: 'ZUŻYĆ DZIŚ', c: 'var(--red)' }
      : daysLeft <= 3
        ? { txt: `${daysLeft} DNI`, c: 'var(--amb)' }
        : { txt: `${daysLeft} dni`, c: 'var(--mut)' }
  return (
    <button type="button" onClick={() => onSelect(batch)}
      className={cn(
        'w-full text-left rounded-2xl border-[3px] px-5 py-4 select-none active:translate-y-px transition-colors flex-shrink-0',
        selected ? '' : 'hover:border-[var(--ink)]'
      )}
      style={selected
        ? { background: 'var(--ink)', borderColor: 'var(--ink)', color: '#fff' }
        : { background: 'var(--panel)', borderColor: 'var(--bd)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-4xl font-black leading-none tabular-nums"
          style={{ color: selected ? '#fff' : 'var(--ink)' }}>
          {batch.internalBatchNo}
        </span>
        {first && !selected && (
          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md"
            style={{ background: 'var(--grn)', color: '#fff' }}>najpierw</span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xl font-black tabular-nums" style={{ color: selected ? '#fff' : 'var(--ink)' }}>
          {fmtKg(kg, 0)} <span className="text-sm font-bold" style={{ color: selected ? 'rgba(255,255,255,.7)' : 'var(--mut)' }}>kg</span>
        </span>
        <span className="text-[13px] font-black uppercase tracking-wide"
          style={{ color: selected ? 'rgba(255,255,255,.85)' : expiry.c }}>
          {expiry.txt}
        </span>
      </div>
      <div className="text-[12px] font-semibold truncate mt-0.5"
        style={{ color: selected ? 'rgba(255,255,255,.6)' : 'var(--mut)' }}>
        {batch.supplierDisplayName ?? batch.supplierName ?? '—'} · {Math.floor(kg / KG_PER_CONTAINER)} poj.
      </div>
    </button>
  )
})

// ─── Chip pracownika (MAŁY — wymaganie właściciela) ────────────────
const V8WorkerChip = memo(function V8WorkerChip({ worker, selected, entryCount, onSelect }: {
  worker: User; selected: boolean; entryCount: number; onSelect: (w: User) => void
}) {
  const first = worker.name.split(' ')[0]
  const last = worker.name.split(' ').slice(1).join(' ')
  return (
    <button type="button" onClick={() => onSelect(worker)}
      className="h-14 px-4 rounded-xl border-[3px] flex items-center gap-2 select-none active:translate-y-px transition-colors flex-shrink-0"
      style={selected
        ? { background: 'var(--ink)', borderColor: 'var(--ink)', color: '#fff' }
        : { background: 'var(--panel)', borderColor: 'var(--bd)', color: 'var(--ink)' }}>
      <span className="text-base font-black leading-none whitespace-nowrap">
        {first}{last ? ` ${last[0]}.` : ''}
      </span>
      {entryCount > 0 && (
        <span className="min-w-[24px] h-6 px-1.5 rounded-full text-[12px] font-black flex items-center justify-center"
          style={{ background: selected ? '#fff' : 'var(--grn)', color: selected ? 'var(--ink)' : '#fff' }}>
          {entryCount}
        </span>
      )}
    </button>
  )
})

// ─── Wielki odczyt wagi ────────────────────────────────────────────
function V8Readout({ label, value, unit, active, error, sub, onActivate, extraHeader }: {
  label: string; value: string; unit: string; active: boolean; error?: boolean
  sub?: string; onActivate: () => void; extraHeader?: React.ReactNode
}) {
  return (
    <button type="button" onClick={onActivate}
      className="flex-1 rounded-2xl border-[3px] px-6 py-4 text-left select-none transition-colors flex flex-col min-w-0"
      style={{
        background: 'var(--panel)',
        borderColor: error ? 'var(--red)' : active ? 'var(--ink)' : 'var(--bd)',
        boxShadow: active && !error ? '0 0 0 3px rgba(25,22,19,.15)' : undefined,
      }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-black uppercase tracking-[.18em]"
          style={{ color: error ? 'var(--red)' : active ? 'var(--ink)' : 'var(--mut)' }}>
          {label}
        </span>
        {extraHeader}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="font-mono font-black tabular-nums leading-none"
          style={{ fontSize: 'clamp(56px, 5.5vw, 88px)', color: error ? 'var(--red)' : value ? 'var(--ink)' : 'var(--bd)' }}>
          {value || '0'}
        </span>
        <span className="text-2xl font-black" style={{ color: 'var(--mut)' }}>{unit}</span>
      </div>
      <div className="text-[13px] font-bold mt-auto pt-1" style={{ color: error ? 'var(--red)' : 'var(--mut)' }}>
        {sub || ' '}
      </div>
    </button>
  )
}

// ─── Numpad ────────────────────────────────────────────────────────
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const
const V8Numpad = memo(function V8Numpad({ onKey, onBackStart, onBackEnd }: {
  onKey: (k: string) => void; onBackStart: () => void; onBackEnd: () => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5 flex-1 min-h-0">
      {KEYS.map(k => (
        <button key={k} type="button"
          onClick={() => onKey(k)}
          onPointerDown={k === '⌫' ? onBackStart : undefined}
          onPointerUp={k === '⌫' ? onBackEnd : undefined}
          onPointerLeave={k === '⌫' ? onBackEnd : undefined}
          className="rounded-2xl border-[3px] font-black select-none active:translate-y-[2px] transition-transform flex items-center justify-center"
          style={{
            background: k === '⌫' ? '#F4E8E6' : 'var(--key)',
            borderColor: k === '⌫' ? 'var(--red)' : 'var(--bd)',
            color: k === '⌫' ? 'var(--red)' : 'var(--ink)',
            fontSize: 'clamp(28px, 2.4vw, 40px)',
            minHeight: 0,
          }}>
          {k}
        </button>
      ))}
    </div>
  )
})

// ─── Strona ────────────────────────────────────────────────────────
export function DeboningHmiV8Page() {
  const batchData  = useApi(() => rawBatchesApi.list())
  const workerData = useApi(() => usersApi.list())
  const { session, timeWindow, loading: sessionLoading, startDay, startLoading, closeDay, closeLoading } = useProductionSession()
  const { entries, addEntry, editEntry, addLoading } = useDeboningEntries(session?.id ?? null)

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<ActiveField>('taken')
  const [takenMode, setTakenMode] = useState<'kg' | 'poj'>('kg')
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal,  setFinishModal]  = useState(false)
  const [shiftModal,   setShiftModal]   = useState(false)
  const [entriesModal, setEntriesModal] = useState(false)
  const [inputBacks, setInputBacks] = useState('')
  const [inputBones, setInputBones] = useState('')
  const [toastMsg,  setToastMsg]  = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [toastVis,  setToastVis]  = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg(msg); setToastType(type); setToastVis(true)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToastVis(false), 3000)
  }, [])

  useEffect(() => () => {
    if (toastRef.current) clearTimeout(toastRef.current)
    if (longPressRef.current) clearTimeout(longPressRef.current)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
  }, [])

  const allActiveBatches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => Number(b.kgAvailable) > 0 && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)),
    [batchData.data])
  const batches = useMemo(() => allActiveBatches.slice(0, 6), [allActiveBatches])
  const totalKgMagazyn = useMemo(() => allActiveBatches.reduce((s, b) => s + Number(b.kgAvailable), 0), [allActiveBatches])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  const entryCountByWorkerId = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.workerId, (m.get(e.workerId) ?? 0) + 1)
    return m
  }, [entries])

  const dayTotals = useMemo(() => {
    let taken = 0, meat = 0
    for (const e of entries) { taken += e.kgTaken; meat += e.kgMeat }
    return { taken, meat, yieldPct: taken > 0 ? (meat / taken) * 100 : 0 }
  }, [entries])

  const pendingFinalize = entries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)

  const takenRaw = parseFloat(kgTaken) || 0
  const taken = takenMode === 'poj' ? takenRaw * KG_PER_CONTAINER : takenRaw
  const meat  = parseFloat(kgMeat)  || 0
  const meatTooBig = taken > 0 && meat > taken
  const yieldPct = taken > 0 && meat > 0 && !meatTooBig ? (meat / taken) * 100 : 0
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && !meatTooBig

  /** Idiotoodporność: przycisk zawsze mówi, czego brakuje. */
  const saveHint = !selBatch ? 'WYBIERZ PARTIĘ'
    : !selWorker ? 'WYBIERZ PRACOWNIKA'
    : taken <= 0 ? 'PODAJ WAGĘ ZABRANĄ'
    : meat <= 0 ? 'PODAJ WAGĘ MIĘSA'
    : meatTooBig ? 'MIĘSO > ZABRANE!'
    : 'ZAPISZ WPIS'

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
    if (active === 'taken') setKgTaken(''); else setKgMeat('')
  }, [active])
  const handleBackStart = useCallback(() => {
    longPressRef.current = setTimeout(clearActiveField, 600)
  }, [clearActiveField])
  const handleBackEnd = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }, [])

  const switchTakenMode = useCallback((mode: 'kg' | 'poj') => {
    setTakenMode(mode); setKgTaken(''); setActive('taken')
  }, [])
  const pickBatch = useCallback((b: RawBatch) => {
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [])
  const pickWorker = useCallback((w: User) => { setSelWorker(w); setActive('taken') }, [])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'err'); else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (addLoading || !canSave || !selBatch || !selWorker || !session) return
    const err = await addEntry(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken, kgMeat: meat },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 350)
    setKgTaken(''); setKgMeat(''); setActive('taken')
    showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)
  }

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

  async function handleCloseShift() {
    const err = await closeDay()
    if (err) showToast(err, 'err')
    else { setShiftModal(false); showToast('Zmiana zakończona') }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="h-full w-full overflow-hidden flex flex-col" style={{ ...VARS, background: 'var(--app)', color: 'var(--ink)' }}>
      {children}
    </div>
  )

  if (sessionLoading) return wrap(
    <div className="flex items-center justify-center flex-1"><Spinner size={48} /></div>
  )

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-10">
      <div className="text-center">
        <div className="text-[13px] font-black uppercase tracking-[.3em] mb-3" style={{ color: 'var(--mut)' }}>
          Rozbiór · {timeWindow.productionDate}
        </div>
        <h2 className="text-6xl font-black">Rozpocznij dzień</h2>
      </div>
      <button type="button" onClick={handleStartDay} disabled={startLoading}
        className="h-28 px-20 rounded-3xl text-4xl font-black flex items-center gap-5 active:translate-y-px"
        style={{ background: 'var(--grn)', color: '#fff', boxShadow: '0 8px 0 #0E5226' }}>
        {startLoading
          ? <span className="w-9 h-9 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          : <Play size={40} />}
        START
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <Lock size={72} style={{ color: 'var(--amb)' }} />
      <h2 className="text-5xl font-black">
        {session.status === 'approved' ? 'Dzień zatwierdzony' : 'Dzień zakończony'}
      </h2>
      <p className="text-2xl" style={{ color: 'var(--mut)' }}>
        {session.status === 'approved' ? `Dane z ${session.sessionDate} są zablokowane.` : 'Czeka na potwierdzenie biura.'}
      </p>
    </div>
  )

  return wrap(
    <>
      {/* Błysk zapisu — pełnoekranowe potwierdzenie */}
      <div className={cn('fixed inset-0 z-[60] pointer-events-none transition-opacity',
        saveFlash ? 'opacity-100' : 'opacity-0')}
        style={{ background: 'rgba(21,122,58,.22)', transitionDuration: saveFlash ? '0ms' : '350ms' }} />

      {/* Toast */}
      <div className={cn(
        'fixed top-5 left-1/2 -translate-x-1/2 z-50 px-8 py-4 rounded-2xl border-[3px] text-xl font-black flex items-center gap-3 transition-opacity duration-150',
        toastVis ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        style={{ background: 'var(--panel)', borderColor: toastType === 'ok' ? 'var(--grn)' : 'var(--red)', color: toastType === 'ok' ? 'var(--grn)' : 'var(--red)' }}>
        {toastType === 'ok' ? '✓' : '⚠'} {toastMsg}
      </div>

      {/* ── NAGŁÓWEK ── */}
      <header className="flex-shrink-0 h-[68px] flex items-center gap-6 px-6 border-b-[3px]"
        style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
        <div className="font-black text-2xl tracking-tight">ROZBIÓR</div>
        <div className="text-[13px] font-black uppercase tracking-[.2em]" style={{ color: 'var(--mut)' }}>
          {session.sessionDate}
        </div>
        <div className="flex items-baseline gap-2 pl-6 border-l-[3px]" style={{ borderColor: 'var(--bd)' }}>
          <span className="text-[12px] font-black uppercase tracking-[.16em]" style={{ color: 'var(--mut)' }}>Magazyn</span>
          <span className="font-mono text-xl font-black tabular-nums">{fmtKg(totalKgMagazyn, 0)} kg</span>
        </div>
        <div className="flex items-baseline gap-2 pl-6 border-l-[3px]" style={{ borderColor: 'var(--bd)' }}>
          <span className="text-[12px] font-black uppercase tracking-[.16em]" style={{ color: 'var(--mut)' }}>Dziś</span>
          <span className="font-mono text-xl font-black tabular-nums">{fmtKg(dayTotals.meat, 0)} kg mięsa</span>
          <span className="font-mono text-xl font-black tabular-nums" style={{ color: 'var(--grn)' }}>
            {dayTotals.taken > 0 ? fmtPct(dayTotals.yieldPct, 0) : '—'}
          </span>
        </div>
        <div className="flex-1" />
        <button type="button" onClick={() => setEntriesModal(true)}
          className="h-12 px-5 rounded-xl border-[3px] flex items-center gap-2 text-base font-black"
          style={{ borderColor: 'var(--bd)', color: 'var(--ink)', background: 'var(--key)' }}>
          <ListChecks size={20} /> Wpisy ({entries.length})
        </button>
        <button type="button" onClick={() => setShiftModal(true)}
          className="h-12 px-5 rounded-xl border-[3px] flex items-center gap-2 text-base font-black"
          style={{ borderColor: 'var(--bd)', color: 'var(--mut)', background: 'var(--key)' }}>
          <LogOut size={20} /> Koniec dnia
        </button>
        <Clock />
      </header>

      {/* ── TRZON: partie | środek | numpad ── */}
      <div className="flex-1 min-h-0 flex gap-4 p-4">

        {/* Lewa szyna — PARTIE (duże kafle, FEFO) */}
        <aside className="w-[360px] flex-shrink-0 flex flex-col min-h-0">
          <SectionLabel no={1} done={!!selBatch}>Partia</SectionLabel>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pr-1">
            {batches.map((b, i) => (
              <V8BatchTile key={b.id} batch={b} first={i === 0}
                selected={selBatch?.id === b.id} onSelect={pickBatch} />
            ))}
            {batches.length === 0 && (
              <div className="rounded-2xl border-[3px] border-dashed p-8 text-center text-lg font-bold"
                style={{ borderColor: 'var(--bd)', color: 'var(--mut)' }}>
                Brak partii na magazynie
              </div>
            )}
          </div>
          <button type="button" onClick={() => setFinishModal(true)}
            className="mt-3 h-16 rounded-2xl border-[3px] flex items-center justify-center gap-3 text-lg font-black flex-shrink-0"
            style={{ borderColor: 'var(--amb)', color: 'var(--amb)', background: '#FBF3E2' }}>
            <Flag size={22} /> Zakończ partię — kości / grzbiety
          </button>
        </aside>

        {/* Środek — pracownicy (małe chipy) + wagi + uzysk */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <SectionLabel no={2} done={!!selWorker}>Pracownik</SectionLabel>
          <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0 max-h-[124px] overflow-y-auto">
            {workers.map(w => (
              <V8WorkerChip key={w.id} worker={w} selected={selWorker?.id === w.id}
                entryCount={entryCountByWorkerId.get(w.id) ?? 0} onSelect={pickWorker} />
            ))}
            {workers.length === 0 && (
              <span className="text-base font-bold" style={{ color: 'var(--mut)' }}>Brak pracowników rozbioru</span>
            )}
          </div>

          <SectionLabel no={3} done={taken > 0 && meat > 0 && !meatTooBig}>Waga</SectionLabel>
          <div className="flex gap-4 flex-1 min-h-0">
            <V8Readout
              label={takenMode === 'poj' ? 'Zabrano · pojemniki' : 'Zabrano z partii'}
              value={kgTaken}
              unit={takenMode === 'poj' ? 'poj' : 'kg'}
              active={active === 'taken'}
              onActivate={() => setActive('taken')}
              sub={takenMode === 'poj' && takenRaw > 0 ? `= ${fmtKg(taken, 0)} kg (${KG_PER_CONTAINER} kg/poj.)` : selBatch ? `partia ${selBatch.internalBatchNo}` : ''}
              extraHeader={
                <span className="flex rounded-lg overflow-hidden border-2" style={{ borderColor: 'var(--bd)' }}>
                  {(['kg', 'poj'] as const).map(m => (
                    <span key={m} role="button" onClick={e => { e.stopPropagation(); switchTakenMode(m) }}
                      className="px-3 py-1 text-[13px] font-black uppercase cursor-pointer"
                      style={takenMode === m
                        ? { background: 'var(--ink)', color: '#fff' }
                        : { background: 'var(--key)', color: 'var(--mut)' }}>
                      {m}
                    </span>
                  ))}
                </span>
              }
            />
            <V8Readout
              label="Mięso po rozbiorze"
              value={kgMeat}
              unit="kg"
              active={active === 'meat'}
              error={meatTooBig}
              onActivate={() => setActive('meat')}
              sub={meatTooBig ? `Mięso nie może przekraczać ${fmtKg(taken, 0)} kg zabranych!` : ''}
            />
          </div>

          {/* Uzysk — żywy wskaźnik */}
          <div className="mt-4 rounded-2xl border-[3px] px-6 py-4 flex items-center gap-6 flex-shrink-0"
            style={{ background: 'var(--panel)', borderColor: meatTooBig ? 'var(--red)' : 'var(--bd)' }}>
            <span className="text-[14px] font-black uppercase tracking-[.18em] flex-shrink-0" style={{ color: 'var(--mut)' }}>
              Uzysk
            </span>
            <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: 'var(--app)' }}>
              <div className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${Math.min(100, yieldPct)}%`,
                  background: meatTooBig ? 'var(--red)' : yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : yieldPct > 0 ? 'var(--red)' : 'transparent',
                }} />
            </div>
            <span className="font-mono font-black tabular-nums text-5xl flex-shrink-0 w-[180px] text-right"
              style={{ color: meatTooBig ? 'var(--red)' : yieldPct >= 75 ? 'var(--grn)' : yieldPct >= 60 ? 'var(--amb)' : yieldPct > 0 ? 'var(--red)' : 'var(--bd)' }}>
              {meatTooBig ? '!!!' : yieldPct > 0 ? fmtPct(yieldPct, 1) : '— %'}
            </span>
          </div>
        </main>

        {/* Prawa szyna — numpad + ZAPISZ */}
        <aside className="w-[400px] flex-shrink-0 flex flex-col gap-3 min-h-0">
          <V8Numpad onKey={pressKey} onBackStart={handleBackStart} onBackEnd={handleBackEnd} />
          <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
            className="h-[120px] rounded-3xl flex flex-col items-center justify-center gap-1 select-none active:translate-y-[3px] transition-transform flex-shrink-0"
            style={canSave
              ? { background: 'var(--grn)', color: '#fff', boxShadow: '0 7px 0 #0E5226' }
              : meatTooBig
                ? { background: '#F4E8E6', color: 'var(--red)', border: '3px solid var(--red)' }
                : { background: 'var(--key)', color: 'var(--mut)', border: '3px solid var(--bd)' }}>
            <span className="flex items-center gap-3 text-3xl font-black tracking-wide">
              {addLoading
                ? <span className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                : canSave ? <Save size={32} /> : null}
              {saveHint}
            </span>
            {canSave && (
              <span className="text-base font-bold opacity-90">
                {selWorker?.name.split(' ')[0]} · partia {selBatch?.internalBatchNo} · {fmtKg(meat, 1)} kg · {fmtPct(yieldPct, 1)}
              </span>
            )}
          </button>
        </aside>
      </div>

      {/* ── MODAL: wpisy dnia ── */}
      {entriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={VARS}>
          <div className="w-[860px] max-h-[82vh] rounded-3xl border-[3px] flex flex-col overflow-hidden"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
            <div className="flex items-center px-7 py-5 border-b-[3px]" style={{ borderColor: 'var(--bd)' }}>
              <BarChart3 size={26} className="mr-3" />
              <h3 className="text-3xl font-black flex-1">Wpisy dnia ({entries.length})</h3>
              <button type="button" onClick={() => setEntriesModal(false)}
                className="w-14 h-14 rounded-2xl border-[3px] flex items-center justify-center"
                style={{ borderColor: 'var(--bd)' }}><X size={26} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              {entries.length === 0 && (
                <div className="px-6 py-14 text-center text-xl font-bold" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              )}
              {entries.map(e => {
                const yc = e.yieldPct >= 75 ? 'var(--grn)' : e.yieldPct >= 60 ? 'var(--amb)' : 'var(--red)'
                return (
                  <div key={e.id} className="grid grid-cols-[120px_1fr_120px_220px_110px] items-center px-7 py-4 border-t-2"
                    style={{ borderColor: 'var(--bd)' }}>
                    <span className="font-mono text-lg font-bold" style={{ color: 'var(--mut)' }}>
                      {new Date(e.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-xl font-black truncate">{e.workerName}</span>
                    <span className="font-mono text-xl font-black tabular-nums">{e.rawBatchNo}</span>
                    <span className="text-right font-mono text-xl font-bold tabular-nums">
                      {fmtKg(e.kgTaken, 1)} → {fmtKg(e.kgMeat, 1)} kg
                    </span>
                    <span className="text-right font-mono text-2xl font-black tabular-nums" style={{ color: yc }}>
                      {fmtPct(e.yieldPct, 1)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: zakończ partię (kości / grzbiety) ── */}
      {finishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={VARS}>
          <div className="w-[620px] rounded-3xl border-[3px] p-8 flex flex-col gap-6"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
            <div className="flex items-center">
              <Flag size={28} className="mr-3" style={{ color: 'var(--amb)' }} />
              <h3 className="text-3xl font-black flex-1">Zakończ partię</h3>
              <button type="button" onClick={() => setFinishModal(false)}
                className="w-14 h-14 rounded-2xl border-[3px] flex items-center justify-center"
                style={{ borderColor: 'var(--bd)' }}><X size={26} /></button>
            </div>
            <p className="text-lg font-semibold" style={{ color: 'var(--mut)' }}>
              Łączna waga kości i grzbietów zostanie rozdzielona proporcjonalnie na
              {' '}{pendingFinalize.length} wpisów ({fmtKg(finalizeTotalTaken, 0)} kg zabranych).
            </p>
            {([['Grzbiety [kg]', inputBacks, setInputBacks], ['Kości [kg]', inputBones, setInputBones]] as const).map(([label, val, set]) => (
              <label key={label} className="flex flex-col gap-2">
                <span className="text-[14px] font-black uppercase tracking-[.16em]" style={{ color: 'var(--mut)' }}>{label}</span>
                <input inputMode="decimal" value={val}
                  onChange={e => set(e.target.value.replace(/[^\d.]/g, ''))}
                  className="h-20 rounded-2xl border-[3px] px-6 font-mono text-5xl font-black tabular-nums outline-none"
                  style={{ borderColor: 'var(--bd)', background: 'var(--key)', color: 'var(--ink)' }} />
              </label>
            ))}
            <button type="button" onClick={handleFinishBatchConfirm}
              className="h-20 rounded-2xl text-2xl font-black"
              style={{ background: 'var(--amb)', color: '#fff', boxShadow: '0 6px 0 #7d5407' }}>
              Zatwierdź i zakończ
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: koniec dnia ── */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={VARS}>
          <div className="w-[560px] rounded-3xl border-[3px] p-8 flex flex-col gap-6"
            style={{ background: 'var(--panel)', borderColor: 'var(--bd)' }}>
            <h3 className="text-3xl font-black">Zakończyć dzień rozbioru?</h3>
            <p className="text-lg font-semibold" style={{ color: 'var(--mut)' }}>
              Wpisów: {entries.length} · zabrano {fmtKg(dayTotals.taken, 0)} kg · mięso {fmtKg(dayTotals.meat, 0)} kg.
              Po zamknięciu dane czekają na zatwierdzenie biura.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)}
                className="flex-1 h-18 py-5 rounded-2xl border-[3px] text-xl font-black"
                style={{ borderColor: 'var(--bd)', color: 'var(--ink)' }}>
                Wróć
              </button>
              <button type="button" onClick={handleCloseShift} disabled={closeLoading}
                className="flex-1 h-18 py-5 rounded-2xl text-xl font-black"
                style={{ background: 'var(--red)', color: '#fff', boxShadow: '0 5px 0 #7c1a11' }}>
                {closeLoading ? 'Zamykam…' : 'Tak, zakończ dzień'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
