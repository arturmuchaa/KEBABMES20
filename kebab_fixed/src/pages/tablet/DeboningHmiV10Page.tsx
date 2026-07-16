/**
 * DeboningHmiV10Page — HMI v10.
 *
 * Biały motyw z jednym akcentem (indygo), w duchu HMI v5 „Clinical Light" i v7
 * „Precision Light" — nie temat/metafora, tylko czysty, jasny, przyjazny UI z
 * jednym mocnym kolorem selekcji. Szkielet 3-kolumnowy (pracownicy | wpis ①②③ |
 * sterownia) i logika sesji/wpisów/alarmów przeniesione 1:1 z poprzedniej
 * iteracji — zmieniła się wyłącznie warstwa wizualna
 * (docs/superpowers/specs/2026-07-03-rozbior-hmi-v10-design.md, rewizja po
 * odrzuceniu tematu „Rzemiosło").
 */
import { useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, usersApi, settingsApi, byproductsApi, type BatchByproducts } from '@/lib/apiClient'
import { Spinner } from '@/components/ui/widgets'
import { fmtKg, fmtPct, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Play, Lock, Save, Flag, LogOut, Delete, X, BarChart3, Bell, BellOff, ListOrdered, Check, Scale, Minus, Plus, Undo2, Clock, Wifi, WifiOff } from 'lucide-react'
import { BASE } from '@/lib/api'
import type { RawBatch, User } from '@/types'
import type { DeboningEntry } from '@/features/deboning/types'
import { useProductionSession, useDeboningEntries } from '@/features/deboning/hooks'
import { splitEntriesByStatus, entryTime } from '@/features/deboning/utils'
import { useScale } from '@/features/deboning/useScale'
import {
  computeWeighing, sanitizeCartTares, CART_TARES_KG, E2_TARE_KG, KG_PER_E2_MIN, KG_PER_E2_MAX,
} from '@/features/deboning/utils/weighing'
import { useAuth } from '@/features/auth/AuthContext'
import { useServiceHold, ServiceMenuModal } from '@/features/deboning/ServiceMenu'
import { ByproductsWizard } from '@/features/deboning/ByproductsWizard'
import './DeboningHmiV10Page.css'

// Wstrzyknięte przez Vite (vite.config.ts) z tauri.rozbior-v10.conf.json —
// widoczne na ekranie, żeby dało się na oko zweryfikować że cichy auto-update
// faktycznie podmienił wersję.
declare const __ROZBIOR_V10_VERSION__: string

const KG_PER_CONTAINER = 15
// Wariant prowadzony (v11): domyślna liczba pojemników E2 po starcie i po zapisie.
const GUIDED_DEFAULT_E2 = 5
const YIELD_BAND_LO = 65   // % — dolna granica pasma celu
const YIELD_BAND_HI = 80   // % — górna granica pasma celu
const TEMPO_TARGET  = 800  // kg/h — cel linii

type ActiveField = 'taken' | 'meat'
type StatsSort = 'taken' | 'meat' | 'yield' | 'count'

/** Paleta — biel + jeden akcent indygo. Kontrast zweryfikowany WCAG. */
const VARS: CSSProperties = {
  ['--bg' as string]:         '#E7EAEE',
  ['--panel' as string]:      '#FFFFFF',
  ['--ink' as string]:        '#0F172A',
  ['--mut' as string]:        '#5B6472',
  ['--line' as string]:       '#D8DEE6',
  ['--lineSoft' as string]:   '#E2E5EA',
  ['--accent' as string]:     '#4F46E5',
  ['--accentSoft' as string]: '#EEF2FF',
  ['--barBg' as string]:      '#D3DBF7',
  ['--success' as string]:    '#16A34A',
  ['--amb' as string]:        '#B45309',
  ['--ambSoft' as string]:    '#FFFBF3',
  ['--ambLine' as string]:    '#F3D9AE',
  ['--red' as string]:        '#DC2626',
  ['--redSoft' as string]:    '#FEF2F2',
  ['--redLine' as string]:    '#F6C6C6',
}

// Progi wydajności (decyzja operatora 2026-07-07): >=66% dobra/super (zielona),
// 65% „w miarę" (bursztyn), poniżej 65% słaba (czerwona).
function yieldInk(pct: number): string {
  if (pct <= 0) return 'var(--mut)'
  if (pct < 65) return 'var(--red)'
  if (pct < 66) return 'var(--amb)'
  return 'var(--success)'
}

// ─── Zegar (izolowany) ──────────────────────────────────────────────
const TopClock = memo(function TopClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <span className="hmi-v10-mono text-xl font-bold" style={{ color: 'var(--ink)' }}>
      {t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
})

// ─── Pierścień postępu (czysty, bez tarczy/kresek) ──────────────────
const CircleGauge = memo(function CircleGauge({ value, min, max, color }: {
  value: number; min: number; max: number; color: string
}) {
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return (
    <svg viewBox="0 0 80 80" width={64} height={64}>
      <circle cx={40} cy={40} r={32} fill="none" stroke="var(--lineSoft)" strokeWidth={9} />
      <circle cx={40} cy={40} r={32} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
        pathLength={100} strokeDasharray={100} strokeDashoffset={100 - frac * 100}
        transform="rotate(-90 40 40)" style={{ transition: 'stroke-dashoffset .3s ease' }} />
    </svg>
  )
})

// ─── Krok ①②③ ────────────────────────────────────────────────────────
function StepDot({ no, done }: { no: number; done: boolean }) {
  return (
    <span className="hmi-v10-mono w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
      style={done
        ? { background: 'var(--accent)', color: '#fff' }
        : { border: '1.5px solid var(--line)', color: 'var(--mut)' }}>
      {done ? <Check size={13} strokeWidth={3} /> : no}
    </span>
  )
}
function SectionStep({ no, done, children }: { no: number; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <StepDot no={no} done={done} />
      <span className="text-[12px] font-semibold uppercase truncate" style={{ color: done ? 'var(--ink)' : 'var(--mut)', letterSpacing: '.04em' }}>
        {children}
      </span>
    </div>
  )
}

// ─── Kafel partii ──────────────────────────────────────────────────
const BatchTileV10 = memo(function BatchTileV10({ batch, selected, onSelect, onLongPress, pendingMeatKg }: {
  batch: RawBatch; selected: boolean; onSelect: (b: RawBatch) => void
  onLongPress?: (b: RawBatch) => void
  /** Suma kg otwartych pobrań — kafel pokazuje „czeka na mięso" i nie znika. */
  pendingMeatKg?: number
}) {
  const { daysLeft } = getExpiryStatus(batch.expiryDate)
  const kg = Number(batch.kgAvailable)
  const expired = daysLeft < 0
  const daysColor = selected ? 'rgba(255,255,255,.85)' : (expired || daysLeft === 0 ? 'var(--red)' : daysLeft <= 3 ? 'var(--amb)' : 'var(--mut)')
  // Przytrzymanie (0,6 s) = ważenie kości/grzbietów w trakcie rozbioru;
  // krótkie dotknięcie = wybór partii (jak dotychczas).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longRef = useRef(false)
  const down = () => {
    if (!onLongPress) return
    longRef.current = false
    timerRef.current = setTimeout(() => { longRef.current = true; onLongPress(batch) }, 600)
  }
  const up = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
  return (
    <button type="button" onClick={() => { if (!longRef.current) onSelect(batch) }} disabled={expired}
      onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      className={cn('flex flex-col justify-between text-left h-full flex-shrink-0 select-none transition-all', expired && 'opacity-50')}
      style={{
        width: 244, padding: '14px 18px', borderRadius: 12,
        background: selected ? 'var(--accent)' : 'var(--panel)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
        color: selected ? '#fff' : 'var(--ink)',
      }}>
      <div className="flex items-start justify-between gap-2">
        <span className="hmi-v10-mono font-bold text-2xl leading-none">{batch.internalBatchNo}</span>
      </div>
      <div className="flex items-center justify-between mt-2 leading-none">
        <span className="hmi-v10-mono text-lg font-bold leading-none">{fmtKg(kg, 0)} kg</span>
        <span className="text-[13px] font-bold uppercase leading-none" style={{ color: daysColor }}>
          {expired ? 'przeterm.' : daysLeft === 0 ? 'dziś!' : `${daysLeft} dni`}
        </span>
      </div>
      {pendingMeatKg != null && pendingMeatKg > 0 ? (
        <div className="text-[12px] font-bold uppercase truncate mt-1.5 block"
          style={{ color: selected ? 'rgba(255,255,255,.9)' : 'var(--amb)', lineHeight: 1.3 }}>
          ⏳ czeka na mięso · {fmtKg(pendingMeatKg, 0)} kg
        </div>
      ) : (
        <div className="text-[13px] font-medium truncate mt-1.5 block" style={{ color: selected ? 'rgba(255,255,255,.75)' : 'var(--mut)', lineHeight: 1.3 }}>
          {batch.supplierDisplayName ?? batch.supplierName ?? '—'} · {Math.floor(kg / KG_PER_CONTAINER)} poj.
        </div>
      )}
    </button>
  )
})

