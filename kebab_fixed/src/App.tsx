import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { OfficeLayout }  from '@/layouts/OfficeLayout'
import { TabletLayout }  from '@/layouts/TabletLayout'
import { DashboardPage } from '@/pages/office/DashboardPage'
import { RawBatchesPage }from '@/pages/office/RawBatchesPage'
import { ReceptionFormPage } from '@/features/raw-batches/pages/ReceptionFormPage'
import { ReceptionPreviewPage } from '@/features/raw-batches/pages/ReceptionPreviewPage'
import { ReceptionTagsPage } from '@/features/raw-batches/pages/ReceptionTagsPage'
import { WorkersPage }   from '@/pages/office/WorkersPage'
import { WorkHoursPage } from '@/pages/office/WorkHoursPage'
import { SuppliersPage } from '@/pages/office/SuppliersPage'
import { ClientsPage }   from '@/pages/office/ClientsPage'
import { RawStockPage }  from '@/pages/office/RawStockPage'
import { SpiceStockPage }from '@/pages/office/SpiceStockPage'
import { IngredientReceptionPage } from '@/pages/office/IngredientReceptionPage'
import { IngredientLabelsPage } from '@/pages/office/IngredientLabelsPage'
import { DdfipRegisterPrintPage } from '@/pages/office/DdfipRegisterPrintPage'
import { SeasonedMeatPage } from '@/pages/office/SeasonedMeatPage'
import { MixingHistoryPage } from '@/pages/office/MixingHistoryPage'
import { ProductionHistoryPage } from '@/pages/office/ProductionHistoryPage'
import { AnalitykaPage } from '@/pages/office/AnalitykaPage'
import { AuditLogPage } from '@/pages/office/AuditLogPage'
import { PackagingPage } from '@/pages/office/PackagingPage'
import { DeboningReportsPage } from '@/pages/office/DeboningReportsPage'
import { WorkerCardPage }        from '@/pages/office/WorkerCardPage'
import { DeboningControlPage } from '@/pages/office/DeboningControlPage'
import { HaccpReportPage } from '@/pages/office/HaccpReportPage'
import { PartnerListsPage } from '@/pages/office/PartnerListsPage'
import { PlaceholderPage }     from '@/pages/office/PlaceholderPage'
import { FinishedGoodsPage }   from '@/pages/office/FinishedGoodsPage'
import { PurchaseInvoicesPage } from '@/pages/office/PurchaseInvoicesPage'
import { ClientOrdersPage } from '@/pages/office/ClientOrdersPage'
import { CostCalculatorPage } from '@/pages/office/CostCalculatorPage'
import { OrderPrintPage }   from '@/pages/office/OrderPrintPage'
import { OrderEntryPage }   from '@/features/orders/order-entry/OrderEntryPage'
import { PalletLabelPrintPage } from '@/pages/office/PalletLabelPrintPage'
import { LabelPrintPage }       from '@/pages/office/LabelPrintPage'
import { StockCartonLabelPage }  from '@/pages/office/StockCartonLabelPage'
import { ZebraPrintPage }       from '@/pages/office/ZebraPrintPage'
import { ZebraDesignerPage }    from '@/pages/office/ZebraDesignerPage'
import { HdiPrintPage }         from '@/pages/office/HdiPrintPage'
import { CmrPrintPage }         from '@/pages/office/CmrPrintPage'
import { BatchReportPage }      from '@/pages/office/BatchReportPage'
import { HdiDocumentsPage }     from '@/pages/office/HdiDocumentsPage'
import { CmrDocumentsPage }     from '@/pages/office/CmrDocumentsPage'
import { WzPrintPage }          from '@/pages/office/WzPrintPage'
import { DeboningReportPrintPage } from '@/pages/office/DeboningReportPrintPage'
import { MixingPlanPrintPage }    from '@/pages/office/MixingPlanPrintPage'
import { PaySlipsPrintPage }     from '@/pages/office/PaySlipsPrintPage'
import { ProductionCardPrintPage } from '@/pages/office/ProductionCardPrintPage'
import { ProductionReportPrintPage } from '@/pages/office/ProductionReportPrintPage'
import { ProductionReportsPage } from '@/pages/office/ProductionReportsPage'
import { SanitaryCheckPrintPage } from '@/pages/office/SanitaryCheckPrintPage'
import { TemperatureLogPrintPage } from '@/pages/office/TemperatureLogPrintPage'
import { SanitaryCheckHistoryPage } from '@/pages/office/SanitaryCheckHistoryPage'
import { TemperatureLogHistoryPage } from '@/pages/office/TemperatureLogHistoryPage'
import {
  ReceptionRegisterPrintPage, ReceptionRegisterDetailPrintPage,
} from '@/pages/office/ReceptionRegisterPrintPage'
import { ReceptionRegisterHistoryPage } from '@/pages/office/ReceptionRegisterHistoryPage'
import { WzDocumentsPage }      from '@/pages/office/WzDocumentsPage'
import { WzNewPage }            from '@/pages/office/WzNewPage'
import { ContainerBalancePage } from '@/pages/office/ContainerBalancePage'
import { ContainerPartnerPage } from '@/pages/office/ContainerPartnerPage'
import { ContainerDocPrintPage }       from '@/pages/office/ContainerDocPrintPage'
import { ContainerStatementPrintPage } from '@/pages/office/ContainerStatementPrintPage'
import { CmrLayoutConfigPage }  from '@/pages/office/CmrLayoutConfigPage'
import { CarriersPage }         from '@/pages/office/CarriersPage'
import { LabelTemplateSetupPage } from '@/pages/office/LabelTemplateSetupPage'
import { CompanySettingsPage } from '@/pages/office/CompanySettingsPage'
import { ProductionPlanningPage } from '@/pages/office/ProductionPlanningPage'
import { MeatPalletsPage } from '@/pages/office/MeatPalletsPage'
import { ProductionPlanEditorPage } from '@/pages/office/ProductionPlanEditorPage'
import { RecallPage }             from '@/pages/office/RecallPage'
import { MixingHmiV2Page }        from '@/pages/tablet/MixingHmiV2Page'
import { TracePage }              from '@/pages/office/TracePage'
import { PayrollPage }            from '@/pages/office/PayrollPage'
import { UsersPage }              from '@/pages/office/UsersPage'
import { VehiclesPage }           from '@/pages/office/VehiclesPage'
import { LabelTemplatesPage }     from '@/pages/office/LabelTemplatesPage'
import { ProductTypesPage, RecipesPage, PlanningPage } from '@/features/products'
import { ProductCatalogPage } from '@/pages/office/ProductCatalogPage'
import { RozbiorRoute }        from '@/pages/tablet/RozbiorRoute'
import { MixingTabletPage }    from '@/pages/tablet/MixingTabletPage'
import { MieszanieRoute }      from '@/pages/tablet/MieszanieRoute'
import { ProductionTabletPage }from '@/pages/tablet/ProductionTabletPage'
import { MobilePickerPage }         from '@/pages/mobile/MobilePickerPage'
import { MobileMrozniaPage }        from '@/pages/mobile/MobileMrozniaPage'
import { MobileVehiclePickerPage }  from '@/pages/mobile/MobileVehiclePickerPage'
import { MobileZaladunekPage }      from '@/pages/mobile/MobileZaladunekPage'
import { MobilePalletLandingPage }  from '@/pages/mobile/MobilePalletLandingPage'
import { MobileProdukcjaPage }      from '@/pages/mobile/MobileProdukcjaPage'
import { MobilePakowaniePage }      from '@/pages/mobile/MobilePakowaniePage'
import { MobileWydanieLuzemPage }   from '@/pages/mobile/MobileWydanieLuzemPage'
import { MobilePrzeplywPartiiPage } from '@/pages/mobile/MobilePrzeplywPartiiPage'
import { MobileSztukaPage }         from '@/pages/mobile/MobileSztukaPage'
import { LoginPage }               from '@/pages/auth/LoginPage'
import { ChangePasswordPage }      from '@/pages/auth/ChangePasswordPage'
import { PanelLoginPage }          from '@/pages/auth/PanelLoginPage'
import { RequireOffice, RequireDepartment } from '@/features/auth/guards'

