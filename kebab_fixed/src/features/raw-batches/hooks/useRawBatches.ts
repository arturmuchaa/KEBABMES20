/**
 * useRawBatches — logika modułu raw-batches.
 *
 * Zasady:
 *   - cała logika biznesowa tutaj, zero w komponentach
 *   - API wywołania tylko przez rawBatchesApi
 *   - FEFO sort jako helper (docelowo: po stronie backendu)
 *   - polling co 5 sekund (zastąp WebSocket gdy gotowy)
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { suppliersApi }        from '@/lib/apiClient'
import {
  sortFefo, getExpiryStatus, checkUsability, isExpired,
  isHighPriority,
} from '@/lib/utils/fefo'
import { todayIso }       from '@/lib/utils'
import { rawBatchesApi }  from '../api'
import type {
  RawBatch, CreateRawBatchDto, EditRawBatchDto, CancelRawBatchDto,
  SupplierOption, ValidationResult, EditLockResult,
  RawBatchHistoryEntry,
} from '../types'

// ─── Stałe operacyjne ─────────────────────────────────────────────────────────
const POLL_INTERVAL_MS  = 5_000   // auto-refetch co 5s
const OPERATIONAL_LIMIT = 25      // max partii w widoku operacyjnym

// ─── useRawBatches ────────────────────────────────────────────────────────────

export function useRawBatches() {
  const { data, loading, error, refetch } = useApi(() => rawBatchesApi.list())
  const suppliers = useApi(() => suppliersApi.list())

  // Polling co 5 sekund — real-time dla wielu użytkowników
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    intervalRef.current = setInterval(() => { refetch() }, POLL_INTERVAL_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [refetch])

  // Backend zwraca już posortowane i ograniczone dane (active_only, FEFO, limit 25)
  // sortFefo() tutaj jako safety net gdy backend nie obsługuje jeszcze sortowania
  const batches = sortFefo(data?.data ?? []).slice(0, OPERATIONAL_LIMIT)

  // HACCP alerty — partie wygasające ≤ 2 dni (CRITICAL) lub ≤ 3 dni (WARNING)
  const haccpAlerts = batches.filter(b => {
    const s = getExpiryStatus(b.expiryDate)
    return s.level === 'CRITICAL' || s.level === 'EXPIRED'
  })

  // Partie dostępne do rozbioru (dla tabletu)
  const availableForDeboning = batches.filter(b => {
    const expiry = getExpiryStatus(b.expiryDate)
    const { usable } = checkUsability(expiry, { kgAvailable: Number(b.kgAvailable) })
    return usable
  })

  const totalKgAvailable = availableForDeboning.reduce(
    (sum, b) => sum + Number(b.kgAvailable), 0
  )

  const supplierOptions: SupplierOption[] = (suppliers.data ?? []).map(s => ({
    value: s.id, label: s.name,
  }))

  return {
    batches,
    availableForDeboning,
    haccpAlerts,
    totalKgAvailable,
    supplierOptions,
    loading,
    error,
    refetch,
  }
}

// ─── Walidacja — pełna, rozdzielona na ERROR i WARNING ────────────────────────
//
// Zwraca ValidationResult — nie throw, nie string.
// Komponenty nie decydują co jest błędem — hook decyduje.

function validateCreate(f: CreateRawBatchDto): ValidationResult {
  const warnings = []
  const today = todayIso()

  // ERROR — blokuje zapis
  if (!f.supplierId)             return { ok: false, warnings, error: { type: 'error', message: 'Wybierz dostawcę' } }
  if (!f.slaughterDate)          return { ok: false, warnings, error: { type: 'error', message: 'Podaj datę uboju' } }
  if (!f.receivedDate)           return { ok: false, warnings, error: { type: 'error', message: 'Podaj datę przyjęcia' } }
  if (!f.expiryDate)             return { ok: false, warnings, error: { type: 'error', message: 'Podaj datę ważności' } }

  if (f.slaughterDate > today)
    return { ok: false, warnings, error: { type: 'error', message: 'Data uboju nie może być w przyszłości' } }

  if (f.slaughterDate > f.receivedDate)
    return { ok: false, warnings, error: { type: 'error', message: 'Data uboju nie może być późniejsza niż data przyjęcia' } }

  if (f.expiryDate < f.receivedDate)
    return { ok: false, warnings, error: { type: 'error', message: 'Data ważności nie może być wcześniejsza niż data przyjęcia' } }

  // HACCP — przeterminowany surowiec — twarda blokada
  if (isExpired(f.expiryDate))
    return { ok: false, warnings, error: { type: 'error', message: 'Partia przeterminowana — użycie zabronione (HACCP)' } }

  const shelfDays = Math.floor(
    (new Date(f.expiryDate).getTime() - new Date(f.slaughterDate).getTime()) / 86_400_000
  )
  if (shelfDays < 1)
    return { ok: false, warnings, error: { type: 'error', message: 'Termin ważności zbyt krótki (min. 1 dzień od uboju)' } }

  if (!f.kgReceived || f.kgReceived <= 0)
    return { ok: false, warnings, error: { type: 'error', message: 'Podaj ilość kg (> 0)' } }

  if (f.kgReceived > 10_000)
    return { ok: false, warnings, error: { type: 'error', message: 'Ilość kg przekracza 10 000 — sprawdź wartość' } }

  if (!f.pricePerKg || f.pricePerKg <= 0)
    return { ok: false, warnings, error: { type: 'error', message: 'Podaj cenę za kg (> 0)' } }

  // WARNING — informuje, nie blokuje
  if (shelfDays > 30)
    warnings.push({ type: 'warning' as const, message: `Termin ważności ${shelfDays} dni od uboju — sprawdź datę` })

  if (f.pricePerKg > 50)
    warnings.push({ type: 'warning' as const, message: `Cena ${f.pricePerKg} zł/kg jest wysoka — sprawdź` })

  // HIGH PRIORITY — partia wygasa ≤ 2 dni (oznaczenie, nie blokada)
  if (isHighPriority(f.expiryDate))
    warnings.push({ type: 'warning' as const, message: 'Partia HIGH PRIORITY — wygasa ≤ 2 dni, użyj natychmiast' })

  return { ok: true, warnings }
}

// ─── checkEditLock — czy partia może być edytowana? ──────────────────────────

export function checkEditLock(batch: RawBatch): EditLockResult {
  if (batch.status === 'cancelled') return {
    locked: true, reason: 'cancelled', message: 'Partia anulowana — nie można edytować',
  }
  if (Number(batch.kgUsed) > 0) return {
    locked: true, reason: 'used', message: 'Partia jest lub była używana w rozbiorze',
  }
  if (batch.isInUse) return {
    locked: true, reason: 'in_use', message: 'Trwa sesja rozbioru tej partii',
  }
  if (isExpired(batch.expiryDate)) return {
    locked: true, reason: 'expired_haccp', message: 'Partia przeterminowana — edycja zabroniona (HACCP)',
  }
  return { locked: false }
}

// ─── Pusty formularz ──────────────────────────────────────────────────────────

function emptyForm(): CreateRawBatchDto {
  return {
    supplierId: '', supplierBatchNo: '', slaughterDate: '',
    receivedDate: todayIso(), expiryDate: '', kgReceived: 0, pricePerKg: 0, invoiceNo: '',
  }
}

// ─── useCreateRawBatch ────────────────────────────────────────────────────────

export function useCreateRawBatch(
  onSuccess: (confirmedBatchNo: string, kg: number) => void
) {
  const [form,             setForm]           = useState<CreateRawBatchDto>(emptyForm())
  const [suggestedBatchNo, setSuggested]      = useState<string>('')
  const [suggestedNote,    setNote]           = useState<string>('')
  const [open,             setOpen]           = useState(false)
  // Modal potwierdzenia przed zapisem
  const [confirmOpen,      setConfirmOpen]    = useState(false)
  // Wynik walidacji z ostrzeżeniami
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  const mutation = useMutation((dto: CreateRawBatchDto) => rawBatchesApi.create(dto))

  const totalValue = (form.kgReceived > 0 && form.pricePerKg > 0)
    ? form.kgReceived * form.pricePerKg : 0

  const expiryPreview = form.expiryDate ? getExpiryStatus(form.expiryDate) : null

  const openModal = useCallback(async () => {
    setForm(emptyForm())
    setValidationResult(null)
    mutation.clearError()
    try {
      const res = await rawBatchesApi.nextNumber()
      setSuggested(res.suggestedBatchNo)
      setNote(res.note)
    } catch {
      setSuggested('')
      setNote('Numer zostanie nadany przez system')
    }
    setOpen(true)
  }, []) // eslint-disable-line

  const closeModal = useCallback(() => {
    setOpen(false)
    setConfirmOpen(false)
    setValidationResult(null)
    mutation.clearError()
  }, []) // eslint-disable-line

  // Krok 1: walidacja + sprawdzenie duplikatów → otwórz modal potwierdzenia
  const requestSubmit = useCallback(async (): Promise<string | null> => {
    const result = validateCreate(form)
    setValidationResult(result)

    if (!result.ok) return result.error.message

    // Sprawdzenie duplikatów (osobne zapytanie)
    try {
      const isDuplicate = await rawBatchesApi.checkDuplicate(
        form.supplierId, form.supplierBatchNo, form.slaughterDate
      )
      if (isDuplicate) {
        return `Partia ${form.supplierBatchNo} od tego dostawcy z datą uboju ${form.slaughterDate} już istnieje`
      }
    } catch { /* brak duplikatu = OK */ }

    setConfirmOpen(true)
    return null
  }, [form])

  // Krok 2: użytkownik potwierdził → faktyczny zapis
  const confirmSubmit = useCallback(async (): Promise<string | null> => {
    try {
      const created = await mutation.mutate(form)
      setOpen(false)
      setConfirmOpen(false)
      onSuccess(created.internalBatchNo, created.kgReceived)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zapisu'
    }
  }, [form, mutation, onSuccess])

  const cancelConfirm = useCallback(() => {
    setConfirmOpen(false)
  }, [])

  const updateField = useCallback(
    <K extends keyof CreateRawBatchDto>(key: K, value: CreateRawBatchDto[K]) => {
      setForm(prev => ({ ...prev, [key]: value }))
    }, [],
  )

  return {
    form,
    suggestedBatchNo,
    suggestedNote,
    open,
    confirmOpen,
    validationResult,
    totalValue,
    expiryPreview,
    mutationLoading: mutation.loading,
    mutationError:   mutation.error,
    openModal,
    closeModal,
    requestSubmit,   // krok 1 — walidacja + otwiera confirm
    confirmSubmit,   // krok 2 — faktyczny zapis po potwierdzeniu
    cancelConfirm,   // zamknięcie confirm bez zapisu
    updateField,
    // legacy alias — używany przez RawBatchesPage do obsługi "Zapisz" w modalu
    submit: requestSubmit,
  }
}

// ─── useBatchHistory ──────────────────────────────────────────────────────────

export function useBatchHistory(batchId: string | null) {
  const { data, loading, refetch } = useApi(
    () => batchId ? rawBatchesApi.history(batchId) : Promise.resolve([] as RawBatchHistoryEntry[]),
    [batchId],
  )
  return { history: data ?? [], loading, refetch }
}

// ─── computeDisplayStatus — re-eksport z fefo.ts dla spójności importów ──────
import { deriveRawBatchStatus } from '@/lib/utils/fefo'
import type { RawBatchStatus }  from '../types'

export function computeDisplayStatus(batch: RawBatch): RawBatchStatus {
  if (batch.status === 'cancelled') return 'cancelled'
  return deriveRawBatchStatus(batch.expiryDate, Number(batch.kgAvailable))
}
