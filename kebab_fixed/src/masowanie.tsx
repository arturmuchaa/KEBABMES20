/**
 * masowanie.tsx — samodzielny entry dla Tauri „Masowanie HMI".
 *
 * Trzecie stanowisko hali. Rama i motyw jak w kiosku rozbioru i produkcji;
 * zasady pracy z prototypu 0.9: dwa tory (przyprawy do pojemnika / załadunek
 * masownicy) i bramka partii wskazanych przez biuro.
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthContext'
import { MasowanieHmiPage } from '@/pages/tablet/MasowanieHmiPage'
import { KioskGuards, SplashGate, dropServiceWorker } from '@/features/kiosk/KioskFrame'

// Wstrzykiwane przez Vite z pliku conf tego kiosku (vite.config.ts).
declare const __MASOWANIE_VERSION__: string

installGlobalErrorLogger()
dropServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <TooltipProvider>
          <KioskGuards />
          {/* Wrapper h-screen/w-screen — dzieci używają h-full/w-full */}
          <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
            <SplashGate department="masowanie" label="Masowanie" channel="masowanie" version={__MASOWANIE_VERSION__}>
              <MasowanieHmiPage />
            </SplashGate>
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
