import React, { useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { Logo } from '../brand/Logo'
import { zmienHaslo } from './hasloApi'

const MIN = 8

/**
 * Zmiana własnego hasła. `wymuszona` — konto ma `must_change_password` (nowe konto albo reset
 * przez administratora): pełny ekran zamiast programu, jak w starym MES (/zmiana-hasla).
 * Bez `wymuszona` — formularz do okna z menu konta. Reguła długości jak na serwerze (min. 8).
 */
export function ZmianaHasla({ wymuszona = false, onDone }: { wymuszona?: boolean; onDone?: () => void }) {
  const { refresh, logout, user } = useAuth()
  const [obecne, setObecne] = useState('')
  const [nowe, setNowe] = useState('')
  const [powtorz, setPowtorz] = useState('')
  const [blad, setBlad] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!obecne) { setBlad('Wpisz obecne hasło.'); return }
    if (nowe.length < MIN) { setBlad(`Nowe hasło musi mieć co najmniej ${MIN} znaków.`); return }
    if (nowe !== powtorz) { setBlad('Nowe hasło w obu polach musi być takie samo.'); return }
    setBusy(true); setBlad(null)
    try {
      await zmienHaslo(obecne, nowe)
      await refresh()
      onDone?.()
    } catch (err) {
      setBlad(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form className={wymuszona ? 'login-card' : 'haslo-form'} onSubmit={submit} {...(wymuszona ? { 'aria-labelledby': 'haslo-h' } : { 'aria-label': 'Zmiana hasła' })}>
      {wymuszona && <span className="login-logo" style={{ display: 'inline-flex' }}><Logo height={30} /></span>}
      {wymuszona && <h1 id="haslo-h">Ustaw nowe hasło</h1>}
      {wymuszona && <p className="muted">{user?.name ? `${user.name}, ` : ''}przed pierwszą pracą ustaw własne hasło (co najmniej {MIN} znaków).</p>}
      <label className="label" htmlFor="haslo-obecne">Obecne hasło</label>
      <input id="haslo-obecne" className="field" type="password" autoComplete="current-password" autoFocus value={obecne} onChange={e => setObecne(e.target.value)} />
      <label className="label" htmlFor="haslo-nowe">Nowe hasło</label>
      <input id="haslo-nowe" className="field" type="password" autoComplete="new-password" value={nowe} onChange={e => setNowe(e.target.value)} />
      <label className="label" htmlFor="haslo-powtorz">Powtórz nowe hasło</label>
      <input id="haslo-powtorz" className="field" type="password" autoComplete="new-password" value={powtorz} onChange={e => setPowtorz(e.target.value)} />
      {blad && <div className="note crit" role="alert">{blad}</div>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Zapisuję…' : 'Zmień hasło'}</button>
      {wymuszona && <button type="button" className="btn ghost" onClick={() => void logout()}>Wyloguj</button>}
    </form>
  )
  return wymuszona ? <div className="login-wrap">{form}</div> : form
}
