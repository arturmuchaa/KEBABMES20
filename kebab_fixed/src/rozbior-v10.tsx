/**
 * rozbior-v10.tsx — samodzielny entry dla Tauri HMI v10 (biel + akcent indygo).
 *
 * Renderuje DeboningHmiV10Page bezpośrednio — bez TabletLayout, bez przełącznika
 * wersji, bez routera. Aplikacja przeznaczona wyłącznie na panel PC 21.5"
 * z systemem Windows (fullscreen, kiosk).
 *
 * Splash, ekran PIN, blokady operatorskie i bramka sesji siedzą we wspólnej
 * ramie (features/kiosk/KioskFrame) — dzieli ją ze stanowiskiem produkcyjnym.
 * Tutaj zostaje tylko to, co dla rozbioru specyficzne.
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthContext'
import { DeboningHmiV10Page } from '@/pages/tablet/DeboningHmiV10Page'
import { KioskGuards, SplashGate, dropServiceWorker } from '@/features/kiosk/KioskFrame'
import { wylaczPodpowiedziPrzegladarki } from '@/lib/bezPodpowiedzi'

// Wstrzykiwane przez Vite z pliku conf tego kiosku (vite.config.ts).
declare const __ROZBIOR_V10_VERSION__: string

installGlobalErrorLogger()
// Bez podpowiedzi przeglądarki w polach (właściciel 27.11.2026: zapamiętane sztuki wklepywały się same).
wylaczPodpowiedziPrzegladarki()
dropServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <TooltipProvider>
          <KioskGuards />
          {/* Wrapper h-screen/w-screen — dzieci używają h-full/w-full */}
          <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
            <SplashGate department="rozbior" label="Rozbiór" channel="rozbior-v10" version={__ROZBIOR_V10_VERSION__}>
              {/* Wariant „wzmocnione prowadzenie" jest produkcyjny (decyzja 2026-07-07):
                  baner KROK n/5 + reset pracownika/wózka/E2 po zapisie. */}
              <DeboningHmiV10Page allowOperatorSwitch guided />
            </SplashGate>
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
