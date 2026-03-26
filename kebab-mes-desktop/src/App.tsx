import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from '@/store/config'
import { AppLayout } from '@/layouts/AppLayout'
import { SetupPage }          from '@/pages/SetupPage'
import { DashboardPage }      from '@/pages/DashboardPage'
import { StockPage }          from '@/pages/StockPage'
import { SettingsPage }       from '@/pages/SettingsPage'
import { SuppliersPage }      from '@/pages/SuppliersPage'
import { ClientsPage }        from '@/pages/ClientsPage'
import { ClientOrdersPage }   from '@/pages/ClientOrdersPage'
import { InvoicesPage }       from '@/pages/InvoicesPage'
import { RawBatchesPage }     from '@/pages/RawBatchesPage'
import { SpiceStockPage }     from '@/pages/SpiceStockPage'
import { SeasonedMeatPage }   from '@/pages/SeasonedMeatPage'
import { PackagingPage }      from '@/pages/PackagingPage'
import { FinishedGoodsPage }  from '@/pages/FinishedGoodsPage'
import { ByproductBatchesPage } from '@/pages/ByproductBatchesPage'
import { DeboningPage }       from '@/pages/DeboningPage'
import { HaccpPage }          from '@/pages/HaccpPage'
import { ProductTypesPage }   from '@/pages/ProductTypesPage'
import { RecipesPage }        from '@/pages/RecipesPage'
import { MixingPlanPage }     from '@/pages/MixingPlanPage'
import { ProductionPlanPage } from '@/pages/ProductionPlanPage'
import { WorkersPage }        from '@/pages/WorkersPage'
import { UsersPage }          from '@/pages/UsersPage'
import { MixingPage }         from '@/features/mixing/MixingPage'
import { TraceabilityPage }   from '@/features/traceability/TraceabilityPage'

function RequireConfig({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <Navigate to="/setup" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />

      <Route path="/" element={<RequireConfig><AppLayout /></RequireConfig>}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route path="dashboard"       element={<DashboardPage />} />

        {/* Kontrahenci */}
        <Route path="suppliers"       element={<SuppliersPage />} />
        <Route path="clients"         element={<ClientsPage />} />
        <Route path="orders"          element={<ClientOrdersPage />} />

        {/* Zakupy */}
        <Route path="invoices"        element={<InvoicesPage />} />

        {/* Magazyny */}
        <Route path="raw-batches"     element={<RawBatchesPage />} />
        <Route path="stock"           element={<StockPage />} />
        <Route path="spice-stock"     element={<SpiceStockPage />} />
        <Route path="seasoned-meat"   element={<SeasonedMeatPage />} />
        <Route path="packaging"       element={<PackagingPage />} />
        <Route path="finished-goods"  element={<FinishedGoodsPage />} />
        <Route path="byproducts"      element={<ByproductBatchesPage />} />

        {/* Rozbiór */}
        <Route path="deboning"        element={<DeboningPage />} />
        <Route path="haccp"           element={<HaccpPage />} />

        {/* Produkcja */}
        <Route path="product-types"   element={<ProductTypesPage />} />
        <Route path="recipes"         element={<RecipesPage />} />
        <Route path="mixing"          element={<MixingPlanPage />} />
        <Route path="mixing/new"      element={<MixingPage />} />
        <Route path="production-plans" element={<ProductionPlanPage />} />

        {/* Traceability */}
        <Route path="traceability"           element={<TraceabilityPage />} />
        <Route path="traceability/:batchId"  element={<TraceabilityPage />} />

        {/* Administracja */}
        <Route path="workers"         element={<WorkersPage />} />
        <Route path="users"           element={<UsersPage />} />

        {/* Ustawienia */}
        <Route path="settings"        element={<SettingsPage />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to={isConfigured() ? '/dashboard' : '/setup'} replace />} />
    </Routes>
  )
}
