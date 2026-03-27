/**
 * RawBatchesPage — cienka powłoka.
 * Zero logiki. Składa hooki + komponenty.
 * Jeśli coś zmienia się funkcjonalnie → edytuj hook.
 */
import { useState, useCallback, useMemo } from 'react'
import { Card, CardHeader, Toast, Modal } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Plus, AlertTriangle, CheckCircle } from 'lucide-react'
import { useRawBatches, useCreateRawBatch } from '../hooks/useRawBatches'
import { RawBatchesTable }    from '../components/RawBatchesTable'
import { CreateRawBatchModal } from '../components/CreateRawBatchModal'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'

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

interface ToastState { msg: string; type: 'success'|'error'; visible: boolean }
const HIDDEN: ToastState = { msg: '', type: 'success', visible: false }

export function RawBatchesPage() {
  const [toast, setToast] = useState<ToastState>(HIDDEN)

  const showToast = useCallback((msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(HIDDEN), 3500)
  }, [])

  const { batches, supplierOptions, loading, refetch } = useRawBatches()

  const {
    form, suggestedBatchNo, suggestedNote, open, totalValue, expiryPreview,
    confirmOpen, validationResult, mutationLoading, mutationError,
    openModal, closeModal, requestSubmit, confirmSubmit, cancelConfirm, updateField,
  } = useCreateRawBatch(
    useCallback((batchNo: string, kg: number) => {
      refetch()
      showToast(`Partia ${batchNo} przyjęta — ${kg.toFixed(2).replace('.', ',')} kg`)
    }, [refetch, showToast]),
  )

  const expiryPreviewMapped = useMemo(() => mapExpiryToUi(expiryPreview), [expiryPreview])

  const handleSubmit = useCallback(async () => {
    const err = await requestSubmit()
    if (err) showToast(err, 'error')
  }, [requestSubmit, showToast])

  const handleConfirm = useCallback(async () => {
    const err = await confirmSubmit()
    if (err) showToast(err, 'error')
  }, [confirmSubmit, showToast])

  // Ostrzeżenia z walidacji (nie blokujące)
  const warnings = validationResult?.ok ? validationResult.warnings : []

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Nagłówek + przycisk */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-900">
            Partie ćwiartki — widok operacyjny
          </h2>
          <p className="text-[11px] text-slate-900-3 mt-0.5">
            Tylko aktywne · FEFO · max 25 rekordów · odświeża co 5s
          </p>
        </div>
        <Button icon={<Plus size={14} />} onClick={openModal}>
          Przyjmij partię
        </Button>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-slate-200 rounded-xl">
        <RawBatchesTable batches={batches} loading={loading} />
      </div>

      {/* Modal formularza */}
      <CreateRawBatchModal
        open={open}
        onClose={closeModal}
        onSubmit={handleSubmit}
        form={form}
        suggestedBatchNo={suggestedBatchNo}
        suggestedNote={suggestedNote}
        expiryPreview={expiryPreviewMapped}
        totalValue={totalValue}
        supplierOptions={supplierOptions}
        loading={mutationLoading}
        error={mutationError}
        onFieldChange={updateField}
      />

      {/* Modal potwierdzenia — krok 2 przed zapisem */}
      <Modal
        open={confirmOpen}
        onClose={cancelConfirm}
        title="Potwierdź przyjęcie partii"
        size="sm"
      >
        <div className="space-y-4">
          {/* Dane do potwierdzenia */}
          <div className="border border-slate-200 divide-y divide-slate-100 text-[13px]">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-slate-900-3">Sugerowany nr partii</span>
              <span className="font-mono font-bold text-blue-600">{suggestedBatchNo || '—'}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-slate-900-3">Waga</span>
              <span className="font-bold">{fmtKg(form.kgReceived)} kg</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-slate-900-3">Data ważności</span>
              <span className="font-semibold">{fmtDatePl(form.expiryDate)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-slate-900-3">Wartość netto</span>
              <span className="font-semibold">{fmtPln(form.kgReceived * form.pricePerKg)}</span>
            </div>
          </div>

          {/* Ostrzeżenia walidacji — widoczne przy potwierdzeniu */}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  {w.message}
                </div>
              ))}
            </div>
          )}

          <div className="text-[11px] text-slate-900-3 bg-slate-50 px-3 py-2">
            Numer partii zostanie potwierdzony przez system po zapisie.
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={cancelConfirm}>
              Anuluj
            </Button>
            <Button
              fullWidth
              loading={mutationLoading}
              icon={<CheckCircle size={14} />}
              onClick={handleConfirm}
            >
              Potwierdź
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
