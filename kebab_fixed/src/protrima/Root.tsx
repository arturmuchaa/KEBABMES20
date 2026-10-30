import React, { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { App } from './App'
import { OrdersProvider } from './data/store'
import { Logo } from './brand/Logo'
import { ProbaZnacznik } from './kopia'
import { jestTauri } from './okno'
import { PROBA } from './proba'

/**
 * Korzeń PROTRIMA: strażnik buildu → logowanie → aplikacja.
 *
 * Aplikacja desktopowa startuje tylko z JAWNYM trybem: `proba` (kopia bazy :8090)
 * albo `produkcja` (serwer zakładu :8080). Build bez trybu nie wiadomo, dokąd by
 * pisał — nie startuje wcale.
 */
export function ProtrimaRoot() {
  if (jestTauri() && !['proba', 'produkcja'].includes(import.meta.env.MODE)) return <ZlyBuild />
  return <Bramka />
}

function ZlyBuild() {
  return (
    <div className="login-wrap">
      <div className="login-card" role="alert">
        <Logo height={30} />
        <h1>Nieznany build PROTRIMA</h1>
        <p>Ta aplikacja została zbudowana bez trybu <code>proba</code> ani <code>produkcja</code> — nie wiadomo, z którym serwerem miałaby pracować. Nie uruchamiamy jej.</p>
        <p className="muted">Zainstaluj „PROTRIMA” (produkcja) albo „PROTRIMA Test” (kopia bazy) z GitHub Actions.</p>
      </div>
    </div>
  )
}

function Bramka() {
  const { user, loading } = useAuth()
  // Wylogowanie w innej karcie kasuje token z localStorage — wracamy do logowania także tutaj.
  const [, wymus] = useState(0)
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === 'kebab.token' && !e.newValue) location.reload(); else wymus(n => n + 1) }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [])
  if (loading) return <div className="login-wrap"><div className="login-card"><Logo height={30} /><p className="muted">{PROBA ? 'Łączenie z serwerem próby…' : 'Łączenie z serwerem…'}</p></div></div>
  if (!user) return <Logowanie />
  if (user.kind !== 'office') return <Logowanie blad="To konto operatora hali. PROTRIMA jest dla biura — zaloguj się kontem biurowym." />
  return <OrdersProvider><App /></OrdersProvider>
}

const ETAPY = ['Przyjęcie surowca', 'Rozbiór', 'Masowanie', 'Produkcja', 'Wyrób gotowy', 'Wysyłka']

function Logowanie({ blad: bladZewn }: { blad?: string }) {
  const { loginOffice, logout, user } = useAuth()
  const [login, setLogin] = useState('')
  const [haslo, setHaslo] = useState('')
  const [blad, setBlad] = useState<string | null>(bladZewn ?? null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim() || !haslo) { setBlad('Wpisz login i hasło.'); return }
    setBusy(true); setBlad(null)
    try {
      if (user) await logout()
      await loginOffice(login.trim(), haslo)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setBlad(/Failed to fetch|NetworkError|Load failed/i.test(msg) ? (PROBA ? 'Brak połączenia z serwerem próby (:8090). Sprawdź sieć albo zaporę.' : 'Brak połączenia z serwerem MES. Sprawdź sieć.') : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap split">
      {/* Panel marki: linia procesu zakładu — ten sam motyw co „Przebieg dnia” na Pulpicie. */}
      <aside className="login-side" aria-hidden="true">
        <Logo height={30} />
        <div className="ls-copy">
          <h2>Produkcja pod kontrolą</h2>
          <p>Od przyjęcia surowca do wysyłki: zamówienia, magazyn, dokumenty i HACCP w jednym miejscu.</p>
        </div>
        <ol className="ls-rail">
          {ETAPY.map(e => <li key={e}><i />{e}</li>)}
        </ol>
        <span className="ls-foot">PROTRIMA {__PROTRIMA_VERSION__}</span>
      </aside>
      <form className="login-card" onSubmit={submit} aria-labelledby="login-h">
        <div className="login-brand"><span className="login-logo"><Logo height={30} /></span><ProbaZnacznik /></div>
        <h1 id="login-h">Zaloguj się</h1>
        <p className="muted">{PROBA ? 'Konto biurowe z MES: ten sam login i hasło. Dane pochodzą z KOPII bazy produkcji; zmiany tutaj nie trafiają do prawdziwego MES.' : 'Konto biurowe z MES: ten sam login i hasło.'}</p>
        <label className="label" htmlFor="login">Login</label>
        <input id="login" className="field" autoComplete="username" autoFocus value={login} onChange={e => setLogin(e.target.value)} />
        <label className="label" htmlFor="haslo">Hasło</label>
        <input id="haslo" className="field" type="password" autoComplete="current-password" value={haslo} onChange={e => setHaslo(e.target.value)} />
        {blad && <div className="note crit" role="alert">{blad}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj'}</button>
      </form>
    </div>
  )
}

declare const __PROTRIMA_VERSION__: string
