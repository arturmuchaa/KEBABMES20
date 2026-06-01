/**
 * rozbior-v7.tsx — samodzielny entry dla Tauri HMI v7 "Precision Light".
 *
 * Renderuje WYŁĄCZNIE DeboningHmiV7Page bezpośrednio — bez TabletLayout,
 * bez przełącznika wersji, bez routera. Aplikacja przeznaczona wyłącznie
 * na panel PC 21" z systemem Windows (fullscreen, kiosk).
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DeboningHmiV7Page } from '@/pages/tablet/DeboningHmiV7Page'

installGlobalErrorLogger()

// Blokady operatorskie: brak menu kontekstowego, brak F5/F11/F12/Alt+F4
function KioskGuards() {
  useEffect(() => {
    const noCtx = (e: MouseEvent) => e.preventDefault()
    const noKeys = (e: KeyboardEvent) => {
      const k = e.key
      if (
        k === 'F5' || k === 'F11' || k === 'F12' ||
        ((e.ctrlKey || e.metaKey) && (k === 'r' || k === 'R')) ||
        (e.altKey && k === 'F4')
      ) {
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
      <TooltipProvider>
        <KioskGuards />
        {/* Wrapper h-screen/w-screen — DeboningHmiV7Page używa h-full/w-full */}
        <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
          <DeboningHmiV7Page />
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
