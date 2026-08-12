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
  getExpiryStatus, checkUsability, isExpired,
  isHighPriority,
} from '@/lib/utils/fefo'
import { todayIso }       from '@/lib/utils'
import { rawBatchesApi }  from '../api'
import { receptionsApi }  from '@/lib/apiClient'
import type { ReceptionGroup } from '../receptionSplit'
import type {
  RawBatch, CreateRawBatchDto, EditRawBatchDto, CancelRawBatchDto,
  SupplierOption, ValidationResult, ValidationWarning, EditLockResult,
  RawBatchHistoryEntry, ReceptionHeader, CreateReceptionDto,
} from '../types'

// ─── Stałe operacyjne ─────────────────────────────────────────────────────────
const POLL_INTERVAL_MS  = 5_000   // auto-refetch co 5s

// ─── useRawBatches ────────────────────────────────────────────────────────────

export function useRawBatches() {
  // Przyjęcie = HISTORIA dostaw (wszystkie partie, od najnowszej), nie widok
  // stanu — żywy stan ćwiartki mieszka w Magazynie surowca (zakładka Ćwiartka).
  const { data, loading, error, refetch } = useApi(
    () => rawBatchesApi.list({ active_only: false, limit: 500 }),
  )
  const suppliers = useApi(() => suppliersApi.list())

  // Polling co 5 sekund — real-time dla wielu użytkowników
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    intervalRef.current = setInterval(() => { refetch() }, POLL_INTERVAL_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [refetch])

  const batches: RawBatch[] = [...((data as any)?.data ?? [])].sort((a: any, b: any) =>
    String(b.receivedDate ?? b.createdAt ?? '').localeCompare(String(a.receivedDate ?? a.createdAt ?? ''))
    || String(b.internalBatchNo ?? '').localeCompare(String(a.internalBatchNo ?? ''), 'pl', { numeric: true }),
  )

  // HACCP alerty — partie z ŻYWYM stanem wygasające (historyczne zużyte nie alarmują)
  const haccpAlerts = batches.filter(b => {
    if (Number(b.kgAvailable) <= 0) return false
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
  const warnings: ValidationWarning[] = []
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

  // Twarda blokada dopiero przy wartości niemożliwej dla jednej dostawy —
  // łapie literówkę z dodatkowym zerem (15 000 → 150 000), a nie duży transport.
  if (f.kgReceived > 30_000)
    return { ok: false, warnings, error: { type: 'error', message: 'Ilość kg przekracza 30 000 — sprawdź, czy nie ma dodatkowego zera' } }

  // Na usłudze mięso jest KLIENTA — nie kupujemy go, więc cena nie obowiązuje.
  if (!f.isService && (!f.pricePerKg || f.pricePerKg <= 0))
    return { ok: false, warnings, error: { type: 'error', message: 'Podaj cenę za kg (> 0)' } }

  // WARNING — informuje, nie blokuje
  if (f.kgReceived > 10_000)
    warnings.push({ type: 'warning' as const, message: `Duża dostawa: ${f.kgReceived.toLocaleString('pl-PL')} kg — potwierdź, że się zgadza` })

  if (shelfDays > 30)
    warnings.push({ type: 'warning' as const, message: `Termin ważności ${shelfDays} dni od uboju — sprawdź datę` })

  if (f.pricePerKg > 50)
    warnings.push({ type: 'warning' as const, message: `Cena ${f.pricePerKg} zł/kg jest wysoka — sprawdź` })

  // HIGH PRIORITY — partia wygasa ≤ 2 dni (oznaczenie, nie blokada)
  if (isHighPriority(f.expiryDate))
    warnings.push({ type: 'warning' as const, message: 'Partia HIGH PRIORITY — wygasa ≤ 2 dni, użyj natychmiast' })

  return { ok: true, warnings }
}

/**
 * validateReception — te same reguły co dla pojedynczej partii, ale liczone
 * PER NUMER PORZĄDKOWY.
 *
 * Daty i kilogramy różnią się między grupami (grupa z partią ubitą dzień
 * wcześniej ma krótszy termin), więc sprawdzenie „całej dostawy" jednym
 * kompletem dat przepuściłoby partię, której nie wolno przyjąć.
 */
export function validateReception(
  header: ReceptionHeader, groups: ReceptionGroup[],
): ValidationResult {
  const warnings: ValidationWarning[] = []
  for (const g of groups) {
    const res = validateCreate({
      supplierId:     header.supplierId,
      supplierBatchNo: g.supplierNos.join(', '),
      slaughterDate:  g.slaughterDate,
      receivedDate:   header.receivedDate,
      expiryDate:     g.expiryDate,
      kgReceived:     g.kg,
      pricePerKg:     header.pricePerKg,
      isService:      header.isService,
    })
    if (res.ok === false) {
      // Bez numeru grupy komunikat „Podaj datę uboju" nie mówi, KTÓRY
      // numer porządkowy jest niekompletny — a przy trzech to zgadywanka.
      const message = groups.length > 1
        ? `Numer porządkowy #${g.index + 1}: ${res.error.message}`
        : res.error.message
      return {
        ok: false,
        warnings: res.warnings,
        error: { type: 'error', message },
      }
    }
    warnings.push(...res.warnings)
  }
  return { ok: true, warnings }
}

// ─── checkEditLock — czy partia może być edytowana? ──────────────────────────

export function checkEditLock(batch: RawBatch): EditLockResult {
  if (batch.status === 'cancelled') return {
    locked: true, reason: 'cancelled', message: 'Partia anulowana — nie można edytować',
  }
  // NIE po kgUsed: backend nie ma kolumny kg_used, więc mapper w lib/api.ts
  // ustawia tam 0 dla KAŻDEJ partii i ten warunek nigdy by nie zadziałał.
  // Zużycie liczymy z różnicy — tak samo jak tabela dostaw.
  if (Number(batch.kgAvailable) < Number(batch.kgReceived)) return {
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

// ─── useCreateReception ───────────────────────────────────────────────────────
//
// Rejestracja CAŁEJ dostawy: jeden numer przyjęcia i tyle numerów
// porządkowych, na ile zakład ją rozbił. Hook trzyma dane wspólne (dostawca,
// data, dokument, cena, nośniki); pozycje HDI i ich podział na numery
// porządkowe żyją w formularzu i przychodzą tu dopiero przy zapisie.

function emptyHeader(): ReceptionHeader {
  return {
    receptionNo: '', receivedDate: todayIso(), supplierId: '',
    materialTypeId: 'mat-cwiartka', documentNo: '', hdiNo: '', hdiScanId: '',
    docKg: 0, docContainers: 0, pricePerKg: 0,
    // Domyślny kaliber zakładu to pojemnik 15 kg — 20 kg zdarza się przy filecie.
    containerKg: 15, palletsH1: 0, palletsOther: 0, palletsOtherKind: 'net_e1',
    isService: false, notes: '',
  }
}

export function useCreateReception(
  onSuccess: (receptionNo: string, batchNos: string[], kg: number) => void,
) {
  const [header,      setHeader]     = useState<ReceptionHeader>(emptyHeader())
  const [open,        setOpen]       = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [suggestedReceptionNo, setSuggestedReceptionNo] = useState('')
  const [suggestedBatchNo,     setSuggestedBatchNo]     = useState('')
  const [pending,     setPending]    = useState<ReceptionGroup[]>([])
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  const mutation = useMutation((dto: CreateReceptionDto) => receptionsApi.create(dto))

  const loadNumbers = useCallback(async (isService: boolean, day: string) => {
    // Dwa NIEZALEŻNE numeratory: dokumentu dostawy (miesięczny) i numeru
    // porządkowego (ciągły). Podpowiedzi, nie fakty — oba nadaje backend przy
    // zapisie, więc równoległe przyjęcie z drugiego stanowiska nic nie psuje.
    try {
      const r = await receptionsApi.nextNumber(day)
      setSuggestedReceptionNo(r.nextNo)
    } catch { setSuggestedReceptionNo('') }
    try {
      const b = await rawBatchesApi.nextNumber(isService)
      setSuggestedBatchNo(b.suggestedBatchNo)
    } catch { setSuggestedBatchNo('') }
  }, [])

  const openModal = useCallback(async () => {
    const fresh = emptyHeader()
    setHeader(fresh)
    setValidationResult(null)
    setPending([])
    mutation.clearError()
    await loadNumbers(false, fresh.receivedDate)
    setOpen(true)
  }, [loadNumbers]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeModal = useCallback(() => {
    setOpen(false)
    setConfirmOpen(false)
    setValidationResult(null)
    mutation.clearError()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const updateHeader = useCallback(<K extends keyof ReceptionHeader>(
    key: K, value: ReceptionHeader[K],
  ) => {
    setHeader(prev => ({ ...prev, [key]: value }))
    // Numeracja przyjęć resetuje się z miesiącem, a numery porządkowe mają
    // osobną serię dla usługi — obie podpowiedzi trzeba odświeżyć.
    if (key === 'receivedDate') loadNumbers(header.isService, String(value))
    if (key === 'isService')    loadNumbers(Boolean(value), header.receivedDate)
  }, [header.isService, header.receivedDate, loadNumbers])

  /** Krok 1 — walidacja całej dostawy; otwiera podsumowanie. */
  const requestSubmit = useCallback(async (groups: ReceptionGroup[]): Promise<string | null> => {
    const result = validateReception(header, groups)
    setValidationResult(result)
    if (result.ok === false) return result.error.message
    setPending(groups)
    setConfirmOpen(true)
    return null
  }, [header])

  /** Krok 2 — zapis. Całe przyjęcie idzie jednym POST-em: backend zakłada
   *  dokument i wszystkie numery porządkowe w JEDNEJ transakcji. */
  const confirmSubmit = useCallback(async (): Promise<string | null> => {
    try {
      const out = await mutation.mutate({
        receptionNo:    header.receptionNo,
        receivedDate:   header.receivedDate,
        supplierId:     header.supplierId,
        materialTypeId: header.materialTypeId,
        documentNo:     header.documentNo,
        hdiNo:          header.hdiNo,
        hdiScanId:      header.hdiScanId,
        // 0 = pole niewypełnione; null zamiast zera, żeby „nie podano" nie
        // udawało zadeklarowanych zerowych kilogramów.
        docKg:          header.docKg || null,
        docContainers:  header.docContainers || null,
        pricePerKg:     header.pricePerKg,
        notes:          header.notes,
        isService:      header.isService,
        groups: pending.map((g, i) => ({
          kgReceived:    g.kg,
          slaughterDate: g.slaughterDate,
          expiryDate:    g.expiryDate,
          supplierBatches: g.lines.map(l => ({
            supplierBatchNo: l.supplierBatchNo.trim(),
            kgReceived:      l.kgReceived,
            slaughterDate:   l.slaughterDate,
            expiryDate:      l.expiryDate,
          })),
          containerKg:      header.containerKg,
          containersCount:  g.containersCount ?? null,
          // Palety liczy się na całą dostawę, nie per numer porządkowy —
          // saldo nośników jest per DOSTAWCA, więc obojętne, która partia je
          // niesie; wieszamy je na pierwszej, żeby nie policzyć ich N razy.
          palletsH1:        i === 0 ? header.palletsH1 : 0,
          palletsOther:     i === 0 ? header.palletsOther : 0,
          palletsOtherKind: header.palletsOtherKind,
        })),
      })
      setOpen(false)
      setConfirmOpen(false)
      onSuccess(
        out.reception?.reception_no ?? '',
        out.batches.map(b => b.internalBatchNo),
        out.batches.reduce((s, b) => s + Number(b.kgReceived), 0),
      )
      return null
    } catch (e) {
      setConfirmOpen(false)
      return e instanceof Error ? e.message : 'Błąd zapisu'
    }
  }, [header, pending, mutation, onSuccess])

  const cancelConfirm = useCallback(() => setConfirmOpen(false), [])

  return {
    header, updateHeader,
    open, openModal, closeModal,
    confirmOpen, cancelConfirm,
    pending, validationResult,
    suggestedReceptionNo, suggestedBatchNo,
    mutationLoading: mutation.loading,
    mutationError:   mutation.error,
    requestSubmit, confirmSubmit,
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
