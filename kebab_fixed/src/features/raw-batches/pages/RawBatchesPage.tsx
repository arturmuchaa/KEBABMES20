/**
 * RawBatchesPage — shadcn/ui
 */
import { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Plus, AlertTriangle, CheckCircle } from 'lucide-react'
import { useRawBatches, useCreateRawBatch } from '../hooks/useRawBatches'
import { RawBatchesTable }    from '../components/RawBatchesTable'
import { CreateRawBatchModal } from '../components/CreateRawBatchModal'
import { EditRawBatchModal, type EditRawBatchFormData } from '../components/EditRawBatchModal'
import { rawBatchesApi } from '../api'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
import { toast } from 'sonner'
import type { RawBatch } from '@/types'

function mapExpiryToUi(expiry: { level: string; daysLeft: number } | null) {
  if (!expiry) return null
  const map: Record<string, { label: string; colorCls: string }> = {
    OK:       { label: 'OK',              colorCls: 'bg-green-100 text-green-700' },
    WARNING:  { label: 'Wkrótce',         colorCls: 'bg-amber-100 text-amber-700' },
    CRITICAL: { label: 'Krytyczne',       colorCls: 'bg-red-100 text-red-700' },
    EXPIRED:  { label: 'Przeterminowane', colorCls: 'bg-red-700 text-white' },
  }
  const ui = map[expiry.level] ?? { label: expiry.level, colorCls: 'bg-gray-200' }
  return { level: expiry.level, ...ui }
}

export function RawBatchesPage() {
  const { batches, supplierOptions, loading, refetch } = useRawBatches()

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editBatch,   setEditBatch]   = useState<RawBatch | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError,   setEditError]   = useState<string | null>(null)

  const handleEditOpen = useCallback((batch: RawBatch) => {
    setEditBatch(batch)
    setEditError(null)
  }, [])

  const handleEditClose = useCallback(() => {
    setEditBatch(null)
    setEditError(null)
  }, [])

  const handleEditSubmit = useCallback(async (data: EditRawBatchFormData) => {
    if (!editBatch) return
    setEditLoading(true)
    setEditError(null)
    try {
      await rawBatchesApi.edit(editBatch.id, {
        supplierBatchNo: data.supplierBatchNo,
        slaughterDate:   data.slaughterDate,
        receivedDate:    data.receivedDate,
        expiryDate:      data.expiryDate,
        kgReceived:      data.kgReceived,
        pricePerKg:      data.pricePerKg,
        invoiceNo:       data.invoiceNo,
        notes:           data.notes,
      } as any)
      setEditBatch(null)
      refetch()
      toast.success(`Partia ${editBatch.internalBatchNo} zaktualizowana`)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Błąd zapisu')
    } finally {
      setEditLoading(false)
    }
  }, [editBatch, refetch])

  const {
    form, suggestedBatchNo, suggestedNote, open, expiryPreview,
    confirmOpen, validationResult, mutationLoading, mutationError,
    openModal, closeModal, requestSubmit, confirmSubmit, cancelConfirm, updateField,
  } = useCreateRawBatch(
    useCallback((batchNo: string, kg: number) => {
      refetch()
      toast.success(`Partia ${batchNo} przyjęta — ${kg.toFixed(2).replace('.', ',')} kg`)
    }, [refetch]),
  )

  const expiryPreviewMapped = useMemo(() => mapExpiryToUi(expiryPreview), [expiryPreview])
  const warnings = validationResult?.ok ? validationResult.warnings : []

  const handleSubmit = useCallback(async () => {
    const err = await requestSubmit()
    if (err) toast.error(err)
  }, [requestSubmit])

  const handleConfirm = useCallback(async () => {
    const err = await confirmSubmit()
    if (err) toast.error(err)
  }, [confirmSubmit])

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="text-base">Partie ćwiartki — widok operacyjny</CardTitle>
          <CardDescription className="mt-0.5">
            Tylko aktywne · sortowanie FEFO · odświeża co 5s
          </CardDescription>
        </div>
        <Button onClick={openModal}>
          <Plus size={15} className="mr-1.5" /> Przyjmij partię
        </Button>
      </div>

      <Separator />

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <RawBatchesTable batches={batches} loading={loading} onEdit={handleEditOpen} />
        </CardContent>
      </Card>

      {/* Modal formularza */}
      <CreateRawBatchModal
        open={open}
        onClose={closeModal}
        onSubmit={handleSubmit}
        form={form}
        suggestedBatchNo={suggestedBatchNo}
        suggestedNote={suggestedNote}
        expiryPreview={expiryPreviewMapped}
        totalValue={0}
        supplierOptions={supplierOptions}
        loading={mutationLoading}
        error={mutationError}
        onFieldChange={updateField}
      />

      {/* Modal edycji */}
      <EditRawBatchModal
        open={editBatch !== null}
        batch={editBatch}
        loading={editLoading}
        error={editError}
        onClose={handleEditClose}
        onSubmit={handleEditSubmit}
      />

      {/* Krok 2 — potwierdzenie */}
      <Dialog open={confirmOpen} onOpenChange={v => { if (!v) cancelConfirm() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Potwierdź przyjęcie partii</DialogTitle>
            <DialogDescription>
              Sprawdź dane przed zapisem w systemie.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Card>
              <CardContent className="p-0 divide-y">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Sugerowany nr partii</CardDescription>
                  <code className="font-mono font-bold text-primary">{suggestedBatchNo || '—'}</code>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Waga</CardDescription>
                  <CardTitle className="text-sm tabular-nums">{fmtKg(form.kgReceived)} kg</CardTitle>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Data ważności</CardDescription>
                  <CardTitle className="text-sm">{fmtDatePl(form.expiryDate)}</CardTitle>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Wartość netto</CardDescription>
                  <CardTitle className="text-sm tabular-nums">
                    {fmtPln(form.kgReceived * form.pricePerKg)}
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
                  Numer partii zostanie potwierdzony przez system po zapisie.
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
