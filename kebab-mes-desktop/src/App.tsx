import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from '@/store/config'
import { AppLayout } from '@/layouts/AppLayout'
import { SetupPage }      from '@/pages/SetupPage'
import { DashboardPage }  from '@/pages/DashboardPage'
import { StockPage }      from '@/pages/StockPage'
import { SettingsPage }   from '@/pages/SettingsPage'
import { MixingPage }     from '@/features/mixing/MixingPage'
import { TraceabilityPage } from '@/features/traceability/TraceabilityPage'

function RequireConfig({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <Navigate to="/setup" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      {/* First-run setup — no layout shell */}
      <Route path="/setup" element={<SetupPage />} />

      {/* Main app — requires API configured */}
      <Route
        path="/"
        element={
          <RequireConfig>
            <AppLayout />
          </RequireConfig>
        }
      >
        {/* Default redirect */}
        <Route index element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard */}
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Produkcja */}
        <Route path="mixing"    element={<MixingPage />} />

        {/* Jakość / Traceability */}
        <Route path="traceability"            element={<TraceabilityPage />} />
        <Route path="traceability/:batchId"   element={<TraceabilityPage />} />

        {/* Magazyn */}
        <Route path="stock" element={<StockPage />} />

        {/* Ustawienia */}
        <Route path="settings" element={<SettingsPage />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Root catch-all */}
      <Route path="*" element={<Navigate to={isConfigured() ? '/dashboard' : '/setup'} replace />} />
    </Routes>
  )
}
