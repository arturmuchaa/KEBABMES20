/**
 * ReceptionFormPage — rejestracja dostawy na PEŁNEJ STRONIE.
 *
 * Zastępuje okno modalne: formularz przyjęcia bywa długi (kilkanaście pozycji
 * HDI, kilka numerów porządkowych, podgląd stopki dokumentu), a w okienku
 * wszystko to walczyło o miejsce z paskiem przewijania. Ten sam wzorzec ma już
 * edytor planu produkcji (`ProductionPlanEditorPage`).
 *
 * Stan formularza mieszka TUTAJ (`useCreateReception`), nie na liście dostaw —
 * strona listy nie musi już nic wiedzieć o rejestracji.
 */
import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

import { fmtKg, fmtPln, fmtDatePl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

import { ReceptionForm } from '../components/ReceptionForm'
import { useCreateReception, useEditReception } from '../hooks/useRawBatches'
import { useApi } from '@/hooks/useApi'
import { suppliersApi } from '@/lib/apiClient'
import type { SupplierOption } from '../types'

const LIST_PATH = '/office/raw-batches'

export function ReceptionFormPage() {
  const { receptionId } = useParams()
  // Ta sama strona obsługuje rejestrację i poprawianie dostawy — formularz
  // ma być JEDEN, żeby edycja nie została z połową pól, jak stary modal.
  if (receptionId) return <ReceptionEditPage receptionId={receptionId} />
  return <ReceptionCreatePage />
}

function ReceptionCreatePage() {
  const navigate = useNavigate()
  // Rodzaj surowca przychodzi z zakładki, z której operator kliknął „Nowe
  // przyjęcie" — dotąd wstrzykiwała go strona listy.
  const [params] = useSearchParams()
  const matId = params.get('rodzaj') || 'mat-cwiartka'

  // Sama kartoteka dostawców — bez wciągania całej listy partii, której ta
  // strona nie pokazuje.
  const suppliers = useApi(() => suppliersApi.list())
  const supplierOptions: SupplierOption[] = (suppliers.data ?? []).map(
    s => ({ value: s.id, label: s.name }))

  const {
    header, updateHeader, openModal, confirmOpen, cancelConfirm, pending,
    validationResult, suggestedReceptionNo, suggestedBatchNo,
    mutationLoading, mutationError, requestSubmit, confirmSubmit,
  } = useCreateReception((receptionNo, batchNos, kg) => {
    toast.success(
      `Przyjęcie ${receptionNo} — ${kg.toFixed(2).replace('.', ',')} kg` +
      ` (nr porządkowy: ${batchNos.join(', ')})`)
    navigate(LIST_PATH)
  })

  // Podpowiedzi numerów wczytujemy przy wejściu na stronę — dotąd robiło to
  // otwarcie okna.
  useEffect(() => { void openModal() }, [openModal])

  useEffect(() => {
    updateHeader('materialTypeId', matId)
    // Usługa dotyczy tylko mięsa z/s — przy innym surowcu tryb musi zgasnąć,
    // inaczej backend odrzuciłby zapis (400) mimo ukrytego przełącznika.
    if (matId !== 'mat-mieso-zs') updateHeader('isService', false)
  }, [matId, updateHeader])

  const warnings = validationResult?.ok ? validationResult.warnings : []
  const pendingKg = pending.reduce((s, g) => s + g.kg, 0)

  const handleSubmit = async (groups: Parameters<typeof requestSubmit>[0]) => {
    const err = await requestSubmit(groups)
    if (err) toast.error(err)
  }

  const handleConfirm = async () => {
    const err = await confirmSubmit()
    if (err) toast.error(err)
  }

  return (
    <div>
      <ReceptionForm
        onClose={() => navigate(LIST_PATH)}
        onSubmit={handleSubmit}
        header={header}
        suggestedReceptionNo={suggestedReceptionNo}
        suggestedBatchNo={suggestedBatchNo}
        supplierOptions={supplierOptions}
        loading={mutationLoading}
        error={mutationError}
        onHeaderChange={updateHeader}
      />

    <Dialog open={confirmOpen} onOpenChange={v => { if (!v) cancelConfirm() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Potwierdź przyjęcie dostawy</DialogTitle>
          <DialogDescription>
            Sprawdź podział dostawy przed zapisem w systemie.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-0 divide-y">
              <div className="flex items-center justify-between px-4 py-2.5">
                <CardDescription>Numer przyjęcia</CardDescription>
                <code className="font-mono font-bold text-primary">
                  {header.receptionNo || suggestedReceptionNo || '—'}
                </code>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <CardDescription>Cała dostawa</CardDescription>
                <CardTitle className="text-sm tabular-nums">{fmtKg(pendingKg)} kg</CardTitle>
              </div>
              {/* Podział na numery porządkowe — to jest właśnie ta decyzja,
                  której nie da się już cofnąć jednym kliknięciem po zapisie. */}
              {pending.map(g => (
                <div key={g.index} className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>
                    Numer porządkowy {g.batchNo ?? `#${g.index + 1}`}
                    <span className="block font-mono text-[11px] text-ink-3">
                      {g.supplierNos.join(', ') || 'bez partii dostawcy'}
                    </span>
                  </CardDescription>
                  <div className="text-right">
                    <CardTitle className="text-sm tabular-nums">{fmtKg(g.kg)} kg</CardTitle>
                    <CardDescription className="text-[11px]">
                      do {fmtDatePl(g.expiryDate)}
                    </CardDescription>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2.5">
                <CardDescription>Wartość netto</CardDescription>
                <CardTitle className="text-sm tabular-nums">
                  {fmtPln(pendingKg * header.pricePerKg)}
                </CardTitle>
              </div>
            </CardContent>
          </Card>

          {/* Ostrzeżenia walidacji */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <Card key={i} className="border-amber-200 bg-amber-50">
                  <CardContent className="px-3 py-2 flex items-start gap-2">
                    <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <CardDescription className="text-amber-700">{w.message}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="bg-muted/40 border-transparent">
            <CardContent className="px-3 py-2">
              <CardDescription className="text-xs">
                Numery — przyjęcia i porządkowe — nadaje system przy zapisie;
                powyższe to podpowiedzi. Gdy w tej samej chwili ktoś zarejestruje
                dostawę z drugiego stanowiska, faktyczne numery mogą wyjść wyższe.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={cancelConfirm} disabled={mutationLoading}>
            Anuluj
          </Button>
          <Button onClick={handleConfirm} disabled={mutationLoading} className="gap-2">
            {mutationLoading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <CheckCircle size={14} />
            }
            Potwierdź
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    </div>
  )
}

function ReceptionEditPage({ receptionId }: { receptionId: string }) {
  const navigate = useNavigate()
  const suppliers = useApi(() => suppliersApi.list())
  const supplierOptions: SupplierOption[] = (suppliers.data ?? []).map(
    s => ({ value: s.id, label: s.name }))

  const {
    header, updateHeader, groups, frozen, receptionNo, loaded,
    loading, error, submit,
  } = useEditReception(receptionId, no => {
    toast.success(`Dostawa ${no} zapisana`)
    navigate(LIST_PATH)
  })

  if (!loaded) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {error ?? 'Wczytywanie dostawy…'}
      </div>
    )
  }

  return (
    <ReceptionForm
      mode="edit"
      initialGroups={groups}
      frozen={frozen}
      onClose={() => navigate(LIST_PATH)}
      onSubmit={async g => { const err = await submit(g); if (err) toast.error(err) }}
      header={header}
      suggestedReceptionNo={receptionNo}
      suggestedBatchNo=""
      supplierOptions={supplierOptions}
      loading={loading}
      error={error}
      onHeaderChange={updateHeader}
    />
  )
}
