import React, { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { App } from './App'
import { OrdersProvider } from './data/store'
import { Logo } from './brand/Logo'
import { ProbaZnacznik } from './kopia'
import { jestTauri } from './okno'

/**
 * Korzeń PRÓBY: strażnik buildu → logowanie → aplikacja.
 *
 * Build desktopowy bez trybu `proba` łączyłby się z produkcją (adres w api.ts
 * zależy od trybu), więc taki build nie startuje wcale.
 */
export function ProtrimaRoot() {
  if (jestTauri() && import.meta.env.MODE !== 'proba') return <ZlyBuild />
  return <Bramka />
}

function ZlyBuild() {
  return (
    <div className="login-wrap">
      <div className="login-card" role="alert">
        <Logo height={30} />
        <h1>To nie jest build próby</h1>
        <p>Ta aplikacja PROTRIMA została zbudowana bez trybu <code>proba</code> i mogłaby łączyć się z produkcją. Nie uruchamiamy jej.</p>
        <p className="muted">Zainstaluj instalator „PROTRIMA Test” z GitHub Actions (build <code>--mode proba</code>).</p>
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
  if (loading) return <div className="login-wrap"><div className="login-card"><Logo height={30} /><p className="muted">Łączenie z serwerem próby…</p></div></div>
  if (!user) return <Logowanie />
  if (user.kind !== 'office') return <Logowanie blad="To konto operatora hali. PROTRIMA jest dla biura — zaloguj się kontem biurowym." />
  return <OrdersProvider><App /></OrdersProvider>
}

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
      setBlad(/Failed to fetch|NetworkError|Load failed/i.test(msg) ? 'Brak połączenia z serwerem próby (:8090). Sprawdź sieć albo zaporę.' : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} aria-labelledby="login-h">
        <div className="login-brand"><Logo height={34} /><ProbaZnacznik /></div>
        <h1 id="login-h">Logowanie</h1>
        <p className="muted">Konto biurowe z MES — ten sam login i hasło. Dane pochodzą z KOPII bazy produkcji; zmiany tutaj nie trafiają do prawdziwego MES.</p>
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
