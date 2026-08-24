/**
 * Wspólna rama kiosku hali — splash, PIN, blokady operatorskie, bramka sesji.
 *
 * Powstała z rozbior-v10.tsx przy budowie drugiego stanowiska (produkcja).
 * Kopiowanie 260 linii ramy oznaczałoby, że każda poprawka (a już były:
 * sprzątanie service workera, ponawianie listy operatorów, wejście serwisowe
 * z ekranu logowania) musi być robiona dwa razy — i za którymś razem nie
 * będzie. Różnice między stanowiskami to WYŁĄCZNIE dział i podpis.
 */
import React, { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Spinner } from '@/components/ui/widgets'
import { useAuth } from '@/features/auth/AuthContext'
import { BASE } from '@/lib/api'
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import { useServiceHold, ServiceMenuModal } from '@/features/deboning/ServiceMenu'

/** Blokady operatorskie: brak menu kontekstowego, brak F5/F11/F12/Alt+F4. */
export function KioskGuards() {
  useEffect(() => {
    const noCtx = (e: MouseEvent) => e.preventDefault()
    const noKeys = (e: KeyboardEvent) => {
      const k = e.key
      if (
        k === 'F5' || k === 'F11' || k === 'F12' ||
        ((e.ctrlKey || e.metaKey) && (k === 'r' || k === 'R')) ||
        (e.altKey && k === 'F4')
      ) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('contextmenu', noCtx)
    window.addEventListener('keydown', noKeys, true)
    return () => {
      window.removeEventListener('contextmenu', noCtx)
      window.removeEventListener('keydown', noKeys, true)
    }
  }, [])
  return null
}

/**
 * Kiosk NIGDY nie używa service workera — SW pełnego MES (pakowanie offline)
 * raz zarejestrowany w tym WebView przechwytywał start kiosku i serwował
 * z cache dashboard MES zamiast strony kiosku (prod 2026-07-09). Sprzątamy
 * przy każdym starcie, żeby incydent nie mógł się utrwalić.
 */
export function dropServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => { rs.forEach(r => r.unregister()) })
      .catch(() => {})
    if (typeof caches !== 'undefined') {
      caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {})
    }
  }
}

interface KioskOperator { id: string; name: string }

/** Co pokazać zamiast klawiatury PIN, dopóki nie ma z czego wybierać. */
type OpsState = 'loading' | 'ready' | 'empty'

export interface KioskIdentity {
  /** Dział w bazie — filtruje listę operatorów (`rozbior`, `produkcja`). */
  department: string
  /** Podpis nad pytaniem „Kto pracuje?" i w komunikacie o braku ludzi. */
  label: string
  /**
   * Kanał aktualizacji TEGO stanowiska (`rozbior-v10`, `produkcja`) i jego
   * wersja. Menu serwisowe cofa wersję po kanale — pomyłka tutaj oznacza,
   * że serwisant przy jednym panelu zdejmuje wersję drugiemu.
   */
  channel: string
  version: string
}