// ─── Blokada przypadkowego odświeżenia ───────────────────────
// Ostrzegaj TYLKO przy realnie niezapisanych zmianach, nie przy każdym
// aktywnym polu (np. wyszukiwarka/filtr nie mogą blokować nawigacji).
// Wyzwalacze: otwarty modal edycji (`[role="dialog"]`) lub element jawnie
// oznaczony `[data-unsaved="true"]` (formularz może to ustawić gdy „dirty").
function useBlockRefresh() {
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const active = document.activeElement as HTMLElement | null
      const hasUnsaved =
        document.querySelector('[data-unsaved="true"]') !== null ||
        (active?.closest('[role="dialog"]') ?? null) !== null
      if (hasUnsaved) {
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
    <Routes>
      {/* Standalone print pages — bez sidebara */}
      <Route path="/office/zamowienia/:id/druk" element={<OrderPrintPage />} />
      <Route path="/office/zamowienia/:id/palety/:palletNo/druk" element={<PalletLabelPrintPage />} />
      <Route path="/etykiety/druk"    element={<LabelPrintPage />} />
      <Route path="/etykiety/karton/:id" element={<StockCartonLabelPage />} />
      {/* Stary edytor etykiet Zebra (ZPL) wyłączony — używamy wizualnego Projektanta Zebra */}
      <Route path="/etykiety/zebra-edytor" element={<Navigate to="/etykiety/zebra-designer" replace />} />
      <Route path="/etykiety/zebra"   element={<ZebraPrintPage />} />
      <Route path="/etykiety/zebra-designer" element={<ZebraDesignerPage />} />
      <Route path="/office/hdi/:id/druk" element={<HdiPrintPage />} />
      <Route path="/office/cmr/:id/druk" element={<CmrPrintPage />} />
      <Route path="/office/wz/:id/druk" element={<WzPrintPage />} />
      <Route path="/office/rozbior-raport/druk" element={<DeboningReportPrintPage />} />
      <Route path="/office/plan-masowania/druk" element={<MixingPlanPrintPage />} />
      <Route path="/office/wyplaty/druk" element={<PaySlipsPrintPage />} />
      <Route path="/office/plan-produkcji/druk" element={<ProductionCardPrintPage />} />
      <Route path="/office/zalecenie-produkcyjne/druk" element={<ProductionReportPrintPage />} />
      <Route path="/office/arkusz-kontroli/druk" element={<SanitaryCheckPrintPage />} />
      <Route path="/office/kontrola-temperatury/druk" element={<TemperatureLogPrintPage />} />
      <Route path="/office/rejestr-przyjecia/druk" element={<ReceptionRegisterPrintPage />} />
      {/* Karta 1.3.1 — ta sama oprawa co 1.1.1, inne źródło danych. */}
      <Route path="/office/rejestr-ddfip/druk" element={<DdfipRegisterPrintPage />} />
      <Route path="/office/rejestr-przyjecia-szczegolowy/druk" element={<ReceptionRegisterDetailPrintPage />} />
      {/* Statyczna ścieżka PRZED parametryczną — 'raport' nie może wpaść jako :id */}
      <Route path="/office/pojemniki/raport/druk" element={<ContainerStatementPrintPage />} />
      <Route path="/office/pojemniki/:id/druk" element={<ContainerDocPrintPage />} />
      <Route path="/office/partia/:batchNo/raport" element={<BatchReportPage />} />
      <Route path="/etykiety/szablon" element={<LabelTemplateSetupPage />} />

      {/* Mobile — skan QR palet (poza OfficeLayout) */}
      <Route path="/mobile"                          element={<MobilePickerPage />} />
      <Route path="/mobile/mroznia"                  element={<MobileMrozniaPage />} />
      <Route path="/mobile/zaladunek"                element={<MobileVehiclePickerPage />} />
      <Route path="/mobile/zaladunek/:vehicleId"     element={<MobileZaladunekPage />} />
      <Route path="/m/p/:orderId/:palletNo"          element={<MobilePalletLandingPage />} />
      <Route path="/mobile/produkcja"               element={<MobileProdukcjaPage />} />
      <Route path="/mobile/pakowanie"               element={<MobilePakowaniePage />} />
      <Route path="/mobile/wydanie"                 element={<MobileWydanieLuzemPage />} />
      <Route path="/mobile/przeplyw"                element={<MobilePrzeplywPartiiPage />} />
      <Route path="/mobile/sztuka"                  element={<MobileSztukaPage />} />

      <Route path="/office" element={<RequireOffice><OfficeLayout /></RequireOffice>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"             element={<DashboardPage />} />
        <Route path="dostawcy"              element={<SuppliersPage />} />
        <Route path="kontrahenci"           element={<ClientsPage />} />
        <Route path="zamowienia"            element={<ClientOrdersPage />} />
        <Route path="zamowienia/nowe"       element={<OrderEntryPage />} />
        <Route path="zamowienia/:id/edycja" element={<OrderEntryPage />} />
        <Route path="hdi"                   element={<HdiDocumentsPage />} />
        <Route path="wz"                    element={<WzDocumentsPage />} />
        <Route path="wz/nowy"               element={<WzNewPage />} />
        <Route path="saldo-pojemnikow"      element={<ContainerBalancePage />} />
        <Route path="saldo-pojemnikow/:partnerId" element={<ContainerPartnerPage />} />
        <Route path="przewoznicy"           element={<CarriersPage />} />
        <Route path="cmr"                   element={<CmrDocumentsPage />} />
        <Route path="cmr-konfigurator"      element={<CmrLayoutConfigPage />} />
        <Route path="faktury"               element={<PurchaseInvoicesPage />} />
        <Route path="raw-batches"           element={<RawBatchesPage />} />
        <Route path="raw-batches/nowe"      element={<ReceptionFormPage />} />
        <Route path="raw-batches/:receptionId/podglad" element={<ReceptionPreviewPage />} />
        <Route path="raw-batches/:receptionId/edycja" element={<ReceptionFormPage />} />
        <Route path="raw-batches/:receptionId/zawieszki" element={<ReceptionTagsPage />} />
        <Route path="magazyn/surowiec"      element={<RawStockPage />} />
        <Route path="magazyn/przyprawy"     element={<SpiceStockPage />} />
        {/* Przyjęcie DDFiP — instrukcja 1.3 oPRP; osobna seria numerów DF. */}
        <Route path="przyjecie-ddfip"       element={<IngredientReceptionPage />} />
        <Route path="przyjecie-ddfip/:receptionId/etykiety" element={<IngredientLabelsPage />} />
        <Route path="magazyn/mieso-przyp"   element={<SeasonedMeatPage />} />
        <Route path="magazyn/opakowania"    element={<PackagingPage />} />
        <Route path="magazyn/gotowe"        element={<FinishedGoodsPage />} />
        <Route path="deboning"              element={<DeboningReportsPage />} />
        <Route path="palety-miesa"        element={<MeatPalletsPage />} />
        <Route path="rozbior-panel"         element={<DeboningControlPage />} />
        <Route path="kartoteka-pracownika"  element={<WorkerCardPage />} />
        <Route path="haccp-report"          element={<HaccpReportPage />} />
        <Route path="wykazy-kontrahentow"   element={<PartnerListsPage />} />
        {/* Historie kart HACCP — menu prowadzi TU, nie prosto do druku */}
        <Route path="arkusz-kontroli"       element={<SanitaryCheckHistoryPage />} />
        <Route path="kontrola-temperatury"  element={<TemperatureLogHistoryPage />} />
        <Route path="rejestr-przyjecia"     element={<ReceptionRegisterHistoryPage />} />
        <Route path="zalecenia-produkcyjne" element={<ProductionReportsPage />} />
        <Route path="rodzaje-produktow"     element={<ProductTypesPage />} />
        {/* Katalog wyrobów — rodzaj × receptura × tuleja × gramatura z kodem. */}
        <Route path="katalog-wyrobow"       element={<ProductCatalogPage />} />
        <Route path="receptury"             element={<RecipesPage />} />
        <Route path="szablony-etykiet"      element={<LabelTemplatesPage />} />
        <Route path="kalkulacja-kosztow"    element={<CostCalculatorPage />} />
        <Route path="planowanie-masowania"  element={<PlanningPage />} />
        <Route path="historia-masowania"    element={<MixingHistoryPage />} />
        <Route path="historia-produkcji"    element={<ProductionHistoryPage />} />
        <Route path="analityka"             element={<AnalitykaPage />} />
        <Route path="planowanie-produkcji"  element={<ProductionPlanningPage />} />
        <Route path="planowanie-produkcji/nowy"       element={<ProductionPlanEditorPage />} />
        <Route path="planowanie-produkcji/:id/edytuj" element={<ProductionPlanEditorPage />} />
        <Route path="pracownicy"            element={<WorkersPage />} />
        <Route path="godziny"               element={<WorkHoursPage />} />
        <Route path="rozliczenia"           element={<PayrollPage />} />
        <Route path="sledzenie"             element={<TracePage />} />
        <Route path="recall"                element={<RecallPage />} />
        <Route path="samochody"             element={<VehiclesPage />} />
        <Route path="ustawienia"            element={<CompanySettingsPage />} />
        <Route path="uzytkownicy"           element={<UsersPage />} />
        <Route path="audyt"                 element={<AuditLogPage />} />
      </Route>
      <Route path="/tablet" element={<TabletLayout />}>
        <Route path="rozbior"          element={<RequireDepartment dept="rozbior"><RozbiorRoute /></RequireDepartment>} />
        <Route path="mieszanie"        element={<RequireDepartment dept="produkcja"><MieszanieRoute /></RequireDepartment>} />
        <Route path="mieszanie-v2"     element={<RequireDepartment dept="produkcja"><MixingHmiV2Page /></RequireDepartment>} />
        <Route path="mieszanie-mobile" element={<RequireDepartment dept="produkcja"><MixingTabletPage /></RequireDepartment>} />
        <Route path="produkcja"        element={<RequireDepartment dept="produkcja"><ProductionTabletPage /></RequireDepartment>} />
      </Route>
      <Route path="/login"        element={<LoginPage />} />
      <Route path="/zmiana-hasla" element={<ChangePasswordPage />} />
      <Route path="/panel"        element={<PanelLoginPage />} />
      <Route path="*" element={<Navigate to="/office/dashboard" replace />} />
    </Routes>
  )
}
