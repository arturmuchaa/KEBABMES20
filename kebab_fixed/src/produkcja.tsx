/**
 * produkcja.tsx — samodzielny entry dla Tauri „Produkcja HMI".
 *
 * Drugie stanowisko hali. Wygląd i obsługa jak w kiosku rozbiorowym (wspólna
 * rama + wspólny motyw), zasady działania jak w tablecie produkcji: operator
 * widzi plan dnia i odhacza wykonane sztuki.
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ProductionHmiPage } from '@/pages/tablet/ProductionHmiPage'
import { KioskGuards, SplashGate, dropServiceWorker } from '@/features/kiosk/KioskFrame'

// Wstrzykiwane przez Vite z pliku conf tego kiosku (vite.config.ts).
declare const __PRODUKCJA_VERSION__: string

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
            <SplashGate department="produkcja" label="Produkcja" channel="produkcja" version={__PRODUKCJA_VERSION__}>
              <ProductionHmiPage />
            </SplashGate>
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