export function KioskLoginScreen({ department, label, channel, version }: KioskIdentity) {
  const { loginPin } = useAuth()
  const [ops, setOps] = useState<KioskOperator[]>([])
  const [opsState, setOpsState] = useState<OpsState>('loading')
  const [selId, setSelId] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [retry, setRetry] = useState(0)
  // Wejście serwisowe także z ekranu logowania — gdy kiosk utknie tu (np. brak
  // backendu), serwisant musi móc wyjść do Windows bez fizycznego dostępu do BIOS-u.
  const [serviceModal, setServiceModal] = useState(false)
  const { holdProps: serviceHoldProps } = useServiceHold(() => setServiceModal(true))

  // Jako powłoka Windows HMI startuje ZANIM sieć/backend są gotowe, więc BŁĄD
  // SIECI ponawiamy w kółko. Ale PUSTA lista to nie awaria — to dział bez
  // przypisanych ludzi; ponawianie w nieskończoność pokazywałoby wtedy
  // „Łączenie z serwerem…" bez końca i nikt by się nie dowiedział, czego brakuje.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      fetch(`${BASE}/auth/operators?department=${encodeURIComponent(department)}`)
        .then(r => r.json())
        .then((list: KioskOperator[]) => {
          if (cancelled) return
          if (Array.isArray(list) && list.length > 0) {
            setOps(list); setOpsState('ready')
          } else {
            setOps([]); setOpsState('empty')
          }
        })
        .catch(() => { if (!cancelled) timer = setTimeout(load, 2000) }) // sieć nie wstała — ponów
    }
    load()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [department, retry])

  const selWorker = ops.find(o => o.id === selId) ?? null

  const pressDigit = (d: string) => {
    setErr('')
    setPin(prev => (prev.length >= 4 ? prev : prev + d))
  }
  const backspace = () => { setErr(''); setPin(prev => prev.slice(0, -1)) }
  const pickWorker = (o: KioskOperator) => { setSelId(o.id); setPin(''); setErr('') }
  const backToList = () => { setSelId(''); setPin(''); setErr('') }

  async function submit() {
    if (!selId || !pin || submitting) return
    setSubmitting(true); setErr('')
    try {
      await loginPin(selId, pin)
    } catch (e: any) {
      setErr(e?.message || 'Błędny PIN')
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  const keyStyle: CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-8"
      style={{ ...HMI_VARS, background: 'var(--bg)', color: 'var(--ink)', fontFamily: HMI_FONT }}>
      <div className="text-center select-none" {...serviceHoldProps}>
        <div className="text-[13px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.3em' }}>{label}</div>
        <h1 className="font-extrabold text-4xl mt-1" style={{ letterSpacing: '-.01em' }}>
          {selWorker ? `Cześć, ${selWorker.name.split(' ')[0]}` : 'Kto pracuje?'}
        </h1>
      </div>

      {!selWorker ? (
        opsState === 'loading' ? (
          <div className="flex flex-col items-center gap-4">
            <Spinner size={40} />
            <span className="text-sm font-semibold" style={{ color: 'var(--mut)' }}>Łączenie z serwerem…</span>
          </div>
        ) : opsState === 'empty' ? (
          // Konkret zamiast kręcącego się kółka: biuro musi wiedzieć, CO zrobić.
          <div className="flex flex-col items-center gap-5 text-center" style={{ maxWidth: 560 }}>
            <div className="text-xl font-extrabold">Nikt nie jest przypisany do działu {label.toLowerCase()}</div>
            <div className="text-base" style={{ color: 'var(--mut)' }}>
              Biuro musi dodać pracowników do działu <b>{department}</b> (Pracownicy → dział), wtedy pojawią się na tym ekranie.
            </div>
            <button type="button" onClick={() => { setOpsState('loading'); setRetry(n => n + 1) }}
              className="h-14 px-10 font-bold text-base"
              style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
              Sprawdź ponownie
            </button>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, 140px)', maxWidth: 760, justifyContent: 'center' }}>
            {ops.map(o => {
              const initials = o.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
              return (
                <button key={o.id} type="button" onClick={() => pickWorker(o)}
                  className="flex flex-col items-center justify-center gap-2"
                  style={{ ...keyStyle, width: 140, aspectRatio: '1' }}>
                  <span className="font-extrabold text-2xl leading-none">{initials}</span>
                  <span className="text-sm font-semibold text-center px-2 truncate w-full">{o.name}</span>
                </button>
              )
            })}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: i < pin.length ? 'var(--accent)' : 'var(--line)' }} />
            ))}
          </div>
          {err && <div className="font-semibold text-sm" style={{ color: 'var(--red)' }}>{err}</div>}
          <div className="grid grid-cols-3 gap-3" style={{ width: 300 }}>
            {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(d => (
              <button key={d} type="button" onClick={() => pressDigit(d)} className="h-20 font-bold text-2xl" style={keyStyle}>{d}</button>
            ))}
            <button type="button" onClick={backToList} className="h-20 font-bold text-sm" style={{ ...keyStyle, color: 'var(--mut)' }}>Wstecz</button>
            <button type="button" onClick={() => pressDigit('0')} className="h-20 font-bold text-2xl" style={keyStyle}>0</button>
            <button type="button" onClick={backspace} className="h-20 font-bold text-xl" style={{ ...keyStyle, color: 'var(--red)' }}>⌫</button>
          </div>
          <button type="button" onClick={submit} disabled={!pin || submitting}
            className="h-16 px-20 font-bold text-lg"
            style={{ borderRadius: 12, background: 'var(--accent)', color: '#fff', opacity: (!pin || submitting) ? 0.5 : 1 }}>
            {submitting ? 'Loguję…' : 'Zaloguj'}
          </button>
        </div>
      )}
      <ServiceMenuModal open={serviceModal} onClose={() => setServiceModal(false)} channel={channel} version={version} />
    </div>
  )
}

/** Bramka: ładowanie sesji → ekran logowania (brak tokenu) → ekran stanowiska. */
export function KioskGate({ children, ...id }: KioskIdentity & { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ background: '#E7EAEE' }}>
        <Spinner size={48} />
      </div>
    )
  }
  if (!user) return <KioskLoginScreen {...id} />
  return <>{children}</>
}

/**
 * Ten sam wygląd co statyczny splash w HTML kiosku (logo + kółeczko) — żeby
 * przejście ze statycznego HTML na wersję renderowaną przez Reacta było
 * niewidoczne, zamiast „skoku" między nimi.
 */
export function SplashScreen() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-7" style={{ background: '#FFFFFF' }}>
      <img src="/logo-ksiezyc.png" alt="Księżyc" width={800} height={276} style={{ width: 800, height: 276 }} />
      <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '4px solid #E0E7FF', borderTopColor: '#4F46E5' }} />
    </div>
  )
}

/**
 * Minimalny czas splasha (5 s) — bez tego logo znikało natychmiast po
 * zamontowaniu Reacta (ładowanie sesji jest zwykle szybsze niż mrugnięcie
 * okiem), więc w praktyce nie było go widać wcale.
 */
export function SplashGate({ children, ...id }: KioskIdentity & { children: ReactNode }) {
  const [showSplash, setShowSplash] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 5000)
    return () => clearTimeout(t)
  }, [])
  if (showSplash) return <SplashScreen />
  return <KioskGate {...id}>{children}</KioskGate>
}
