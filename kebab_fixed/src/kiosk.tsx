/**
 * kiosk.tsx — wejście dedykowanego kiosku ROZBIORU (osobny build Tauri).
 *
 * Renderuje WYŁĄCZNIE panel rozbioru (TabletLayout → RozbiorRoute) w MemoryRouter
 * zacumowanym na /tablet/rozbior. Wszystkie warianty/motywy (Klasyczny/v2/v3/v4
 * light+dark) dostępne przez wbudowany selektor w nagłówku. Brak biura, brak innych
 * tras. Blokady kiosku (menu kontekstowe, F5/F11/F12, gesty) — niżej.
 */
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TabletLayout } from '@/layouts/TabletLayout'
import { RozbiorRoute } from '@/pages/tablet/RozbiorRoute'

installGlobalErrorLogger()

// Blokady operatorskie: brak menu prawego klawisza, brak odświeżania/F11/F12.
function KioskGuards() {
  useEffect(() => {
    const noCtx = (e: MouseEvent) => e.preventDefault()
    const noKeys = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'F5' || k === 'F11' || k === 'F12' ||
          ((e.ctrlKey || e.metaKey) && (k === 'r' || k === 'R' || k === 'w' || k === 'W')) ||
          (e.altKey && k === 'F4')) {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MemoryRouter initialEntries={['/tablet/rozbior']}>
        <TooltipProvider delayDuration={300}>
          <KioskGuards />
          <Routes>
            <Route path="/tablet" element={<TabletLayout />}>
              <Route path="rozbior" element={<RozbiorRoute />} />
            </Route>
            <Route path="*" element={<Navigate to="/tablet/rozbior" replace />} />
          </Routes>
          <Toaster richColors closeButton />
        </TooltipProvider>
      </MemoryRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
