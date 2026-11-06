import React, { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { App } from './App'
import { OrdersProvider } from './data/store'
import { Logo } from './brand/Logo'
import { jestTauri } from './okno'
import { PROBA } from './proba'
import { Logowanie } from './shell/Logowanie'

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

