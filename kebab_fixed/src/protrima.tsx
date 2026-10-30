/**
 * protrima.tsx — wejście PRÓBY nowego wyglądu biura (PROTRIMA).
 *
 * Osobny bundle bez routera i bez stron starego MES. Dane z backendu próby
 * (kopia bazy, :8090) — patrz docs/protrima-ui/ZASADY_PROBY.md.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
// Czcionki osadzone lokalnie — działają offline, także w Tauri.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-ext-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-ext-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-ext-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-ext-400.css'
import './protrima/styles/tokens.css'
import './protrima/styles/base.css'
import './protrima/styles/shell.css'
import './protrima/styles/table.css'
import './protrima/styles/modules.css'
import './protrima/styles/login.css'
import './protrima/styles/print.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ProtrimaRoot } from './protrima/Root'

installGlobalErrorLogger()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ProtrimaRoot />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