// ─── Kafel partii OCZEKUJĄCEJ na ważenie ubocznych (szary) ──────────
const PendingBatchTile = memo(function PendingBatchTile({ rec, onOpen }: {
  rec: BatchByproducts; onOpen: () => void
}) {
  const need: string[] = []
  if (!rec.backsDone) need.push('grzbiety')
  if (!rec.bonesDone) need.push('kości')
  // Obie frakcje coś mają, ale bilans masy się nie domyka (połowa zważona
  // w trakcie rozbioru) — kafel mówi wprost, ile kg ubocznych brakuje.
  if (need.length === 0 && !rec.balanced) need.push(`resztę (~${fmtKg(rec.missingKg ?? 0, 0)} kg)`)
  // Bilans domknięty: dzisiejsza partia NIE znika samoczynnie — zielony
  // kafel „zważona ✓", klik pozwala poprawić/doważyć.
  if (rec.balanced) {
    return (
      <button type="button" onClick={onOpen}
        className="flex flex-col justify-between text-left h-full flex-shrink-0 select-none"
        style={{ width: 244, padding: '14px 18px', borderRadius: 12, background: '#F0FDF4', border: '1px dashed #86EFAC', color: 'var(--mut)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="hmi-v10-mono font-bold text-2xl leading-none" style={{ color: 'var(--ink)' }}>{rec.rawBatchNo}</span>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5" style={{ borderRadius: 6, background: '#DCFCE7', color: '#15803D', border: '1px solid #86EFAC', letterSpacing: '.06em' }}>zważona ✓</span>
        </div>
        <div className="text-[13px] font-bold uppercase mt-1" style={{ color: '#15803D', letterSpacing: '.03em' }}>
          grzbiety {fmtKg(rec.backsKg ?? 0, 0)} · kości {fmtKg(rec.bonesKg ?? 0, 0)} kg
        </div>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--mut)' }}>
          dotknij, aby poprawić / doważyć
        </div>
      </button>
    )
  }
  return (
    <button type="button" onClick={onOpen}
      className="flex flex-col justify-between text-left h-full flex-shrink-0 select-none"
      style={{ width: 244, padding: '14px 18px', borderRadius: 12, background: '#EEF0F3', border: '1px dashed var(--mut)', color: 'var(--mut)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="hmi-v10-mono font-bold text-2xl leading-none" style={{ color: 'var(--ink)' }}>{rec.rawBatchNo}</span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5" style={{ borderRadius: 6, background: 'var(--ambSoft)', color: 'var(--amb)', border: '1px solid var(--ambLine)', letterSpacing: '.06em' }}>zakończona</span>
      </div>
      <div className="text-[13px] font-bold uppercase mt-1" style={{ color: 'var(--amb)', letterSpacing: '.03em' }}>
        Doważyć: {need.join(' + ')}
      </div>
      <div className="text-[12px] font-semibold" style={{ color: 'var(--mut)' }}>
        dotknij, aby zważyć · ćwiartka {fmtKg(rec.quarterKg, 0)} kg
      </div>
    </button>
  )
})

// ─── Kafel pracownika ──────────────────────────────────────────────
const WorkerTileV10 = memo(function WorkerTileV10({ worker, selected, entryCount, kgToday, pendingKg, pendingBatchNo, blocked, onSelect, onLongPress }: {
  worker: User; selected: boolean; entryCount: number; kgToday: number
  /** Otwarte pobranie ćwiartki (kg) — kafel pokazuje „czeka na zważenie",
   *  a klik od razu wraca do domknięcia mięsem. */
  pendingKg?: number
  /** Numer partii otwartego pobrania — mięso wraca pod TĘ partię. */
  pendingBatchNo?: string
  /** Wybrana jest INNA partia niż pobranie — kafel przygaszony (klik = toast). */
  blocked?: boolean
  onSelect: (w: User) => void; onLongPress: (w: User) => void
}) {
  const initials = worker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  // Przytrzymanie (0,5 s) = szczegóły/edycja pracownika; krótkie dotknięcie = wybór.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longRef = useRef(false)
  const down = () => { longRef.current = false; timerRef.current = setTimeout(() => { longRef.current = true; onLongPress(worker) }, 500) }
  const up = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
  return (
    <button type="button"
      onClick={() => { if (!longRef.current) onSelect(worker) }}
      onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      className="relative flex flex-col items-center justify-center gap-1 select-none active:scale-[0.98] transition-all px-2"
      style={{
        borderRadius: 10, aspectRatio: '1',
        background: selected ? 'var(--accent)' : 'var(--panel)',
        border: `1px solid ${blocked ? 'var(--ambLine)' : selected ? 'var(--accent)' : 'var(--line)'}`,
        color: selected ? '#fff' : 'var(--ink)',
        opacity: blocked ? 0.55 : 1,
      }}>
      <span className="font-extrabold text-3xl leading-none">{initials}</span>
      <span className="text-sm font-semibold leading-tight text-center truncate w-full">{worker.name}</span>
      {pendingKg != null ? (
        <span className="text-[10px] font-bold uppercase text-center leading-tight px-1 py-0.5 w-full"
          style={{ borderRadius: 6, background: selected ? 'rgba(255,255,255,.2)' : 'var(--ambSoft)', color: selected ? '#fff' : 'var(--amb)', letterSpacing: '.02em' }}>
          ⏳ {pendingBatchNo ? `${pendingBatchNo} · ` : 'czeka '}{fmtKg(pendingKg, 1)} kg
        </span>
      ) : kgToday > 0 && (
        <span className="hmi-v10-mono text-[11px] font-bold" style={{ color: selected ? 'rgba(255,255,255,.75)' : 'var(--mut)' }}>{fmtKg(kgToday, 0)} kg</span>
      )}
      {entryCount > 0 && (
        <span className="hmi-v10-mono absolute top-2 right-2 min-w-[22px] h-6 px-1.5 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: selected ? 'rgba(255,255,255,.25)' : 'var(--accentSoft)', color: selected ? '#fff' : 'var(--accent)' }}>
          {entryCount}
        </span>
      )}
    </button>
  )
})

// ─── Pole odczytu ────────────────────────────────────────────────────
function ReadoutV10({ label, value, unit, active, error, sub, onActivate, extraHeader }: {
  label: string; value: string; unit: string; active: boolean; error?: boolean
  sub?: string; onActivate: () => void; extraHeader?: React.ReactNode
}) {
  return (
    <button type="button" onClick={onActivate}
      className="flex-1 text-left transition-all flex flex-col justify-between min-w-0"
      style={{
        borderRadius: 10, padding: '12px 14px', background: 'var(--panel)',
        border: `1.5px solid ${error ? 'var(--red)' : active ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: active && !error ? '0 0 0 3px var(--accentSoft)' : undefined,
      }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: '.1em', color: error ? 'var(--red)' : active ? 'var(--accent)' : 'var(--mut)' }}>
          {label}
        </span>
        {extraHeader}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="hmi-v10-mono font-bold leading-none" style={{ fontSize: 'clamp(34px, 3vw, 44px)', color: error ? 'var(--red)' : 'var(--ink)' }}>
          {value || '0'}
        </span>
        <span className="text-base font-bold" style={{ color: 'var(--mut)' }}>{unit}</span>
      </div>
      <div className="text-[11px] font-semibold truncate" style={{ color: error ? 'var(--red)' : 'var(--mut)', minHeight: 14 }}>{sub || ''}</div>
    </button>
  )
}

// ─── Numpad ────────────────────────────────────────────────────────
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const
const NumpadV10 = memo(function NumpadV10({ onKey, onBackStart, onBackEnd, onServiceStart, onServiceEnd, disabled }: {
  onKey: (k: string) => void; onBackStart: () => void; onBackEnd: () => void
  onServiceStart: () => void; onServiceEnd: () => void; disabled: boolean
}) {
  // Uwaga: przy disabled numpad jest tylko wyszarzony (bez pointer-events-none),
  // żeby przytrzymanie "." nadal otwierało menu serwisowe — same klawisze
  // ignorują wtedy onKey.
  return (
    <div className={cn('grid grid-cols-3 gap-2 flex-1 min-h-0', disabled && 'opacity-40')}>
      {KEYS.map(k => (
        <button key={k} type="button" onClick={() => { if (!disabled) onKey(k) }}
          onPointerDown={k === '⌫' ? (disabled ? undefined : onBackStart) : k === '.' ? onServiceStart : undefined}
          onPointerUp={k === '⌫' ? onBackEnd : k === '.' ? onServiceEnd : undefined}
          onPointerLeave={k === '⌫' ? onBackEnd : k === '.' ? onServiceEnd : undefined}
          onPointerCancel={k === '⌫' ? onBackEnd : k === '.' ? onServiceEnd : undefined}
          className={cn('hmi-v10-mono flex items-center justify-center font-bold select-none transition-colors',
            !disabled && 'active:bg-[var(--ink)] active:text-white active:border-[var(--ink)]')}
          style={{
            borderRadius: 11, fontSize: 'clamp(24px,2.5vw,34px)', minHeight: 50,
            background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)',
          }}>
          {k === '⌫' ? <Delete size={28} /> : k}
        </button>
      ))}
    </div>
  )
})

// ─── Łączność z serwerem ────────────────────────────────────────────
// Ping /api/health co 10 s + zdarzenia online/offline przeglądarki.
// Bez tego utrata internetu wyglądała jak „brak sesji" i HMI mylnie
// pokazywało ekran „Rozpocznij dzień".
function useServerOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    let alive = true
    const ping = async () => {
      try {
        const r = await fetch(`${BASE}/health`, { cache: 'no-store' })
        if (alive) setOnline(r.ok)
      } catch {
        if (alive) setOnline(false)
      }
    }
    ping()
    const t = setInterval(ping, 10_000)
    const on = () => { void ping() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      alive = false; clearInterval(t)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

interface HmiAlarm { id: string; level: 'red' | 'amb'; text: string }

export function DeboningHmiV10Page({ allowOperatorSwitch = false, guided = false, buildLabel = `HMI v10 · ${__ROZBIOR_V10_VERSION__}` }: { allowOperatorSwitch?: boolean; guided?: boolean; buildLabel?: string }) {
  // useAuth() zwraca `null`, gdy komponent renderuje się bez <AuthProvider> w drzewie —
  // nie destrukturyzować bezpośrednio. `allowOperatorSwitch` włącza przycisk zmiany
  // operatora (wylogowanie do ekranu PIN) — ustawia go tylko kiosk (rozbior-v10.tsx),
  // żeby w biurowej aplikacji ten sam przycisk nie wylogowywał z całego MES.
  const auth = useAuth()
  const online = useServerOnline()
  const loggedInUser = auth?.user
  // limit 500: domyślne 25 (rosnąco po numerze!) ucinałoby NAJNOWSZE partie
  const batchData  = useApi(() => rawBatchesApi.list({ limit: 500 }))
  const workerData = useApi(() => usersApi.list())
  // Partie oczekujące na ważenie ubocznych (grzbiety/kości) — szare kafle,
  // przechodzą między dniami. Odświeżane co 5 s razem z partiami (useEffect niżej).
  const byproductsData = useApi(() => byproductsApi.pending())
  // Zbiorczo zważone grzbiety/kości z dzisiaj — pasek dolny (kreator zapisuje
  // je NA PARTIĘ, nie per wpis, więc suma wpisów ich nie widzi).
  const byprodToday = useApi(() => byproductsApi.today())
  const { session, timeWindow, loading: sessionLoading, startDay, startLoading, closeDay, closeLoading } = useProductionSession()
  const { entries, addEntry, addTake, completeTake, editTake, editEntry, removeEntry, lastCreated, addLoading, addTakeLoading, completeTakeLoading, removeLoading } = useDeboningEntries(session?.id ?? null)

  // Rozdział: pobrania czekające na mięso (pending) vs domknięte wpisy (complete).
  // Agregaty, statystyki i lista „ostatnie” liczą tylko complete; pending mają
  // osobną sekcję kafelków „Czeka na zważenie”.
  const { pending: pendingTakes, complete: completeEntries } = useMemo(
    () => splitEntriesByStatus(entries),
    [entries],
  )

  const [selBatch,  setSelBatch]  = useState<RawBatch | null>(null)
  const [selWorker, setSelWorker] = useState<User | null>(null)
  const [kgTaken,   setKgTaken]   = useState('')
  const [kgMeat,    setKgMeat]    = useState('')
  const [active,    setActive]    = useState<ActiveField>('taken')
  const [takenMode, setTakenMode] = useState<'kg' | 'poj'>('kg')
  const scale = useScale()
  // Mięso przyjeżdża na 1–3 wózkach, czasem RÓŻNYCH (np. 5,5 + 6,5):
  // każdy kafel ma własny licznik (klik: 1→2→3→odznaczony), tara = suma.
  const [cartCounts, setCartCounts] = useState<Record<string, number>>({})
  const [noCart, setNoCart] = useState(false)
  const cartTareTotal = useMemo(() => {
    if (noCart) return 0
    const entries = Object.entries(cartCounts)
    if (entries.length === 0) return null
    return entries.reduce((a, [w, c]) => a + Number(w) * c, 0)
  }, [cartCounts, noCart])
  const pickCartTare = useCallback((w: number) => {
    if (w === 0) { setNoCart(true); setCartCounts({}); return }
    setNoCart(false)
    setCartCounts(prev => {
      const key = String(w)
      const next = ((prev[key] ?? 0) + 1) % 4
      const copy = { ...prev }
      if (next === 0) delete copy[key]
      else copy[key] = next
      return copy
    })
  }, [])
  // v11: domyślnie 5 pojemników (typowo tyle), operator koryguje +/-. v10: 0 (jak było).
  const [e2Count,  setE2Count]  = useState(guided ? GUIDED_DEFAULT_E2 : 0)
  // false = mięso z wagi (auto); true = operator przejął ręcznie (awaryjnie)
  const [meatManual, setMeatManual] = useState(false)
  // Szczegóły/edycja pracownika (przytrzymanie kafla).
  const [workerDetail, setWorkerDetail] = useState<User | null>(null)
  const [editEntryId, setEditEntryId] = useState<string | null>(null)
  const [editTaken, setEditTaken] = useState('')
  const [editMeat,  setEditMeat]  = useState('')
  // Domykane pobranie (kliknięty kafelek „czeka na zważenie”). Gdy != null,
  // ćwiartka/partia/pracownik są zablokowane, aktywne jest tylko pole mięsa.
  const [resumeId, setResumeId] = useState<string | null>(null)

  // Tary wózków: lista z biura (edytowalna w Ustawieniach firmy); cache w
  // localStorage na wypadek braku sieci przy starcie, fallback = stała lista.
  const cartTaresData = useApi(() => settingsApi.getCartTares())
  const cartTares = useMemo(() => {
    const fromApi = sanitizeCartTares(cartTaresData.data)
    if (fromApi.length) {
      try { localStorage.setItem('kebab.rozbior.cartTares', JSON.stringify(fromApi)) } catch { /* pełny storage nie może psuć HMI */ }
      return fromApi
    }
    try {
      const cached = sanitizeCartTares(JSON.parse(localStorage.getItem('kebab.rozbior.cartTares') ?? 'null'))
      if (cached.length) return cached
    } catch { /* uszkodzony cache → fallback */ }
    return [...CART_TARES_KG]
  }, [cartTaresData.data])
  const [saveFlash, setSaveFlash] = useState(false)
  const [finishModal, setFinishModal] = useState(false)
  const [shiftModal,  setShiftModal]  = useState(false)
  const [statsModal,  setStatsModal]  = useState(false)
  const [operatorModal, setOperatorModal] = useState(false)
  // Ważenie ubocznych: prompt po zakończeniu partii + otwarty kreator.
  const [finishPrompt, setFinishPrompt] = useState<{ batch: RawBatch; record: BatchByproducts } | null>(null)
  const [wizard, setWizard] = useState<{ batch: RawBatch; record: BatchByproducts } | null>(null)
  const byproductsByBatch = useMemo(() => {
    const m = new Map<string, BatchByproducts>()
    for (const p of byproductsData.data ?? []) m.set(p.rawBatchId, p)
    return m
  }, [byproductsData.data])
  const [statsSort,   setStatsSort]   = useState<StatsSort>('meat')
  const [statsDir,    setStatsDir]    = useState<'asc' | 'desc'>('desc')
  const [inputBacks, setInputBacks] = useState('')
  const [inputBones, setInputBones] = useState('')
  const [toastMsg,  setToastMsg]  = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [toastVis,  setToastVis]  = useState(false)
  // Okno „Cofnij ostatni wpis": 60 s od zapisu; countdown tyka co sekundę.
  const [undoUntil, setUndoUntil] = useState(0)
  const [undoNow,   setUndoNow]   = useState(() => Date.now())
  useEffect(() => {
    if (undoUntil <= Date.now()) return
    const t = setInterval(() => setUndoNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [undoUntil])
  const undoSecondsLeft = Math.max(0, Math.ceil((undoUntil - undoNow) / 1000))
  const canUndo = undoSecondsLeft > 0 && !!lastCreated

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Menu serwisowe ── przytrzymanie "." (lub tytułu ekranów bez numpada)
  const [serviceModal, setServiceModal] = useState(false)
  const openServiceModal = useCallback(() => setServiceModal(true), [])
  const { holdProps: serviceHoldProps, onHoldStart: handleServiceStart, onHoldEnd: handleServiceEnd, firedAtRef: serviceFiredAtRef } = useServiceHold(openServiceModal)

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

  // Auto-odświeżanie partii i pracowników co 5s — żeby nowa partia dodana
  // z biura pojawiła się na hali bez ręcznego odświeżania. Ciche: useApi ma
  // wbudowane porównanie głębokie (shallowEqualByJson), więc gdy dane się nie
  // zmieniły, nie ma re-renderu — zero migania. batchData.refetch/workerData.
  // refetch mają stabilną referencję (useCallback z pustymi deps w useApi).
  useEffect(() => {
    const t = setInterval(() => {
      batchData.refetch()
      workerData.refetch()
      byproductsData.refetch()
      byprodToday.refetch()
    }, 5000)
    return () => clearInterval(t)
  }, [batchData.refetch, workerData.refetch, byproductsData.refetch, byprodToday.refetch])

  // Suma kg otwartych pobrań per partia — partia z pobraniami czekającymi na
  // wagę MUSI zostać aktywnym kaflem, nawet gdy kg_available spadło do zera
  // (prod 2026-07-10: wszyscy pobrali z 408, system „przeskoczył" na 409).
  const pendingKgByBatch = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of pendingTakes) {
      const bid = (e as any).rawBatchId
      if (!bid) continue
      m.set(bid, (m.get(bid) ?? 0) + Number((e as any).kgTaken || 0))
    }
    return m
  }, [pendingTakes])

  const allActiveBatches = useMemo(() =>
    (batchData.data?.data ?? [])
      .filter(b => (Number(b.kgAvailable) > 0 || pendingKgByBatch.has(b.id))
        && b.status !== 'used' && b.status !== 'expired' && b.status !== 'cancelled')
      .sort((a, b) => a.expiryDate !== b.expiryDate ? (a.expiryDate < b.expiryDate ? -1 : 1) : (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)),
    [batchData.data, pendingKgByBatch])
  // Pasek partii przewija się w poziomie — limit tylko awaryjny (12, nie 6):
  // przy 7+ aktywnych partiach siódma „znikała" mimo miejsca na scroll.
  const batches = useMemo(() => allActiveBatches.slice(0, 12), [allActiveBatches])

  // Świeży stan WYBRANEJ partii po każdym odświeżeniu listy. Bez tego
  // selBatch był snapshotem z momentu kliknięcia kafla — przy kilku wpisach
  // pod rząd „pozostało" liczyło się ze starych kg i auto-zakończenie partii
  // nie odpalało (partia znikała bez kafla ubocznych — klasa błędu 407).
  useEffect(() => {
    const list = (batchData.data?.data ?? []) as RawBatch[]
    setSelBatch(prev => {
      if (!prev) return prev
      const fresh = list.find(b => b.id === prev.id)
      return fresh && Number(fresh.kgAvailable) !== Number(prev.kgAvailable) ? fresh : prev
    })
  }, [batchData.data])
  const totalKgMagazyn = useMemo(() => allActiveBatches.reduce((s, b) => s + Number(b.kgAvailable), 0), [allActiveBatches])

  const workers = useMemo(() =>
    (workerData.data ?? []).filter(u => u.role === 'WORKER_DEBONING'),
    [workerData.data])

  const perWorker = useMemo(() => {
    const m = new Map<string, { name: string; taken: number; meat: number; count: number; lastAt: number }>()
    for (const e of completeEntries) {
      const cur = m.get(e.workerId) ?? { name: e.workerName, taken: 0, meat: 0, count: 0, lastAt: 0 }
      cur.taken += e.kgTaken; cur.meat += e.kgMeat; cur.count += 1
      cur.lastAt = Math.max(cur.lastAt, new Date(entryTime(e)).getTime())
      m.set(e.workerId, cur)
    }
    return m
  }, [completeEntries])

  const shift = useMemo(() => {
    const totTaken = completeEntries.reduce((s, e) => s + e.kgTaken, 0)
    const totMeat  = completeEntries.reduce((s, e) => s + e.kgMeat, 0)
    const totBacks = completeEntries.reduce((s, e) => s + (e.kgBacks ?? 0), 0)
    const totBones = completeEntries.reduce((s, e) => s + (e.kgBones ?? 0), 0)
    const yieldPct = totTaken > 0 ? (totMeat / totTaken) * 100 : 0
    const hours = session ? Math.max(0.25, (Date.now() - new Date(session.startedAt).getTime()) / 3_600_000) : 0
    const tempo = hours > 0 ? totTaken / hours : 0
    const now = Date.now()
    const activeWorkers = Array.from(perWorker.values()).filter(w => now - w.lastAt < 3_600_000).length
    const prognoza = timeWindow.minutesToClose != null && timeWindow.minutesToClose > 0
      ? totTaken + tempo * (timeWindow.minutesToClose / 60)
      : null
    return { totTaken, totMeat, totBacks, totBones, yieldPct, tempo, activeWorkers, prognoza }
  }, [completeEntries, session, perWorker, timeWindow.minutesToClose])

  const alarms = useMemo<HmiAlarm[]>(() => {
    const out: HmiAlarm[] = []
    for (const b of allActiveBatches) {
      const { daysLeft } = getExpiryStatus(b.expiryDate)
      if (daysLeft < 0) out.push({ id: `exp-${b.id}`, level: 'red', text: `Partia ${b.internalBatchNo} przeterminowana — blokada HACCP` })
      else if (daysLeft === 0) out.push({ id: `fefo0-${b.id}`, level: 'red', text: `Partia ${b.internalBatchNo} — termin upływa DZIŚ` })
      else if (daysLeft <= 3) out.push({ id: `fefo-${b.id}`, level: 'amb', text: `Partia ${b.internalBatchNo} — termin za ${daysLeft} dni` })
    }
    const last3 = completeEntries.slice(-3)
    if (last3.length === 3) {
      const avg = last3.reduce((s, e) => s + e.yieldPct, 0) / 3
      if (avg < 60) out.push({ id: 'low-yield', level: 'amb', text: `Niska wydajność ostatnich wpisów (śr. ${fmtPct(avg, 1)})` })
    }
    if (timeWindow.minutesToClose != null && timeWindow.minutesToClose > 0 && timeWindow.minutesToClose <= 30)
      out.push({ id: 'window', level: 'amb', text: `Okno zapisu zamyka się za ${timeWindow.minutesToClose} min` })
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))
  }, [allActiveBatches, completeEntries, timeWindow.minutesToClose])

  const workerStats = useMemo(() => {
    const rows = Array.from(perWorker.values())
      .map(s => ({ ...s, yieldPct: s.taken > 0 ? (s.meat / s.taken) * 100 : 0 }))
    const key = statsSort === 'taken' ? 'taken' : statsSort === 'meat' ? 'meat' : statsSort === 'count' ? 'count' : 'yieldPct'
    return rows.sort((a, b) => statsDir === 'asc' ? (a as any)[key] - (b as any)[key] : (b as any)[key] - (a as any)[key])
  }, [perWorker, statsSort, statsDir])

  const toggleStatsSort = useCallback((key: StatsSort) => {
    setStatsSort(prev => {
      if (prev === key) { setStatsDir(d => d === 'asc' ? 'desc' : 'asc'); return prev }
      setStatsDir('desc'); return key
    })
  }, [])

  const pendingFinalize = completeEntries.filter(e => (e.kgBacks ?? 0) === 0 && (e.kgBones ?? 0) === 0)
  const finalizeTotalTaken = pendingFinalize.reduce((s, e) => s + e.kgTaken, 0)

  const takenRaw = parseFloat(kgTaken) || 0
  const taken = takenMode === 'poj' ? takenRaw * KG_PER_CONTAINER : takenRaw

  const weighing = useMemo(
    () => computeWeighing({ gross: scale.gross, cartTareKg: cartTareTotal, e2Count }),
    [scale.gross, cartTareTotal, e2Count],
  )
  const autoMode = scale.available && !meatManual
  const autoNet  = autoMode && scale.connected && scale.stable ? weighing.netKg : 0

  const meat = autoMode ? autoNet : (parseFloat(kgMeat) || 0)
  const meatTooBig = taken > 0 && meat > taken
  const yieldPct = taken > 0 && meat > 0 && !meatTooBig ? (meat / taken) * 100 : 0
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && !meatTooBig
    && (!autoMode || (scale.stable && weighing.ready))
  // Pobranie (mięso później): wystarczy partia + pracownik + ćwiartka; waga nieistotna.
  const canSaveTake = !resumeId && !!selBatch && !!selWorker && taken > 0

  const saveHint = !selBatch ? 'WYBIERZ PARTIĘ'
    : !selWorker ? 'WYBIERZ PRACOWNIKA'
    : autoMode && cartTareTotal == null ? 'WYBIERZ WÓZEK'
    : autoMode && e2Count <= 0 ? 'DODAJ POJEMNIKI E2'
    : autoMode && !scale.connected ? 'WAGA NIEPODŁĄCZONA'
    : autoMode && weighing.netKg <= 0 ? 'WJEDŹ NA WAGĘ'
    : autoMode && !scale.stable ? 'CZEKAM NA STABILNĄ WAGĘ…'
    : taken <= 0 ? 'PODAJ WAGĘ ZABRANĄ'
    : meat <= 0 ? 'PODAJ WAGĘ MIĘSA'
    : meatTooBig ? 'MIĘSO > ZABRANE!'
    : autoMode ? `ZAPISZ — ${fmtKg(meat, 1)} KG MIĘSA` : 'ZAPISZ WPIS'

  // ── Tryb prowadzony (wariant „wzmocnione prowadzenie") ──
  // Który krok cyklu jest teraz aktywny — steruje wielkim banerem u góry
  // kolumny wpisu. Dane pozostają widoczne; zmienia się tylko prowadzenie.
  const totalSteps = 5
  const stepNo = !selBatch ? 1 : !selWorker ? 2 : taken <= 0 ? 3 : !canSave ? 4 : 5
  const guideTitle = !selBatch ? 'Wybierz partię'
    : !selWorker ? 'Wybierz pracownika'
    : taken <= 0 ? 'Podaj ilość pobranej ćwiartki'
    : canSave ? (autoMode ? `Gotowe — zapisz ${fmtKg(meat, 1)} kg mięsa` : 'Gotowe — zapisz wpis')
    : meatTooBig ? 'Mięso większe niż zabrane — popraw!'
    : autoMode && cartTareTotal == null ? 'Wybierz wózek'
    : autoMode && e2Count <= 0 ? 'Dodaj pojemniki E2'
    : autoMode && !scale.connected ? 'Waga niepodłączona'
    : autoMode && weighing.netKg <= 0 ? 'Wjedź wózkiem na wagę'
    : autoMode && !scale.stable ? 'Czekaj na stabilną wagę…'
    : 'Podaj wagę mięsa'
  const guideHref = !selBatch ? 'wybór na górnym pasku'
    : !selWorker ? 'kafle po lewej'
    : taken <= 0 ? 'klawiatura poniżej'
    : canSave ? 'duży przycisk na dole'
    : meatTooBig ? 'popraw wagę'
    : autoMode ? 'panel wagi po prawej'
    : 'klawiatura poniżej'
  const guideReady = canSave

  const pressKey = useCallback((k: string) => {
    // Zwolnienie "." po długim przytrzymaniu (menu serwisowe) generuje jeszcze
    // click — nie może dopisać kropki do pola wagi.
    if (k === '.' && Date.now() - serviceFiredAtRef.current < 500) return
    // W trybie auto numpad pisze do mięsa tylko po świadomym przejęciu ręcznym.
    if (active === 'meat' && scale.available && !meatManual) setMeatManual(true)
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
  }, [active, scale.available, meatManual])

  const clearActiveField = useCallback(() => {
    if (active === 'taken') setKgTaken(''); else setKgMeat('')
  }, [active])
  const handleBackStart = useCallback(() => { longPressRef.current = setTimeout(clearActiveField, 600) }, [clearActiveField])
  const handleBackEnd = useCallback(() => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }, [])

  const switchTakenMode = useCallback((mode: 'kg' | 'poj') => {
    setTakenMode(mode); setKgTaken(''); setActive('taken')
  }, [])
  const pickBatch = useCallback((b: RawBatch) => {
    // W trybie domykania pobrania klik w partię = wyjście z trybu (pomyłka
    // operatora nie może blokować ekranu — pobranie zostaje na kafelku).
    if (resumeId) {
      setResumeId(null)
      setMeatManual(false)
    }
    setSelBatch(b); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [resumeId])
  // Otwarte pobrania per pracownik — info „czeka na zważenie" siedzi na
  // KAFELKU pracownika (decyzja z hali 2026-07-09), nie w osobnej sekcji.
  const pendingByWorker = useMemo(() => {
    // Najstarsze otwarte pobranie per pracownik + SUMA kg + PARTIE pobrań
    // (system musi pamiętać, z której partii wydano ćwiartkę — mięso wraca
    // na wagę pod TĘ partię, nie pod aktualnie wybraną).
    const m = new Map<string, { entry: DeboningEntry; totalKg: number; batchIds: Set<string>; batchNos: string[] }>()
    for (const e of pendingTakes) {
      const wid = (e as any).workerId
      if (!wid) continue
      const bid = (e as any).rawBatchId as string
      const bno = String((e as any).rawBatchNo ?? '')
      const cur = m.get(wid)
      if (cur) {
        cur.totalKg += Number((e as any).kgTaken || 0)
        if (bid) cur.batchIds.add(bid)
        if (bno && !cur.batchNos.includes(bno)) cur.batchNos.push(bno)
      } else {
        m.set(wid, {
          entry: e, totalKg: Number((e as any).kgTaken || 0),
          batchIds: new Set(bid ? [bid] : []), batchNos: bno ? [bno] : [],
        })
      }
    }
    return m
  }, [pendingTakes])

  // Edycja otwartego pobrania — przytrzymanie kafelka pracownika z „⏳ czeka".
  const [takeEdit, setTakeEdit] = useState<{ entry: DeboningEntry; value: string } | null>(null)

  // Klik w kafelek pracownika z otwartym pobraniem: wraca do formularza z
  // wpisaną, zablokowaną ćwiartką; operator tylko wjeżdża na wagę i zapisuje.
  const resumeTake = useCallback((e: DeboningEntry) => {
    // Partia pobrania mogła się już WYCZERPAĆ (0 kg = poza listą aktywnych) —
    // domknięcie mięsem musi działać mimo to (prod 2026-07-09, Anatoli/407):
    // szukamy w PEŁNEJ liście partii, nie tylko aktywnych.
    const all = (batchData.data?.data ?? []) as RawBatch[]
    // Fallback: partii może już nie być na liście (np. usunięta w biurze) —
    // pseudo-partia z danych pobrania, żeby dało się DOMKNĄĆ ważenie
    // (bez tego numpad zostawał zablokowany: „WYBIERZ PARTIĘ").
    const b = all.find(x => x.id === e.rawBatchId)
      ?? ({ id: e.rawBatchId, internalBatchNo: e.rawBatchNo, kgAvailable: 0, expiryDate: '' } as unknown as RawBatch)
    setSelBatch(b)
    const w = workers.find(x => x.id === e.workerId) ?? null
    if (w) setSelWorker(w)
    setResumeId(e.id)
    setTakenMode('kg')
    setKgTaken(String(e.kgTaken))
    setKgMeat('')
    setMeatManual(false)
    setActive('meat')
  }, [batchData.data, workers])

  const cancelResume = useCallback(() => {
    setResumeId(null)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
  }, [])

  const pickWorker = useCallback((w: User) => {
    // Pomyłka nie może blokować ekranu: klik w innego pracownika wychodzi
    // z trybu domykania (pobranie zostaje na kafelku) i wybiera normalnie;
    // pracownik z otwartym pobraniem wchodzi w domknięcie mięsem.
    const pending = pendingByWorker.get(w.id)
    if (pending) {
      // Mięso wraca pod partię POBRANIA. Przy wybranej INNEJ partii pracownik
      // jest zablokowany — operator nie może omyłkowo zważyć mięsa z 408 pod
      // 409 (prod 2026-07-10). Bez wybranej partii lub przy zgodnej: domknięcie.
      if (selBatch && !pending.batchIds.has(selBatch.id)) {
        showToast(`${w.name} czeka z mięsem z partii ${pending.batchNos.join(', ')} — wybierz partię ${pending.batchNos[0]}, żeby zważyć`, 'err')
        return
      }
      const entryForBatch = selBatch
        ? (pendingTakes.find(p => (p as any).workerId === w.id && (p as any).rawBatchId === selBatch.id) as DeboningEntry | undefined)
        : undefined
      resumeTake(entryForBatch ?? pending.entry)
      return
    }
    if (resumeId) { setResumeId(null); setMeatManual(false) }
    setSelWorker(w); setKgTaken(''); setKgMeat(''); setActive('taken')
  }, [resumeId, pendingByWorker, resumeTake, selBatch, pendingTakes, showToast])

  async function handleStartDay() {
    const err = await startDay()
    if (err) showToast(err, 'err'); else showToast('Dzień produkcyjny rozpoczęty')
  }

  async function handleSave() {
    if (addLoading || !canSave || !selBatch || !selWorker || !session) return
    const err = await addEntry(
      {
        sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id,
        kgTaken: taken, kgMeat: meat,
        ...(scale.available ? {
          weighMode: autoMode ? 'auto' as const : 'manual' as const,
          ...(autoMode ? {
            kgGross: scale.gross,
            tareCartKg: cartTareTotal ?? undefined,
            tareE2Kg: weighing.tareE2Kg,
            e2Count,
          } : {}),
        } : {}),
      },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 350)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    if (guided) {
      // Tryb prowadzony (v11): po zapisie zostaje TYLKO partia, cała reszta się
      // restartuje. Pracownik — bo świadomie wybieramy, kto robił każdą sztukę.
      // Wózek — bo każdy pracownik ma inny (trzeba wskazać na nowo). Pojemniki
      // wracają do typowych 5 szt (operator koryguje +/-). Cykl startuje od
      // kroku „Wybierz pracownika".
      setSelWorker(null)
      setCartCounts({})
      setNoCart(false)
      setE2Count(GUIDED_DEFAULT_E2)
    } else {
      // v10 (produkcja): wózek i e2Count celowo zostają — kolejny wózek zwykle
      // taki sam, ten sam pracownik robi wiele sztuk pod rząd.
    }
    setUndoUntil(Date.now() + 60_000); setUndoNow(Date.now())
    showToast(`Zapisano: ${fmtKg(meat)} kg mięsa`)

    // Automatyczne zakończenie partii: gdy ta sztuka wyczerpała ćwiartkę
    // (zostało mniej niż na kolejną sztukę), sam pokazuj komunikat o ważeniu
    // ubocznych — bez klikania „Zakończ partię".
    const remaining = Number(selBatch.kgAvailable) - taken
    if (remaining <= 0.5 && !byproductsByBatch.has(selBatch.id)
        && !pendingTakes.some(p => (p as any).rawBatchId === selBatch.id)) {
      const b = selBatch
      setSelBatch(null) // partia wyczerpana — operator wybierze następną
      byproductsApi.finish(b.id, loggedInUser?.name)
        .then(rec => { byproductsData.refetch(); setFinishPrompt({ batch: b, record: rec }) })
        // Backend i tak sam zakańcza wyczerpaną partię (gwarancja serwerowa) —
        // tu tylko informacja, że prompt ważenia nie wyskoczył.
        .catch(() => showToast(`Partia ${b.internalBatchNo} wyczerpana — zważ uboczne z szarego kafla`, 'err'))
    }
  }

  // Zapis samego pobrania ćwiartki (mięso zważy się później).
  async function handleSaveTake() {
    if (addTakeLoading || !selBatch || !selWorker || taken <= 0 || !session) return
    const err = await addTake(
      { sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id, kgTaken: taken },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate,
    )
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    showToast(`Pobrano ${fmtKg(taken, 1)} kg — czeka na zważenie`)
    // Pobranie NIE zakańcza partii, nawet gdy wyczerpało kg — mięso dopiero
    // przyjdzie na wagę. Zakończenie odpala się przy domknięciu OSTATNIEGO
    // pobrania (handleCompleteTake + gwarancja serwerowa).
  }

  // Domknięcie pobrania zważonym mięsem.
  async function handleCompleteTake() {
    if (completeTakeLoading || !resumeId || meat <= 0 || meatTooBig || !session) return
    const err = await completeTake(resumeId, {
      kgMeat: meat,
      ...(scale.available ? {
        weighMode: autoMode ? 'auto' as const : 'manual' as const,
        ...(autoMode ? {
          kgGross: scale.gross,
          tareCartKg: cartTareTotal ?? undefined,
          tareE2Kg: weighing.tareE2Kg,
          e2Count,
        } : {}),
      } : {}),
    }, session)
    if (err) { showToast(err, 'err'); return }
    batchData.refetch()
    setSaveFlash(true)
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveFlash(false), 350)
    const completedId = resumeId
    setResumeId(null)
    setKgTaken(''); setKgMeat(''); setActive('taken'); setMeatManual(false)
    showToast(`Zważono ${fmtKg(meat, 1)} kg mięsa`)

    // Domknięcie OSTATNIEGO pobrania wyczerpanej partii = koniec rozbioru →
    // prompt ważenia ubocznych. Backend i tak sam zakańcza (gwarancja) —
    // tu tylko wygodny prompt dla operatora.
    const b = selBatch
    const others = pendingTakes.filter(p => (p as any).rawBatchId === b?.id && p.id !== completedId)
    if (b && others.length === 0 && Number(b.kgAvailable) <= 0.5 && !byproductsByBatch.has(b.id)) {
      setSelBatch(null)
      byproductsApi.finish(b.id, loggedInUser?.name)
        .then(rec => { byproductsData.refetch(); setFinishPrompt({ batch: b, record: rec }) })
        .catch(() => {})
    }
  }

  async function handleUndo() {
    if (!canUndo || removeLoading || !lastCreated) return
    const err = await removeEntry(lastCreated.id, session)
    if (err) { showToast(err, 'err'); return }
    setUndoUntil(0)
    batchData.refetch()
    showToast(`Cofnięto wpis — ${fmtKg(lastCreated.kgMeat, 1)} kg wróciło do partii`)
  }

  // Zakończenie partii → utworzenie rekordu ubocznych + prompt (teraz/później).
  async function handleFinishBatch() {
    if (!selBatch) { showToast('Najpierw wybierz partię do zakończenia', 'err'); return }
    try {
      const rec = await byproductsApi.finish(selBatch.id, loggedInUser?.name)
      byproductsData.refetch()
      setFinishPrompt({ batch: selBatch, record: rec })
    } catch (e: any) {
      showToast(e?.message || 'Nie udało się zakończyć partii', 'err')
    }
  }

  // Otwórz kreator ważenia dla partii (z promptu albo z szarego kafla).
  async function openWizard(batch: RawBatch) {
    const rec = byproductsByBatch.get(batch.id) ?? await byproductsApi.finish(batch.id, loggedInUser?.name).catch(() => null)
    if (!rec) { showToast('Nie udało się otworzyć ważenia', 'err'); return }
    setFinishPrompt(null)
    setWizard({ batch, record: rec })
  }

  // Ważenie kości/grzbietów W TRAKCIE rozbioru — przytrzymanie kafelka partii.
  // ensure NIE oznacza partii jako zakończonej; kolejne ważenia doładowują
  // palety do sumy, a % przelicza się przy zakończeniu partii.
  async function openWizardInProgress(batch: RawBatch) {
    const rec = await byproductsApi.ensure(batch.id, loggedInUser?.name).catch(() => null)
    if (!rec) { showToast('Nie udało się otworzyć ważenia', 'err'); return }
    setWizard({ batch, record: rec })
  }

  function startEditEntry(e: DeboningEntry) {
    setEditEntryId(e.id)
    setEditTaken(String(e.kgTaken))
    setEditMeat(String(e.kgMeat))
  }
  async function saveEditEntry() {
    if (!editEntryId || !session) return
    const kt = parseFloat(editTaken.replace(',', '.')) || 0
    const km = parseFloat(editMeat.replace(',', '.')) || 0
    if (kt <= 0 || km <= 0) { showToast('Ćwiartka i mięso muszą być > 0', 'err'); return }
    if (km > kt) { showToast('Mięso nie może przekraczać ćwiartki', 'err'); return }
    const err = await editEntry(editEntryId, { kgTaken: kt, kgMeat: km }, session)
    if (err) { showToast(err, 'err'); return } // backend blokuje np. gdy mięso poszło dalej
    setEditEntryId(null); batchData.refetch()
    showToast('Wpis zaktualizowany')
  }

  async function handleWizardWeigh(kind: 'backs' | 'bones', kg: number, pallets: any[]) {
    if (!wizard) return
    try {
      const rec = await byproductsApi.weigh(wizard.batch.id, kind, kg, pallets)
      setWizard(w => (w ? { ...w, record: rec } : null))
      byproductsData.refetch()
      byprodToday.refetch()
      showToast(`Zapisano ${kind === 'backs' ? 'grzbiety' : 'kości'}: ${fmtKg(kg, 1)} kg`)
    } catch (e: any) {
      // Bez tego wizard wisiał na „saving" bez żadnego komunikatu.
      showToast(e?.message || `Nie udało się zapisać (${kind === 'backs' ? 'grzbiety' : 'kości'})`, 'err')
      throw e // wizard cofa fazę, paleta/suma zostaje — operator ponawia
    }
  }

  async function handleFinishBatchConfirm() {
    if (!session) return
    if (pendingFinalize.length === 0) { showToast('Brak wpisów do zakończenia', 'err'); return }
    const kbTotal = parseFloat(inputBacks) || 0
    const knTotal = parseFloat(inputBones) || 0
    if (kbTotal <= 0 && knTotal <= 0) { showToast('Wpisz kości lub grzbiety > 0', 'err'); return }
    const sumTaken = finalizeTotalTaken || 1
    // Rozdziel łączne grzbiety/kości na wpisy wg udziału ćwiartki (per-wpis =
    // raport kosztów + pasek zmiany) ORAZ zsumuj per partia surowca, bo żywy
    // magazyn ubocznych (kafle, pasek „dziś", strona ubocznych, loty, WZ)
    // czyta batch_byproducts — bez tego ręcznie wpisane grzbiety „nie wchodzą
    // do systemu" i nie da się z nich zrobić WZ.
    const perBatch = new Map<string, { kb: number; kn: number }>()
    let rb = 0, rn = 0
    for (let i = 0; i < pendingFinalize.length; i++) {
      const e = pendingFinalize[i]
      const isLast = i === pendingFinalize.length - 1
      const share = e.kgTaken / sumTaken
      const kb = isLast ? Math.round((kbTotal - rb) * 100) / 100 : Math.round(kbTotal * share * 100) / 100
      const kn = isLast ? Math.round((knTotal - rn) * 100) / 100 : Math.round(knTotal * share * 100) / 100
      rb += kb; rn += kn
      await editEntry(e.id, { kgBacks: kb, kgBones: kn }, session)
      const acc = perBatch.get(e.rawBatchId) ?? { kb: 0, kn: 0 }
      acc.kb += kb; acc.kn += kn
      perBatch.set(e.rawBatchId, acc)
    }
    // Zaksięguj zbiorczo do batch_byproducts per partia (ensure NIE finalizuje
    // partii — finished_at zostaje NULL, więc auto-zakończenie działa dalej).
    // weigh NADPISUJE frakcję w całości, więc doliczamy wpisane kg do palet
    // już zważonych (ensure zwraca rekord) — inaczej ręczne zakończenie
    // kasowało wcześniejsze ważenia partii razem z ich podziałem na dni.
    // Błąd tu nie blokuje finalizacji wpisów — tylko ostrzega.
    const r2 = (n: number) => Math.round(n * 100) / 100
    const mk = (kg: number) => ({ tareLabel: 'ręcznie', tareKg: 0, containers: 0, gross: kg, net: kg })
    const sumNet = (ps?: { net: number }[]) => (ps ?? []).reduce((s, p) => s + (p.net || 0), 0)
    let byprodErr = false
    for (const [rawBatchId, { kb, kn }] of perBatch) {
      if (kb <= 0 && kn <= 0) continue
      try {
        const rec = await byproductsApi.ensure(rawBatchId, loggedInUser?.name)
        if (kb > 0) {
          const prev = rec?.backsPallets ?? []
          await byproductsApi.weigh(rawBatchId, 'backs', r2(sumNet(prev) + kb), [...prev, mk(r2(kb))])
        }
        if (kn > 0) {
          const prev = rec?.bonesPallets ?? []
          await byproductsApi.weigh(rawBatchId, 'bones', r2(sumNet(prev) + kn), [...prev, mk(r2(kn))])
        }
      } catch { byprodErr = true }
    }
    byproductsData.refetch()
    byprodToday.refetch()
    setFinishModal(false)
    setInputBacks(''); setInputBones('')
    showToast(byprodErr
      ? `Zakończono ${pendingFinalize.length} wpisów — uboczne zapisano częściowo (sprawdź magazyn)`
      : `Zakończono ${pendingFinalize.length} wpisów`, byprodErr ? 'err' : undefined)
  }

  async function handleCloseShift() {
    const err = await closeDay()
    if (err) showToast(err, 'err')
    else { setShiftModal(false); showToast('Zmiana zakończona') }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="h-full w-full overflow-hidden flex flex-col" style={{ ...VARS, background: 'var(--bg)', color: 'var(--ink)', fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif' }}>
      {children}
      <ServiceMenuModal open={serviceModal} onClose={() => setServiceModal(false)} buildLabel={buildLabel} />

      {/* Prompt po zakończeniu partii — zważyć uboczne teraz czy później. */}
      {finishPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[440px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center flex-shrink-0" style={{ borderRadius: 12, background: 'var(--successSoft)', border: '1px solid var(--successLine)', color: 'var(--success)' }}><Check size={26} /></div>
              <div>
                <h3 className="font-extrabold text-xl">Partia {finishPrompt.batch.internalBatchNo} zakończona</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>Zważyć teraz grzbiety i kości, czy później?</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={() => openWizard(finishPrompt.batch)}
                className="h-14 text-base font-bold flex items-center justify-center gap-3" style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
                <Scale size={20} /> Zważ teraz
              </button>
              <button type="button" onClick={() => { setFinishPrompt(null); byproductsData.refetch() }}
                className="h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
                Później (kafel zostanie szary)
              </button>
              <button type="button" onClick={() => { setFinishPrompt(null); setFinishModal(true) }}
                className="h-10 text-sm font-bold" style={{ borderRadius: 10, color: 'var(--mut)' }}>
                Wpisz ręcznie (awaryjnie)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kreator ważenia zbiorczego grzbietów i kości. */}
      {wizard && (
        <ByproductsWizard batch={wizard.batch} record={wizard.record} scale={scale}
          onWeigh={handleWizardWeigh}
          onClose={() => { setWizard(null); byproductsData.refetch() }} />
      )}

      {/* Szczegóły pracownika (przytrzymanie kafla): wpisy dnia + statystyki + edycja. */}
      {/* ── Edycja otwartego pobrania (przytrzymanie kafelka pracownika) ── */}
      {takeEdit && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40" style={VARS}>
          <div className="w-[400px] p-6 flex flex-col gap-4" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div>
              <div className="font-extrabold text-xl leading-tight">Pobranie — {takeEdit.entry.workerName}</div>
              <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--mut)' }}>
                Partia {takeEdit.entry.rawBatchNo} · czeka na zważenie mięsa
              </div>
            </div>
            <div className="flex items-baseline gap-2 justify-center py-1">
              <span className="hmi-v10-mono font-extrabold" style={{ fontSize: 52 }}>{takeEdit.value || '0'}</span>
              <span className="text-2xl font-bold" style={{ color: 'var(--mut)' }}>kg</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => (
                <button key={k} type="button"
                  onClick={() => setTakeEdit(te => te && ({ ...te, value:
                    k === '⌫' ? te.value.slice(0, -1)
                    : k === '.' ? (te.value.includes('.') ? te.value : (te.value === '' ? '0.' : te.value + '.'))
                    : (te.value + k).replace(/^0+(?=\d)/, '').slice(0, 6) }))}
                  className="hmi-v10-mono h-14 flex items-center justify-center text-2xl font-bold"
                  style={{ borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--line)' }}>
                  {k === '⌫' ? <Delete size={22} /> : k}
                </button>
              ))}
            </div>
            <button type="button"
              disabled={!(parseFloat((takeEdit.value || '0').replace(',', '.')) > 0)}
              onClick={async () => {
                const kg = parseFloat((takeEdit.value || '0').replace(',', '.')) || 0
                const err = await editTake(takeEdit.entry.id, kg, session)
                if (err) { showToast(err, 'err'); return }
                batchData.refetch()
                setTakeEdit(null)
                showToast(`Pobranie poprawione: ${fmtKg(kg, 1)} kg`)
              }}
              className="h-14 text-lg font-extrabold flex items-center justify-center gap-2"
              style={{ borderRadius: 12, background: 'var(--accent)', color: '#fff' }}>
              <Check size={22} /> Zapisz pobranie
            </button>
            <div className="flex gap-2">
              <button type="button"
                onClick={async () => {
                  const err = await removeEntry(takeEdit.entry.id, session)
                  if (err) { showToast(err, 'err'); return }
                  batchData.refetch()
                  setTakeEdit(null)
                  showToast(`Pobranie usunięte — ${fmtKg(takeEdit.entry.kgTaken, 1)} kg wróciło do partii`)
                }}
                className="h-12 flex-1 text-sm font-bold uppercase"
                style={{ borderRadius: 10, background: 'var(--redSoft)', color: 'var(--red)', border: '1px solid var(--redLine)' }}>
                Usuń pobranie
              </button>
              <button type="button" onClick={() => setTakeEdit(null)}
                className="h-12 flex-1 text-sm font-bold uppercase"
                style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {workerDetail && (() => {
        const wEntries = completeEntries.filter(e => e.workerId === workerDetail.id).slice().reverse()
        const wt = wEntries.reduce((s, e) => s + e.kgTaken, 0)
        const wm = wEntries.reduce((s, e) => s + e.kgMeat, 0)
        const wy = wt > 0 ? (wm / wt) * 100 : 0
        // Otwarte pobranie pracownika — statystyki i zmiana pobrania w JEDNYM modalu
        // (wcześniej long-press przy pending otwierał od razu edycję i statystyk nie było).
        const pnd = pendingByWorker.get(workerDetail.id)
        return (
          <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/45" style={VARS}>
            <div className="w-[720px] max-w-[96vw] flex flex-col" style={{ maxHeight: '92vh', borderRadius: 16, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', boxShadow: '0 30px 80px -30px rgba(0,0,0,.5)' }}>
              <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                <span className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold" style={{ background: 'var(--accent)', color: '#fff' }}>
                  {workerDetail.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-xl leading-tight truncate">{workerDetail.name}</div>
                  <div className="hmi-v10-mono text-[12px] font-bold" style={{ color: 'var(--mut)' }}>
                    {wEntries.length} szt · ćwiartka {fmtKg(wt, 0)} kg · mięso {fmtKg(wm, 0)} kg · <span style={{ color: yieldInk(wy) }}>{fmtPct(wy, 1)}</span>
                  </div>
                </div>
                <button type="button" onClick={() => { setWorkerDetail(null); setEditEntryId(null) }} className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={18} /></button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
                {pnd && (
                  <div className="flex items-center gap-3 px-4 py-3" style={{ borderRadius: 12, background: 'var(--ambSoft)', border: '1.5px solid var(--ambLine)' }}>
                    <span className="text-2xl">⏳</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-extrabold" style={{ color: 'var(--amb)' }}>
                        Otwarte pobranie — czeka na zważenie mięsa
                      </div>
                      <div className="hmi-v10-mono text-[12px] font-bold" style={{ color: 'var(--mut)' }}>
                        {fmtKg(pnd.totalKg, 1)} kg ćwiartki · partia {pnd.batchNos.join(', ')}
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => { setTakeEdit({ entry: pnd.entry, value: String(pnd.entry.kgTaken) }); setWorkerDetail(null); setEditEntryId(null) }}
                      className="h-11 px-5 text-sm font-bold flex-shrink-0"
                      style={{ borderRadius: 10, background: 'var(--amb)', color: '#fff' }}>
                      Zmień pobranie
                    </button>
                  </div>
                )}
                {wEntries.length === 0 && !pnd && <div className="text-center py-8 text-sm font-semibold" style={{ color: 'var(--mut)' }}>Brak wpisów dziś</div>}
                {wEntries.map(e => editEntryId === e.id ? (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3" style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1.5px solid var(--accent)' }}>
                    <span className="hmi-v10-mono text-xs" style={{ color: 'var(--mut)' }}>{new Date(entryTime(e)).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                    <label className="flex flex-col"><span className="text-[9px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Ćwiartka</span>
                      <input type="number" inputMode="decimal" value={editTaken} onChange={ev => setEditTaken(ev.target.value)} className="hmi-v10-mono w-24 h-10 px-2 text-base font-bold" style={{ borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)' }} /></label>
                    <label className="flex flex-col"><span className="text-[9px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Mięso</span>
                      <input type="number" inputMode="decimal" value={editMeat} onChange={ev => setEditMeat(ev.target.value)} className="hmi-v10-mono w-24 h-10 px-2 text-base font-bold" style={{ borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)' }} /></label>
                    <div className="flex gap-2 ml-auto">
                      <button type="button" onClick={() => setEditEntryId(null)} className="h-10 px-4 text-sm font-bold" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}>Anuluj</button>
                      <button type="button" onClick={saveEditEntry} className="h-10 px-5 text-sm font-bold" style={{ borderRadius: 8, background: 'var(--accent)', color: '#fff' }}>Zapisz</button>
                    </div>
                  </div>
                ) : (
                  <div key={e.id} className="grid grid-cols-[52px_56px_1fr_1fr_52px_90px] items-center gap-3 px-4 py-3" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                    <span className="hmi-v10-mono text-xs" style={{ color: 'var(--mut)' }}>{new Date(entryTime(e)).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="hmi-v10-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.rawBatchNo}</span>
                    <span className="hmi-v10-mono text-sm text-right"><span className="text-[9px] uppercase mr-1" style={{ color: 'var(--mut)' }}>ćw</span>{fmtKg(e.kgTaken, 1)}</span>
                    <span className="hmi-v10-mono text-sm text-right"><span className="text-[9px] uppercase mr-1" style={{ color: 'var(--mut)' }}>mię</span>{fmtKg(e.kgMeat, 1)}</span>
                    <span className="hmi-v10-mono text-sm font-bold text-right" style={{ color: yieldInk(e.yieldPct) }}>{fmtPct(e.yieldPct, 1)}</span>
                    <button type="button" onClick={() => startEditEntry(e)} className="h-9 text-xs font-bold" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--accent)' }}>Edytuj</button>
                  </div>
                ))}
                {wEntries.length > 0 && (
                  <div className="grid grid-cols-[52px_56px_1fr_1fr_52px_90px] items-center gap-3 px-4 py-3" style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1.5px solid var(--accent)' }}>
                    <span className="text-[11px] font-extrabold uppercase col-span-2" style={{ color: 'var(--accent)', letterSpacing: '.08em' }}>Razem</span>
                    <span className="hmi-v10-mono text-sm font-extrabold text-right"><span className="text-[9px] uppercase mr-1 font-bold" style={{ color: 'var(--mut)' }}>ćw</span>{fmtKg(wt, 1)}</span>
                    <span className="hmi-v10-mono text-sm font-extrabold text-right"><span className="text-[9px] uppercase mr-1 font-bold" style={{ color: 'var(--mut)' }}>mię</span>{fmtKg(wm, 1)}</span>
                    <span className="hmi-v10-mono text-sm font-extrabold text-right" style={{ color: yieldInk(wy) }}>{fmtPct(wy, 1)}</span>
                    <span className="hmi-v10-mono text-[11px] font-bold text-right" style={{ color: 'var(--mut)' }}>{wEntries.length} szt</span>
                  </div>
                )}
              </div>
              <div className="px-4 py-3 flex-shrink-0 text-[11px] font-semibold" style={{ borderTop: '1px solid var(--line)', color: 'var(--mut)' }}>
                Edycja możliwa, dopóki mięso nie poszło dalej (np. na masowanie). Jeśli poszło — system zablokuje zmianę.
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )

  if (sessionLoading) return wrap(<div className="flex items-center justify-center flex-1"><Spinner size={48} /></div>)

  // Brak łączności bez potwierdzonej sesji = NIE pokazuj „Rozpocznij dzień"
  // (sesja może trwać, tylko serwer jest niedostępny) — czekaj na sieć.
  if (!online && !session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="w-28 h-28 flex items-center justify-center select-none" {...serviceHoldProps}
        style={{ borderRadius: 16, background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' }}>
        <WifiOff size={56} />
      </div>
      <h2 className="font-extrabold text-4xl">Brak połączenia</h2>
      <p className="text-xl max-w-lg text-center" style={{ color: 'var(--mut)' }}>
        Czekam na połączenie z serwerem… HMI wróci samo, gdy sieć wróci.
      </p>
      <Spinner size={32} />
    </div>
  )

  if (!session) return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-8">
      <div className="text-center select-none" {...serviceHoldProps}>
        <div className="hmi-v10-mono text-[13px] font-bold uppercase mb-3" style={{ color: 'var(--mut)', letterSpacing: '.3em' }}>
          Rozbiór · {timeWindow.productionDate}
        </div>
        <h2 className="font-extrabold text-5xl" style={{ letterSpacing: '-.01em' }}>Rozpocznij dzień</h2>
      </div>
      <button type="button" onClick={handleStartDay} disabled={startLoading}
        className="h-20 px-16 text-2xl font-bold flex items-center gap-4"
        style={{ borderRadius: 12, background: 'var(--accent)', color: '#fff', boxShadow: '0 10px 24px -10px rgba(79,70,229,.5)' }}>
        {startLoading ? <span className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={32} />}
        Rozpocznij dzień
      </button>
    </div>
  )

  if (session.status === 'closed' || session.status === 'approved') return wrap(
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="w-28 h-28 flex items-center justify-center select-none" {...serviceHoldProps}
        style={{ borderRadius: 16, background: 'var(--ambSoft)', border: `1px solid ${'var(--ambLine)'}`, color: 'var(--amb)' }}>
        <Lock size={56} />
      </div>
      <h2 className="font-extrabold text-4xl">{session.status === 'approved' ? 'Dzień zatwierdzony' : 'Sesja zamknięta'}</h2>
      <p className="text-xl max-w-lg text-center" style={{ color: 'var(--mut)' }}>
        {session.status === 'approved' ? `Dane z dnia ${session.sessionDate} są zablokowane.` : 'Sesja zamknięta. Oczekuje na zatwierdzenie biura.'}
      </p>
    </div>
  )

  const redCount = alarms.filter(a => a.level === 'red').length
  const recent = completeEntries.slice(-8).reverse()

  return wrap(
    <>
      <div className={cn('fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 text-base font-bold flex items-center gap-3 transition-opacity duration-150',
        toastVis ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        style={{ borderRadius: 10, background: 'var(--panel)', border: `1px solid ${toastType === 'ok' ? '#BBF0D3' : 'var(--redLine)'}`, color: toastType === 'ok' ? 'var(--success)' : 'var(--red)', boxShadow: '0 8px 24px -8px rgba(0,0,0,.15)' }}>
        {toastMsg}
      </div>

      <header className="flex-shrink-0 h-[76px] flex items-center gap-5 px-6" style={{ background: 'var(--barBg)', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="font-extrabold text-xl leading-none uppercase" style={{ letterSpacing: '-.01em' }}>Rozbiór</div>
          <div className="hmi-v10-mono text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>
            {session.sessionDate} · {buildLabel}
          </div>
        </div>
        {([
          { label: 'Magazyn',  val: `${fmtKg(totalKgMagazyn, 0)} kg` },
          { label: 'Partie',   val: String(allActiveBatches.length) },
          { label: 'Pracownik', val: selWorker?.name.split(' ')[0] ?? '—', color: selWorker ? 'var(--accent)' : 'var(--mut)' },
        ] as const).map(c => (
          <div key={c.label} className="flex flex-col justify-center pl-5 flex-shrink-0" style={{ borderLeft: '1px solid var(--lineSoft)' }}>
            <span className="text-[9px] font-bold uppercase leading-none mb-1" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>{c.label}</span>
            <span className="hmi-v10-mono text-sm font-bold truncate max-w-[140px] block" style={{ color: (c as any).color ?? 'var(--ink)', lineHeight: 1.3 }}>{c.val}</span>
          </div>
        ))}
        <span className="flex items-center gap-1.5 px-2.5 h-8 flex-shrink-0 text-[10px] font-bold uppercase"
          style={{ borderRadius: 8, letterSpacing: '.06em',
            background: online ? 'transparent' : 'var(--redSoft)',
            border: `1px solid ${online ? 'var(--lineSoft)' : 'var(--redLine)'}`,
            color: online ? 'var(--mut)' : 'var(--red)' }}
          title={online ? 'Połączono z serwerem' : 'Brak połączenia z serwerem'}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {online ? 'online' : 'BRAK SIECI'}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-2 px-3 h-9 text-sm font-bold flex-shrink-0"
          style={alarms.length === 0
            ? { color: 'var(--mut)', border: '1px solid var(--line)', borderRadius: 8 }
            : { color: redCount > 0 ? 'var(--red)' : 'var(--amb)', background: redCount > 0 ? 'var(--redSoft)' : 'var(--ambSoft)', border: `1px solid ${redCount > 0 ? 'var(--redLine)' : 'var(--ambLine)'}`, borderRadius: 8 }}>
          {alarms.length === 0 ? <BellOff size={16} /> : <Bell size={16} />}
          {alarms.length === 0 ? 'BRAK ALARMÓW' : `${alarms.length} ALARM${alarms.length === 1 ? '' : alarms.length < 5 ? 'Y' : 'ÓW'}`}
        </span>
        <TopClock />
        <button type="button" onClick={() => setShiftModal(true)}
          className="h-9 px-4 text-[13px] font-bold flex items-center gap-2 flex-shrink-0"
          style={{ border: '1px solid var(--line)', color: 'var(--mut)', borderRadius: 8, background: 'var(--panel)' }}>
          <LogOut size={15} /> Zakończ zmianę
        </button>
        <button type="button" onClick={handleFinishBatch}
          className="h-9 px-4 text-[13px] font-bold flex items-center gap-2 flex-shrink-0"
          style={{ border: '1px solid var(--ambLine)', color: 'var(--amb)', borderRadius: 8, background: 'var(--ambSoft)' }}>
          <Flag size={15} /> Zakończ partię
        </button>
        {allowOperatorSwitch && auth ? (
          <button type="button" onClick={() => setOperatorModal(true)}
            className="flex items-center gap-3 pl-5 flex-shrink-0 h-12" style={{ borderLeft: '1px solid var(--lineSoft)' }}>
            <div className="flex flex-col justify-center items-end">
              <span className="text-[9px] font-bold uppercase leading-none mb-1" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>Operator</span>
              <span className="text-sm font-bold leading-none truncate max-w-[140px]">{loggedInUser?.name ?? '—'}</span>
            </div>
            <span className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              <LogOut size={14} />
            </span>
          </button>
        ) : (
          <div className="flex flex-col justify-center items-end pl-5 flex-shrink-0" style={{ borderLeft: '1px solid var(--lineSoft)' }}>
            <span className="text-[9px] font-bold uppercase leading-none mb-1" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>Operator</span>
            <span className="text-sm font-bold leading-none truncate max-w-[140px]">{loggedInUser?.name ?? '—'}</span>
          </div>
        )}
      </header>

      <div className="flex-shrink-0 h-[144px] px-4 py-3 flex items-center gap-3 overflow-x-auto">
        {batchData.loading
          ? <div className="flex items-center justify-center w-full"><Spinner size={24} /></div>
          : batches.length === 0
            ? <div className="flex items-center justify-center w-full text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak aktywnych partii</div>
            : batches.map(b => (
                <BatchTileV10 key={b.id} batch={b} selected={selBatch?.id === b.id} onSelect={pickBatch}
                  onLongPress={openWizardInProgress} pendingMeatKg={pendingKgByBatch.get(b.id)} />
              ))
        }
        {/* Szare kafle: partie zakończone, oczekujące na ważenie ubocznych
            (przechodzą między dniami). Pomijamy AKTYWNE (pełna lista, nie
            ucięta — inaczej 13. partia miałaby i kafel aktywny „poza ekranem",
            i szary). */}
        {(byproductsData.data ?? [])
          .filter(p => !allActiveBatches.some(b => b.id === p.rawBatchId))
          .map(p => (
            <PendingBatchTile key={p.rawBatchId} rec={p}
              onOpen={() => openWizard({ id: p.rawBatchId, internalBatchNo: p.rawBatchNo } as RawBatch)} />
          ))}
      </div>

      <div className="flex-1 flex min-h-0 px-4 pb-4 gap-0">
        <div className="flex-shrink-0 min-h-0 flex flex-col" style={{ width: '34%', paddingRight: 16, borderRight: '1px solid var(--lineSoft)' }}>
          {/* Kolejność wymuszona (guided): pracownicy dostępni dopiero po wyborze partii. */}
          {guided && !selBatch && (
            <div className="flex-shrink-0 mb-2 px-3 py-2 text-[12px] font-bold uppercase text-center" style={{ borderRadius: 8, background: 'var(--accentSoft)', color: 'var(--accent)', letterSpacing: '.06em' }}>
              Najpierw wybierz partię ↑
            </div>
          )}
          {workerData.loading
            ? <div className="flex items-center justify-center h-full"><Spinner size={32} /></div>
            : (
              <div className={cn('flex-1 min-h-0 overflow-y-auto', guided && !selBatch && 'opacity-40 pointer-events-none')}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(126px, 1fr))', gap: 10, alignContent: 'start' }}>
                {workers.map(w => {
                  const ws = perWorker.get(w.id)
                  return (
                    <WorkerTileV10 key={w.id} worker={w} selected={selWorker?.id === w.id}
                      entryCount={ws?.count ?? 0} kgToday={ws?.taken ?? 0}
                      pendingKg={pendingByWorker.get(w.id)?.totalKg}
                      pendingBatchNo={pendingByWorker.get(w.id)?.batchNos.join(', ')}
                      blocked={(() => {
                        const pnd = pendingByWorker.get(w.id)
                        return !!pnd && !!selBatch && !pnd.batchIds.has(selBatch.id)
                      })()}
                      onSelect={pickWorker}
                      onLongPress={(wk) => { setWorkerDetail(wk); setEditEntryId(null) }} />
                  )
                })}
                {workers.length === 0 && (
                  <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>Brak pracowników rozbioru</span>
                )}
              </div>
            )
          }
        </div>

        <div className="flex-shrink-0 flex flex-col gap-3 min-h-0" style={{ width: '34%', padding: '0 16px', borderRight: '1px solid var(--lineSoft)' }}>
          {guided ? (
            <div className="flex-shrink-0 flex items-center gap-4 px-4 py-3"
              style={{
                borderRadius: 14,
                background: guideReady ? '#F0FDF4' : meatTooBig ? 'var(--redSoft)' : 'var(--accentSoft)',
                border: `1.5px solid ${guideReady ? '#BBF0D3' : meatTooBig ? 'var(--redLine)' : 'var(--accent)'}`,
              }}>
              <div className="flex flex-col items-center justify-center flex-shrink-0"
                style={{ minWidth: 54 }}>
                {guideReady ? (
                  <span className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'var(--success)', color: '#fff' }}>
                    <Check size={26} strokeWidth={3} />
                  </span>
                ) : (
                  <>
                    <span className="hmi-v10-mono font-extrabold leading-none" style={{ fontSize: 34, color: meatTooBig ? 'var(--red)' : 'var(--accent)' }}>{stepNo}</span>
                    <span className="text-[10px] font-bold uppercase mt-0.5" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>z {totalSteps}</span>
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-extrabold leading-tight" style={{ fontSize: 'clamp(18px,1.7vw,24px)', color: guideReady ? 'var(--success)' : meatTooBig ? 'var(--red)' : 'var(--ink)' }}>
                  {guideTitle}
                </div>
                <div className="text-[12px] font-semibold uppercase truncate mt-0.5" style={{ color: 'var(--mut)', letterSpacing: '.04em' }}>
                  {guideHref}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-shrink-0 pt-1">
              <SectionStep no={1} done={!!selBatch}>Partia{selBatch ? ` — ${selBatch.internalBatchNo}` : ''}</SectionStep>
              <SectionStep no={2} done={!!selWorker}>Pracownik{selWorker ? ` — ${selWorker.name}` : ''}</SectionStep>
              {scale.available && (
                <SectionStep no={3} done={cartTareTotal != null && e2Count > 0}>Tara</SectionStep>
              )}
              <SectionStep no={scale.available ? 4 : 3}
                done={taken > 0 && meat > 0 && !meatTooBig && (!autoMode || scale.stable)}>
                Waga
              </SectionStep>
            </div>
          )}

          <div className="flex gap-2 flex-shrink-0">
            <ReadoutV10
              label={resumeId ? 'Pobrano (z pobrania)' : takenMode === 'poj' ? 'Zabrano · poj.' : 'Zabrano z partii'} unit={takenMode === 'poj' && !resumeId ? 'poj' : 'kg'}
              value={kgTaken} active={active === 'taken' && !resumeId}
              onActivate={() => { if (!resumeId) setActive('taken') }}
              sub={resumeId ? 'zablokowane — zważ mięso' : takenMode === 'poj' && takenRaw > 0 ? `= ${fmtKg(taken, 0)} kg` : ''}
              extraHeader={resumeId ? undefined : (
                <span className="flex overflow-hidden" style={{ border: '1px solid var(--line)', borderRadius: 6 }}>
                  {(['kg', 'poj'] as const).map(m => (
                    <span key={m} role="button" onClick={e => { e.stopPropagation(); switchTakenMode(m) }}
                      className="px-2 py-0.5 text-[11px] font-bold uppercase cursor-pointer"
                      style={takenMode === m ? { background: 'var(--ink)', color: '#fff' } : { color: 'var(--mut)' }}>
                      {m}
                    </span>
                  ))}
                </span>
              )}
            />
            <ReadoutV10
              label={autoMode ? 'Mięso Z/S — z wagi' : 'Mięso Z/S'}
              unit="kg"
              value={autoMode ? (autoNet > 0 ? fmtKg(autoNet, 1) : '') : kgMeat}
              active={!autoMode && active === 'meat'}
              error={meatTooBig}
              onActivate={() => {
                // tap w pole przy dostępnej wadze = świadome przejęcie ręczne
                if (scale.available) setMeatManual(true)
                setActive('meat')
              }}
              sub={meatTooBig ? `Mięso nie może przekraczać ${fmtKg(taken, 0)} kg!`
                : autoMode ? (autoNet > 0
                    ? `= ${fmtKg(scale.gross, 1)} − ${fmtKg(weighing.tareTotalKg, 1)} tara`
                    : weighing.ready ? 'czekam na stabilną wagę…' : 'wybierz wózek i pojemniki')
                : yieldPct > 0 ? `${fmtPct(yieldPct, 1)} wydajność` : ''}
              extraHeader={scale.available ? (
                <span role="button"
                  onClick={e => { e.stopPropagation(); setMeatManual(m => !m) }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold uppercase cursor-pointer"
                  style={{ borderRadius: 6, background: autoMode ? 'var(--accentSoft)' : 'var(--ambSoft)',
                    color: autoMode ? 'var(--accent)' : 'var(--amb)',
                    border: `1px solid ${autoMode ? 'var(--accentSoft)' : 'var(--ambLine)'}` }}>
                  <Scale size={11} /> {autoMode ? 'AUTO' : 'RĘCZNIE'}
                </span>
              ) : undefined}
            />
          </div>

          {scale.available && (
            <div className={cn('flex-shrink-0 p-3 flex flex-col gap-2.5', guided && taken <= 0 && 'opacity-40 pointer-events-none')}
              style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>
                {guided && taken <= 0 ? 'Tara — najpierw podaj ćwiartkę' : 'Wózek'}
              </span>
              <div className="flex flex-wrap gap-2">
                {/* Tara 0 = ważenie bez wózka (same pojemniki E2 na wadze) */}
                <button type="button" onClick={() => pickCartTare(0)}
                  className="flex flex-col items-center justify-center gap-0.5 py-2 transition-all active:scale-[0.97]"
                  style={{
                    flex: '1 1 0', minWidth: 92,
                    borderRadius: 10,
                    background: noCart ? 'var(--accent)' : 'var(--panel)',
                    border: `1.5px solid ${noCart ? 'var(--accent)' : 'var(--line)'}`,
                    color: noCart ? '#fff' : 'var(--ink)',
                  }}>
                  <span className="font-extrabold text-lg leading-none uppercase">Bez</span>
                  <span className="text-[10px] font-bold uppercase"
                    style={{ color: noCart ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>wózka · 0,0</span>
                </button>
                {cartTares.map(w => {
                  const cnt = cartCounts[String(w)] ?? 0
                  const sel = cnt > 0
                  return (
                  <button key={w} type="button" onClick={() => pickCartTare(w)}
                    className="relative flex flex-col items-center gap-0.5 py-2 transition-all active:scale-[0.97]"
                    style={{
                      flex: '1 1 0', minWidth: 92,
                      borderRadius: 10,
                      background: sel ? 'var(--accent)' : 'var(--panel)',
                      border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
                      color: sel ? '#fff' : 'var(--ink)',
                    }}>
                    {cnt > 1 && (
                      <span className="hmi-v10-mono absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-sm font-extrabold"
                        style={{ background: 'var(--ink)', color: '#fff', border: '2px solid var(--panel)' }}>
                        {cnt}
                      </span>
                    )}
                    <span className="hmi-v10-mono font-bold text-2xl leading-none">{fmtKg(w, 1)}</span>
                    <span className="text-[10px] font-bold uppercase"
                      style={{ color: sel ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>
                      {cnt > 1 ? `${cnt} wózki = ${fmtKg(w * cnt, 1)} kg` : 'kg · wózek'}
                    </span>
                  </button>
                  )
                })}
              </div>
              {/* Pojemniki E2 — osobny, wyraźny kafel (nie zlewa się z wózkami). */}
              <div className="flex items-center gap-2 p-2" style={{ borderRadius: 10, background: 'var(--accentSoft)', border: '1.5px solid var(--accent)' }}>
                <button type="button" onClick={() => setE2Count(n => Math.max(0, n - 1))}
                  className="w-14 h-12 flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
                  style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
                  <Minus size={24} strokeWidth={3} />
                </button>
                <div className="flex-1 text-center leading-none">
                  <div className="text-[9px] font-bold uppercase" style={{ color: 'var(--accent)', letterSpacing: '.1em' }}>Pojemniki E2</div>
                  <div className="hmi-v10-mono font-extrabold leading-none" style={{ fontSize: 32, color: 'var(--ink)' }}>{e2Count}</div>
                  <div className="text-[10px] font-bold" style={{ color: 'var(--mut)' }}>× {fmtKg(E2_TARE_KG, 1)} kg{e2Count > 0 ? ` = ${fmtKg(weighing.tareE2Kg, 1)} kg` : ''}</div>
                </div>
                <button type="button" onClick={() => setE2Count(n => Math.min(20, n + 1))}
                  className="w-14 h-12 flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
                  style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
                  <Plus size={24} strokeWidth={3} />
                </button>
              </div>
            </div>
          )}

          <NumpadV10 onKey={pressKey} onBackStart={handleBackStart} onBackEnd={handleBackEnd}
            onServiceStart={handleServiceStart} onServiceEnd={handleServiceEnd} disabled={!selBatch || !selWorker} />

          {resumeId ? (
            // ── Tryb domykania pobrania: „Zapisz mięso” + anuluj ──
            <div className="flex-shrink-0 flex gap-2 w-full mt-1">
              <button type="button" onClick={handleCompleteTake} disabled={!canSave || completeTakeLoading}
                className={cn('h-[72px] flex-1 text-lg font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98]', saveFlash && 'scale-[1.01]')}
                style={{
                  borderRadius: 12,
                  background: canSave ? 'var(--accent)' : meatTooBig ? 'var(--redSoft)' : 'var(--bg)',
                  color: canSave ? '#fff' : meatTooBig ? 'var(--red)' : 'var(--mut)',
                  border: `1.5px solid ${canSave ? 'var(--accent)' : meatTooBig ? 'var(--redLine)' : 'var(--line)'}`,
                  boxShadow: canSave ? '0 10px 24px -10px rgba(79,70,229,.5)' : undefined,
                }}>
                {completeTakeLoading ? <span className="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : canSave ? <Save size={24} /> : null}
                {canSave ? `ZAPISZ MIĘSO — ${fmtKg(meat, 1)} KG` : meatTooBig ? 'MIĘSO > POBRANE!' : 'ZWAŻ MIĘSO'}
              </button>
              <button type="button" onClick={cancelResume}
                className="h-[72px] px-5 text-sm font-bold uppercase"
                style={{ borderRadius: 12, background: 'var(--bg)', color: 'var(--mut)', border: '1.5px solid var(--line)' }}>
                Anuluj
              </button>
            </div>
          ) : (
            // ── Tryb normalny: „Zapisz wpis” (od razu) + kompaktowe „Pobranie” ──
            // JEDEN rząd 72 px (jak przed dwufazowym) — drugi rząd przycisków
            // spychał numpad i przycisk nachodził na klawisz „0”.
            <div className="flex-shrink-0 flex gap-2 w-full mt-1">
              <button type="button" onClick={handleSave} disabled={!canSave || addLoading}
                className={cn('h-[72px] flex-1 min-w-0 text-lg font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98]', saveFlash && 'scale-[1.01]')}
                style={{
                  borderRadius: 12,
                  background: canSave ? 'var(--accent)' : meatTooBig ? 'var(--redSoft)' : 'var(--bg)',
                  color: canSave ? '#fff' : meatTooBig ? 'var(--red)' : 'var(--mut)',
                  border: `1.5px solid ${canSave ? 'var(--accent)' : meatTooBig ? 'var(--redLine)' : 'var(--line)'}`,
                  boxShadow: canSave ? '0 10px 24px -10px rgba(79,70,229,.5)' : undefined,
                }}>
                {addLoading ? <span className="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : canSave ? <Save size={24} /> : null}
                {saveHint}
              </button>
              <button type="button" onClick={handleSaveTake} disabled={!canSaveTake || addTakeLoading}
                className="h-[72px] px-4 flex-shrink-0 flex flex-col items-center justify-center gap-0.5 transition-all active:scale-[0.98]"
                style={{
                  borderRadius: 12,
                  background: 'var(--bg)',
                  color: canSaveTake ? 'var(--accent)' : 'var(--mut)',
                  border: `1.5px solid ${canSaveTake ? 'var(--accent)' : 'var(--line)'}`,
                }}>
                <span className="flex items-center gap-1.5 text-sm font-bold uppercase leading-none">
                  {addTakeLoading ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : <Clock size={16} />}
                  Pobranie
                </span>
                <span className="hmi-v10-mono text-[13px] font-bold leading-none">
                  {canSaveTake ? `${fmtKg(taken, 1)} kg` : '—'}
                </span>
                <span className="text-[9px] font-bold uppercase leading-none" style={{ color: 'var(--mut)' }}>mięso później</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col gap-3 min-h-0" style={{ paddingLeft: 16 }}>
          {scale.available && (
            <div className="flex-shrink-0 p-3.5" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div className="flex items-center gap-2">
                <span className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                  style={{ background: scale.connected ? 'var(--success)' : 'var(--red)',
                    boxShadow: scale.connected ? '0 0 0 3px rgba(22,163,74,.18)' : '0 0 0 3px rgba(220,38,38,.15)' }} />
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Waga najazdowa</span>
                <button type="button" onClick={() => { scale.tare(); showToast('Wysłano tarę do wagi') }}
                  disabled={!scale.connected}
                  className="ml-auto h-8 px-5 text-[12px] font-bold uppercase active:scale-95 transition-transform"
                  style={{ borderRadius: 8, letterSpacing: '.06em',
                    background: scale.connected ? 'var(--accent)' : 'var(--panel)',
                    color: scale.connected ? '#fff' : 'var(--mut)',
                    border: `1px solid ${scale.connected ? 'var(--accent)' : 'var(--line)'}` }}>
                  Tara
                </button>
                <span className="hmi-v10-mono text-[11px] font-bold" style={{ color: 'var(--mut)' }}>
                  {scale.connected ? 'RS232' : 'BRAK'}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className="hmi-v10-mono font-bold leading-none" style={{ fontSize: 'clamp(44px, 3.6vw, 64px)' }}>
                  {fmtKg(scale.gross, 1)}
                </span>
                <span className="text-lg font-bold" style={{ color: 'var(--mut)' }}>kg</span>
                <span className="ml-auto flex items-center gap-2 px-3 h-8 text-[13px] font-bold self-center"
                  style={scale.connected && scale.error
                    ? { borderRadius: 8, background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' }
                    : scale.connected && scale.gross > 0
                    ? scale.stable
                      ? { borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF0D3', color: 'var(--success)' }
                      : { borderRadius: 8, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }
                    : { borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}>
                  {scale.connected && scale.error ? 'POZA ZAKRESEM (maks 1 t)' : scale.connected && scale.gross > 0 ? (scale.stable ? 'STABILNA' : 'WAŻENIE…') : 'PUSTA'}
                </span>
              </div>
              <div className="mt-2 pt-2 flex flex-col gap-1" style={{ borderTop: '1px solid var(--lineSoft)' }}>
                <div className="flex justify-between text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>
                  <span>− tara {(() => {
                    const parts = Object.entries(cartCounts).map(([w, c]) => c > 1 ? `${c}×${fmtKg(Number(w), 1)}` : fmtKg(Number(w), 1))
                    return parts.length > 1 || Object.values(cartCounts).some(c => c > 1)
                      ? `wózków (${parts.join(' + ')})` : 'wózka'
                  })()}</span>
                  <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{cartTareTotal != null ? `−${fmtKg(cartTareTotal, 1)} kg` : '—'}</span>
                </div>
                <div className="flex justify-between text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>
                  <span>− pojemniki E2 ({e2Count} × {fmtKg(E2_TARE_KG, 1)})</span>
                  <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{e2Count > 0 ? `−${fmtKg(weighing.tareE2Kg, 1)} kg` : '—'}</span>
                </div>
                <div className="flex items-baseline justify-between px-3 py-2 mt-1" style={{ borderRadius: 8, background: 'var(--accentSoft)' }}>
                  <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)', letterSpacing: '.08em' }}>Netto mięso</span>
                  <span className="hmi-v10-mono font-bold text-2xl" style={{ color: 'var(--accent)' }}>
                    {weighing.netKg > 0 ? `${fmtKg(weighing.netKg, 1)} kg` : '—'}
                  </span>
                </div>
                {/* Procent rozbioru TEJ ćwiartki (mięso z pobranej ćwiartki), nie dnia. */}
                <div className="flex items-baseline justify-between px-3 py-2" style={{ borderRadius: 8, border: '1px solid var(--line)' }}>
                  <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Procent rozbioru</span>
                  <span className="hmi-v10-mono font-extrabold text-3xl leading-none" style={{ color: yieldInk(yieldPct) }}>
                    {yieldPct > 0 ? fmtPct(yieldPct, 1) : '—'}
                  </span>
                </div>
                {weighing.netKg > 0 && (
                  <div className="px-3 py-1.5 text-[12px] font-bold" style={weighing.plausible
                    ? { borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF0D3', color: 'var(--success)' }
                    : { borderRadius: 8, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}>
                    {weighing.plausible
                      ? `✓ ${fmtKg(weighing.kgPerContainer, 1)} kg / pojemnik — w normie (${KG_PER_E2_MIN}–${KG_PER_E2_MAX} kg)`
                      : `⚠ ${fmtKg(weighing.kgPerContainer, 1)} kg / pojemnik — poza normą ${KG_PER_E2_MIN}–${KG_PER_E2_MAX} kg. Sprawdź liczbę E2 i wózek!`}
                  </div>
                )}
              </div>
            </div>
          )}

          {!scale.available && (
          <div className="flex-shrink-0 p-3.5" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="text-[10px] font-bold uppercase mb-2.5" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Wydajność i tempo</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3">
                <CircleGauge value={shift.yieldPct} min={0} max={100} color="var(--accent)" />
                <div>
                  <div className="hmi-v10-mono font-extrabold text-2xl leading-none">{shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—'}</div>
                  <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--mut)' }}>Wydajność</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CircleGauge value={shift.tempo} min={0} max={TEMPO_TARGET * 1.25} color="var(--success)" />
                <div>
                  <div className="hmi-v10-mono font-extrabold text-2xl leading-none">{fmtKg(shift.tempo, 0)}</div>
                  <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--mut)' }}>kg/h</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="px-3 py-2 flex items-baseline justify-between" style={{ borderRadius: 8, background: 'var(--bg)' }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Prognoza dnia</span>
                <span className="hmi-v10-mono text-sm font-bold">{shift.prognoza != null ? `${fmtKg(shift.prognoza, 0)} kg` : '—'}</span>
              </div>
              <div className="px-3 py-2 flex items-baseline justify-between" style={{ borderRadius: 8, background: 'var(--bg)' }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Aktywni (60 min)</span>
                <span className="hmi-v10-mono text-sm font-bold">{shift.activeWorkers}<span style={{ color: 'var(--mut)' }}> / {perWorker.size}</span></span>
              </div>
            </div>
          </div>
          )}

          <div className="flex-shrink-0 p-3.5" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Alarmy</div>
            {alarms.length === 0 ? (
              <div className="px-3 py-2 text-sm font-semibold" style={{ borderRadius: 8, background: 'var(--bg)', color: 'var(--mut)' }}>
                Brak aktywnych alarmów — stan normalny
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[100px] overflow-y-auto">
                {alarms.map(a => (
                  <div key={a.id} className="px-3 py-2 text-[13px] font-semibold" style={{
                    borderRadius: 8,
                    background: a.level === 'red' ? 'var(--redSoft)' : 'var(--ambSoft)',
                    border: `1px solid ${a.level === 'red' ? 'var(--redLine)' : 'var(--ambLine)'}`,
                    color: a.level === 'red' ? 'var(--red)' : 'var(--amb)',
                  }}>
                    {a.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Otwarte pobrania pokazują się na kafelkach pracowników
              („⏳ czeka X kg") — klik w kafelek wraca do domknięcia mięsem. */}

          <div className="flex-1 min-h-0 p-3.5 flex flex-col" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="flex items-center gap-2 mb-2.5 flex-shrink-0">
              <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--success)', boxShadow: '0 0 0 3px rgba(22,163,74,.18)' }} />
              <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Ostatnie wpisy</span>
              {canUndo && (
                <button type="button" onClick={handleUndo} disabled={removeLoading}
                  className="flex items-center gap-1.5 px-3 h-8 text-[12px] font-bold uppercase active:scale-[0.97]"
                  style={{ borderRadius: 8, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)', marginLeft: 8 }}>
                  {removeLoading
                    ? <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    : <Undo2 size={14} />}
                  Cofnij ({undoSecondsLeft}s)
                </button>
              )}
              <ListOrdered size={13} style={{ color: 'var(--mut)', marginLeft: 'auto' }} />
              <span className="hmi-v10-mono text-xs font-bold" style={{ color: 'var(--mut)' }}>{completeEntries.length} dziś</span>
            </div>
            {/* Nagłówek kolumn — wszystko w jednej linii, osobne kolumny liczb. */}
            <div className="grid grid-cols-[44px_1fr_46px_78px_78px_48px] items-center gap-2 px-2 pb-1.5 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--line)' }}>
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>Godz.</span>
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>Pracownik</span>
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>Part.</span>
              <span className="text-[9px] font-bold uppercase text-right" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>Ćwiartka</span>
              <span className="text-[9px] font-bold uppercase text-right" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>Mięso Z/S</span>
              <span className="text-[9px] font-bold uppercase text-right" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>%</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm font-semibold" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : recent.map((e: DeboningEntry, i) => (
                <div key={e.id} className={cn('grid grid-cols-[44px_1fr_46px_78px_78px_48px] items-center gap-2 px-2 py-2', i > 0 && 'border-t')}
                  style={{ borderColor: 'var(--lineSoft)' }}>
                  <span className="hmi-v10-mono text-xs" style={{ color: 'var(--mut)' }}>
                    {new Date(entryTime(e)).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[13px] font-semibold truncate">{e.workerName}</span>
                  <span className="hmi-v10-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.rawBatchNo}</span>
                  <span className="hmi-v10-mono text-[13px] text-right">{fmtKg(e.kgTaken, 1)}</span>
                  <span className="hmi-v10-mono text-[13px] text-right">{fmtKg(e.kgMeat, 1)}</span>
                  <span className="hmi-v10-mono text-[13px] font-bold text-right" style={{ color: yieldInk(e.yieldPct) }}>{fmtPct(e.yieldPct, 1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 h-[76px] grid grid-cols-7" style={{ background: 'var(--barBg)', borderTop: '1px solid var(--line)' }}>
        {[
          { label: 'Ćwiartka pobrana dzisiaj', val: `${fmtKg(shift.totTaken, 0)} kg` },
          { label: 'Mięso',         val: `${fmtKg(shift.totMeat, 0)} kg` },
          { label: 'Wydajność dnia', val: shift.totMeat > 0 ? fmtPct(shift.yieldPct, 1) : '—', color: yieldInk(shift.yieldPct) },
          { label: 'Grzbiety',      val: `${fmtKg(shift.totBacks + (byprodToday.data?.backsKg ?? 0), 0)} kg` },
          { label: 'Kości',         val: `${fmtKg(shift.totBones + (byprodToday.data?.bonesKg ?? 0), 0)} kg` },
          { label: 'Wpisy',         val: String(completeEntries.length) },
        ].map(c => (
          <div key={c.label} className="flex flex-col items-center justify-center px-1 text-center" style={{ borderRight: '1px solid var(--lineSoft)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none" style={{ color: (c as any).color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--mut)' }}>{c.label}</span>
          </div>
        ))}
        <button type="button" onClick={() => setStatsModal(true)}
          className="flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-transform" style={{ color: 'var(--accent)' }}>
          <BarChart3 size={20} />
          <span className="text-[10px] font-bold uppercase">Statystyki</span>
        </button>
      </div>

      {statsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={VARS}>
          <div className="w-[720px] max-h-[80vh] flex flex-col" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--lineSoft)' }}>
              <BarChart3 size={22} style={{ color: 'var(--accent)' }} />
              <h3 className="font-extrabold text-xl flex-1">Statystyki zmiany</h3>
              <button type="button" onClick={() => setStatsModal(false)} className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-4 sticky top-0" style={{ background: 'var(--bg)' }}>
                <div className="px-4 py-3 text-[11px] font-bold uppercase" style={{ color: 'var(--mut)' }}>Pracownik</div>
                {([['taken', 'Ćwiartka'], ['meat', 'Mięso'], ['yield', 'Procent'], ['count', 'Wpisy']] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => toggleStatsSort(key)}
                    className="px-4 py-3 text-right text-[11px] font-bold uppercase flex items-center justify-end gap-1"
                    style={{ color: statsSort === key ? 'var(--accent)' : 'var(--mut)' }}>
                    {label}<span className="text-[10px]">{statsSort === key ? (statsDir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                ))}
              </div>
              {workerStats.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--mut)' }}>Brak wpisów z dziś</div>
              ) : workerStats.map(s => (
                <div key={s.name} className="grid grid-cols-4 px-4 py-4 items-center" style={{ borderTop: '1px solid var(--lineSoft)' }}>
                  <span className="font-semibold text-base">{s.name}</span>
                  <span className="hmi-v10-mono text-right font-bold text-base">{fmtKg(s.taken, 1)} kg</span>
                  <span className="hmi-v10-mono text-right font-bold text-base">{fmtKg(s.meat, 1)} kg</span>
                  <span className="hmi-v10-mono text-right font-bold text-xl" style={{ color: yieldInk(s.yieldPct) }}>{fmtPct(s.yieldPct, 1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {finishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={VARS}>
          <div className="w-[480px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: 12, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}><Flag size={26} /></div>
              <div>
                <h3 className="font-extrabold text-xl">Zakończenie partii</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>{pendingFinalize.length} wpisów · {fmtKg(finalizeTotalTaken, 1)} kg ćwiartki</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {([['Grzbiety (kg)', inputBacks, setInputBacks], ['Kości (kg)', inputBones, setInputBones]] as const).map(([label, val, set]) => (
                <label key={label} className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase" style={{ color: 'var(--mut)' }}>{label}</span>
                  <input type="number" min="0" step="0.01" value={val} onChange={e => set(e.target.value)}
                    className="hmi-v10-mono h-13 px-4 text-xl font-bold bg-transparent outline-none"
                    style={{ height: 52, borderRadius: 8, border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--bg)' }} />
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setFinishModal(false)} className="flex-1 h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>Anuluj</button>
              <button type="button" onClick={handleFinishBatchConfirm} className="flex-[2] h-12 text-base font-bold" style={{ borderRadius: 10, background: 'var(--amb)', color: '#fff' }}>Zatwierdź zakończenie</button>
            </div>
          </div>
        </div>
      )}

      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={VARS}>
          <div className="w-[400px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: 12, background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' }}><LogOut size={26} /></div>
              <div>
                <h3 className="font-extrabold text-xl">Zakończyć zmianę?</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>Sesja zostanie zamknięta.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShiftModal(false)} className="flex-1 h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>Anuluj</button>
              <button type="button" onClick={handleCloseShift} disabled={closeLoading}
                className="flex-[2] h-12 text-base font-bold flex items-center justify-center gap-3" style={{ borderRadius: 10, background: 'var(--red)', color: '#fff' }}>
                {closeLoading ? <span className="w-5 h-5 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : <LogOut size={18} />}
                Zakończ zmianę
              </button>
            </div>
          </div>
        </div>
      )}

      {operatorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={VARS}>
          <div className="w-[400px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1px solid var(--line)', color: 'var(--accent)' }}><LogOut size={26} /></div>
              <div>
                <h3 className="font-extrabold text-xl">Zmienić operatora?</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>Wrócisz do ekranu logowania PIN. Sesja i wpisy zostają — zmiana nie jest kończona.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setOperatorModal(false)} className="flex-1 h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>Anuluj</button>
              <button type="button" onClick={() => { setOperatorModal(false); void auth?.logout() }}
                className="flex-[2] h-12 text-base font-bold flex items-center justify-center gap-3" style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
                <LogOut size={18} /> Zmień operatora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
