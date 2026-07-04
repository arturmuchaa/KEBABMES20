/**
 * rozbior-v10.tsx — samodzielny entry dla Tauri HMI v10 (biel + akcent indygo).
 *
 * Renderuje DeboningHmiV10Page bezpośrednio — bez TabletLayout, bez przełącznika
 * wersji, bez routera. Aplikacja przeznaczona wyłącznie na panel PC 21.5"
 * z systemem Windows (fullscreen, kiosk).
 *
 * Logowanie: backend wymaga tokenu do KAŻDEGO zapytania (potwierdzone 401 na
 * realnym serwerze) — kiosk musi więc mieć własny, minimalny ekran logowania.
 * Reużyto wzorca PIN z src/pages/auth/PanelLoginPage.tsx (wybór pracownika +
 * PIN), na sztywno dla działu "rozbior" (bez wyboru działu — to jedyny sens
 * tego kiosku), w stylu wizualnym HMI v10 zamiast szarego PanelLoginPage.
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React, { useEffect, useState, type CSSProperties } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/widgets'
import { AuthProvider, useAuth } from '@/features/auth/AuthContext'
import { BASE } from '@/lib/api'
import { DeboningHmiV10Page } from '@/pages/tablet/DeboningHmiV10Page'

installGlobalErrorLogger()

// Blokady operatorskie: brak menu kontekstowego, brak F5/F11/F12/Alt+F4
function KioskGuards() {
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

const LOGIN_VARS: CSSProperties = {
  ['--bg' as string]: '#F4F6F8',
  ['--panel' as string]: '#FFFFFF',
  ['--ink' as string]: '#0F172A',
  ['--mut' as string]: '#5B6472',
  ['--line' as string]: '#D8DEE6',
  ['--accent' as string]: '#4F46E5',
  ['--accentSoft' as string]: '#EEF2FF',
  ['--red' as string]: '#DC2626',
  ['--redSoft' as string]: '#FEF2F2',
}

interface KioskOperator { id: string; name: string }

// Ekran logowania kiosku — na sztywno dział "rozbior", styl v10 (biel + indygo).
function KioskLoginScreen() {
  const { loginPin } = useAuth()
  const [ops, setOps] = useState<KioskOperator[]>([])
  const [opsLoading, setOpsLoading] = useState(true)
  const [selId, setSelId] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`${BASE}/auth/operators?department=rozbior`)
      .then(r => r.json())
      .then(setOps)
      .catch(() => setOps([]))
      .finally(() => setOpsLoading(false))
  }, [])

  const selWorker = ops.find(o => o.id === selId) ?? null

  const pressDigit = (d: string) => {
    setErr('')
    setPin(prev => (prev.length >= 6 ? prev : prev + d))
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
      style={{ ...LOGIN_VARS, background: 'var(--bg)', color: 'var(--ink)', fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif' }}>
      <div className="text-center">
        <div className="text-[13px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.3em' }}>Rozbiór</div>
        <h1 className="font-extrabold text-4xl mt-1" style={{ letterSpacing: '-.01em' }}>
          {selWorker ? `Cześć, ${selWorker.name.split(' ')[0]}` : 'Kto pracuje?'}
        </h1>
      </div>

      {!selWorker ? (
        opsLoading ? <Spinner size={40} /> : (
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
            {ops.length === 0 && (
              <div className="text-base font-semibold" style={{ color: 'var(--mut)' }}>Brak operatorów działu rozbiór</div>
            )}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
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
    </div>
  )
}

// Bramka: ładowanie sesji → ekran logowania (brak tokenu) → panel rozbioru.
function KioskGate() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ background: '#F4F6F8' }}>
        <Spinner size={48} />
      </div>
    )
  }
  if (!user) return <KioskLoginScreen />
  return <DeboningHmiV10Page />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <TooltipProvider>
          <KioskGuards />
          {/* Wrapper h-screen/w-screen — dzieci używają h-full/w-full */}
          <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
            <KioskGate />
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
