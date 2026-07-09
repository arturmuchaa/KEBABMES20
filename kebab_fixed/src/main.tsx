import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
// ── Fonty self-hosted (offline-safe, on-prem) — Fira Sans (UI) + Fira Code (mono) ──
import '@fontsource/fira-sans/400.css'
import '@fontsource/fira-sans/500.css'
import '@fontsource/fira-sans/600.css'
import '@fontsource/fira-sans/700.css'
import '@fontsource/fira-sans/800.css'
import '@fontsource/fira-sans/900.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/500.css'
import '@fontsource/fira-code/600.css'
import '@fontsource/fira-code/700.css'
import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/features/auth/AuthContext'

installGlobalErrorLogger()

// Service worker — offline shell (pakowanie na hali bez internetu). TYLKO web.
// W Tauri SW nie ma racji bytu, a raz zarejestrowany przechwytywał start
// kiosku rozbioru i serwował z cache pełny MES zamiast rozbior-v10.html
// (prod 2026-07-09) — w Tauri sprzątamy rejestracje i cache, a jeśli ten
// bundle wyświetlił się pod adresem kiosku (porwany start), przeładowujemy.
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
if ('serviceWorker' in navigator) {
  if (IS_TAURI) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => Promise.all(rs.map(r => r.unregister())))
      .then(async (unregs) => {
        try { for (const k of await caches.keys()) await caches.delete(k) } catch { /* brak Cache API */ }
        const kioskPath = location.pathname.includes('rozbior-v') || location.pathname.includes('kiosk')
        if (kioskPath && unregs.length > 0) location.reload()
      })
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider delayDuration={300}>
            <App />
            <Toaster richColors closeButton />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
