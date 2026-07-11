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

// Service worker — offline shell TYLKO dla /mobile/pakowanie (pakowanie na
// hali bez internetu). Rejestracja musi być zawężona do tej ścieżki (scope) —
// zarejestrowany na całej domenie chwytał WSZYSTKIE strony biura (w tym
// Planowanie masowania) i przy niefortunnym odświeżeniu potrafił po tygodniach
// oddać z cache stary bundle na już zmienionym backendzie ("krzaki" po
// wyjściu/powrocie do apki, mimo że świeży deploy działał poprawnie).
// Ten sam wzorzec co porwanie startu kiosku rozbioru w Tauri (prod
// 2026-07-09) — tam SW też nie ma racji bytu i jest sprzątany bezwarunkowo.
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const IS_PACKING = typeof window !== 'undefined' && location.pathname.startsWith('/mobile/pakowanie')
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
  } else if (IS_PACKING) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/mobile/pakowanie/' }).catch(() => {})
    })
  } else {
    // Poza pakowaniem: sprzątamy rejestracje sprzed tej poprawki (były
    // zawarte na całej domenie) — bez tego stare instalacje w biurze
    // zostałyby z szeroką rejestracją na zawsze.
    navigator.serviceWorker.getRegistrations()
      .then(rs => Promise.all(rs.filter(r => !r.scope.includes('/mobile/pakowanie')).map(r => r.unregister())))
      .catch(() => {})
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
