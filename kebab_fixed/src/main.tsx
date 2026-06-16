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
