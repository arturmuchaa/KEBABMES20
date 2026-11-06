import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthContext'
import { Logo } from '../brand/Logo'
import { ProbaZnacznik } from '../kopia'
import { PROBA } from '../proba'
import { FlagIcon } from '../ui/Glyphs'
import { ETAPY_ZAKLADU } from './etapy'
import { useAktualizacja } from './aktualizacja'

/** Odpowiedź serwera na złe dane („Nieprawidłowe dane logowania”, 401) — po ludzku, z najczęstszą przyczyną. */
const ZLE_DANE = /nieprawidłowe dane logowania|HTTP 401|unauthori[sz]ed/i

export function Logowanie({ blad: bladZewn }: { blad?: string }) {
  const { loginOffice, logout, user } = useAuth()
  const [login, setLogin] = useState('')
  const [haslo, setHaslo] = useState('')
  const [blad, setBlad] = useState<string | null>(bladZewn ?? null)
  const [busy, setBusy] = useState(false)
  const [pokaz, setPokaz] = useState(false)
  const [caps, setCaps] = useState(false)
  // Na ekranie logowania nic nie jest jeszcze wpisane — nowa wersja instaluje się sama (program się zrestartuje).
  const akt = useAktualizacja({ auto: true })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim() || !haslo) { setBlad('Wpisz login i hasło.'); return }
    setBusy(true); setBlad(null)
    try {
      if (user) await logout()
      await loginOffice(login.trim(), haslo)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setBlad(/Failed to fetch|NetworkError|Load failed/i.test(msg) ? (PROBA ? 'Brak połączenia z serwerem próby (:8090). Sprawdź sieć albo zaporę.' : 'Brak połączenia z serwerem MES. Sprawdź sieć.')
        : ZLE_DANE.test(msg) ? 'Zły login lub hasło. Sprawdź, czy nie jest włączony Caps Lock.'
        : msg)
    } finally {
      setBusy(false)
    }
  }
  // Caps Lock to najczęstsza przyczyna „złego hasła” przy codziennym logowaniu — mówimy o nim od razu.
  const sprawdzCaps = (e: React.KeyboardEvent) => setCaps(e.getModifierState('CapsLock'))

  return (
    <div className="login-wrap split">
      {/* Panel marki: linia procesu zakładu — te same etapy co „Przebieg dnia” na Pulpicie. */}
      <aside className="login-side" aria-hidden="true">
        <Logo height={30} />
        <div className="ls-copy">
          <h2>Produkcja pod kontrolą</h2>
          <p>Od przyjęcia surowca do wysyłki: zamówienia, magazyn, dokumenty i HACCP w jednym miejscu.</p>
        </div>
        <ol className="ls-rail">
          {ETAPY_ZAKLADU.map(e => <li key={e.key}><i />{e.name}</li>)}
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
        <span className="login-haslo">
          <input id="haslo" className="field" type={pokaz ? 'text' : 'password'} autoComplete="current-password" value={haslo}
            onChange={e => setHaslo(e.target.value)} onKeyUp={sprawdzCaps} onKeyDown={sprawdzCaps} onBlur={() => setCaps(false)} />
          <button type="button" className="btn ghost icon" aria-label="Pokaż hasło" aria-pressed={pokaz} data-tip={pokaz ? 'Ukryj hasło' : 'Pokaż hasło'}
            onClick={() => setPokaz(v => !v)}>{pokaz ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </span>
        {caps && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Włączony Caps Lock</div></div>}
        {blad && <div className="note crit" role="alert">{blad}</div>}
        {akt.instaluje && <div className="note info" role="status"><FlagIcon level="info" size={15} /><div>Instaluję nową wersję PROTRIMA {akt.wersja}… Program uruchomi się ponownie.</div></div>}
        {akt.blad && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Nie udało się zainstalować wersji {akt.wersja}: {akt.blad}. Możesz pracować na obecnej.</div></div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj'}</button>
      </form>
    </div>
  )
}

declare const __PROTRIMA_VERSION__: string
