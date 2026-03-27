import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { OfficeLayout }  from '@/layouts/OfficeLayout'
import { TabletLayout }  from '@/layouts/TabletLayout'
import { DashboardPage } from '@/pages/office/DashboardPage'
import { RawBatchesPage }from '@/pages/office/RawBatchesPage'
import { WorkersPage }   from '@/pages/office/WorkersPage'
import { SuppliersPage } from '@/pages/office/SuppliersPage'
import { ClientsPage }   from '@/pages/office/ClientsPage'
import { RawStockPage }  from '@/pages/office/RawStockPage'
import { SpiceStockPage }from '@/pages/office/SpiceStockPage'
import { SeasonedMeatPage } from '@/pages/office/SeasonedMeatPage'
import { PackagingPage } from '@/pages/office/PackagingPage'
import { DeboningReportsPage } from '@/pages/office/DeboningReportsPage'
import { HaccpReportPage } from '@/pages/office/HaccpReportPage'
import { PlaceholderPage }     from '@/pages/office/PlaceholderPage'
import { FinishedGoodsPage }   from '@/pages/office/FinishedGoodsPage'
import { PurchaseInvoicesPage } from '@/pages/office/PurchaseInvoicesPage'
import { ClientOrdersPage } from '@/pages/office/ClientOrdersPage'
import { ProductionPlanningPage } from '@/pages/office/ProductionPlanningPage'
import { ProductTypesPage, RecipesPage, PlanningPage } from '@/features/products'
import { TraceabilityPage }    from '@/pages/office/TraceabilityPage'
import { ByproductBatchesPage } from '@/pages/office/ByproductBatchesPage'
import { DeboningTabletPage }  from '@/pages/tablet/DeboningTabletPage'
import { MixingTabletPage }    from '@/pages/tablet/MixingTabletPage'
import { ProductionTabletPage }from '@/pages/tablet/ProductionTabletPage'

// ─── Blokada przypadkowego odświeżenia ───────────────────────
function useBlockRefresh() {
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      // Sprawdź czy jest aktywny input/textarea/select
      const active = document.activeElement
      const isInForm = active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        (active as HTMLElement).closest('[data-form]') !== null ||
        (active as HTMLElement).closest('[role="dialog"]') !== null
      )
      if (isInForm) {
        e.preventDefault()
        e.returnValue = 'Masz niezapisane dane. Na pewno chcesz opuścić stronę?'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])
}

export default function App() {
  useBlockRefresh()
  return (
    <>
    <Toaster
      theme="light"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'bg-surface border border-surface-4 text-ink shadow-card rounded-xl',
          description: 'text-ink-3',
          actionButton: 'bg-brand text-white',
          error: 'border-danger/30',
          success: 'border-success/30',
          warning: 'border-warn/30',
        },
      }}
    />
    <Routes>
      <Route path="/office" element={<OfficeLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"             element={<DashboardPage />} />
        <Route path="dostawcy"              element={<SuppliersPage />} />
        <Route path="kontrahenci"           element={<ClientsPage />} />
        <Route path="zamowienia"            element={<ClientOrdersPage />} />
        <Route path="faktury"               element={<PurchaseInvoicesPage />} />
        <Route path="raw-batches"           element={<RawBatchesPage />} />
        <Route path="magazyn/surowiec"      element={<RawStockPage />} />
        <Route path="magazyn/przyprawy"     element={<SpiceStockPage />} />
        <Route path="magazyn/mieso-przyp"   element={<SeasonedMeatPage />} />
        <Route path="magazyn/opakowania"    element={<PackagingPage />} />
        <Route path="magazyn/gotowe"        element={<FinishedGoodsPage />} />
        <Route path="deboning"              element={<DeboningReportsPage />} />
        <Route path="haccp-report"          element={<HaccpReportPage />} />
        <Route path="rodzaje-produktow"     element={<ProductTypesPage />} />
        <Route path="receptury"             element={<RecipesPage />} />
        <Route path="planowanie-masowania"  element={<PlanningPage />} />
        <Route path="planowanie-produkcji"  element={<ProductionPlanningPage />} />
        <Route path="pracownicy"            element={<WorkersPage />} />
        <Route path="uzytkownicy"           element={<PlaceholderPage title="Użytkownicy" icon="🔐" description="" />} />
        <Route path="traceability"          element={<TraceabilityPage />} />
        <Route path="traceability/:batchId" element={<TraceabilityPage />} />
        <Route path="magazyn/produkty-uboczne" element={<ByproductBatchesPage />} />
      </Route>
      <Route path="/tablet" element={<TabletLayout />}>
        <Route path="rozbior"   element={<DeboningTabletPage />} />
        <Route path="mieszanie" element={<MixingTabletPage />} />
        <Route path="produkcja" element={<ProductionTabletPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/office/dashboard" replace />} />
    </Routes>
    </>
  )
}
