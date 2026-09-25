/**
 * magazyn.tsx — samodzielny entry dla Tauri „Magazyn HMI".
 *
 * Czwarte stanowisko hali. Rama i motyw jak w rozbiorze, produkcji i masowni:
 * ludzie chodzą między stanowiskami i nie mają się uczyć drugiego wyglądu.
 *
 * BEZ ROUTERA i bez stron biura — do bundla wchodzi tylko łańcuch
 * MagazynHmiPage + features/magazyn/* + lib/api + features/auth.
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthContext'
import { MagazynHmiPage } from '@/pages/tablet/MagazynHmiPage'
import { KioskGuards, SplashGate, dropServiceWorker } from '@/features/kiosk/KioskFrame'

// Wstrzykiwane przez Vite z pliku conf tego kiosku (vite.config.ts).
declare const __MAGAZYN_VERSION__: string

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
            <SplashGate department="magazyn" label="Magazyn" channel="magazyn" version={__MAGAZYN_VERSION__}>
              <MagazynHmiPage />
            </SplashGate>
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
