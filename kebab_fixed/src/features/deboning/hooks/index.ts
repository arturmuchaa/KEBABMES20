/**
 * deboning/hooks/index.ts
 *
 * Hooki modułu rozbioru.
 * Cała logika biznesowa tutaj.
 * Komponenty/strony: tylko render + wywołanie hooków.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { deboningApi } from '../api'
import {
  getTimeWindowStatus, getProductionDate,
  checkWriteAccess, validateDeboningEntry,
} from '../utils'
import { isExpired } from '@/lib/utils/fefo'
import type {
  ProductionSession, DeboningEntry, TimeWindowStatus, WriteCheckResult,
  CreateDeboningEntryDto, UpdateDeboningEntryDto, SessionSummary,
  CreateDeboningTakeDto, CompleteDeboningTakeDto, WeighPartTakeDto,
} from '../types'

// ─── 1. useTimeWindow — stan okna czasowego, tick co minutę ──────────────────

export function useTimeWindow(session: ProductionSession | null): TimeWindowStatus {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Tick co 30 sekund — wystarczy do odświeżania komunikatów
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  return getTimeWindowStatus(session, now)
}

// ─── 2. useProductionSession — zarządzanie sesją dnia ────────────────────────

export function useProductionSession() {
  const { data: activeSession, loading, error, refetch } = useApi(
    () => deboningApi.getActiveSession('deboning')
  )
  const { data: todaySessions, refetch: refetchToday } = useApi(
    () => deboningApi.getTodaySessions('deboning')
  )

  const startMutation   = useMutation(() => deboningApi.startSession({ processType: 'deboning' }))
  const closeMutation   = useMutation((id: string) => deboningApi.closeSession(id, {}))
  const approveMutation = useMutation(
    ({ id, by }: { id: string; by: string }) =>
      deboningApi.approveSession(id, { approvedBy: by })
  )

  const timeWindow = useTimeWindow(activeSession ?? null)

  // Polling co 60s — wykrycie auto-approve (18:00)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    pollRef.current = setInterval(() => {
      refetch()
      refetchToday()
    }, 60_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refetch, refetchToday])

  const startDay = useCallback(async (): Promise<string | null> => {
    if (activeSession) {
      return `Sesja już trwa (${activeSession.sessionDate})`
    }
    try {
      await startMutation.mutate()
      refetch()
      refetchToday()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd startu sesji'
    }
  }, [timeWindow, activeSession, startMutation, refetch, refetchToday])

  const closeDay = useCallback(async (): Promise<string | null> => {
    if (!activeSession) return 'Brak aktywnej sesji'
    if (activeSession.status !== 'open') return 'Sesja nie jest otwarta'
    try {
      await closeMutation.mutate(activeSession.id)
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zamknięcia sesji'
    }
  }, [activeSession, closeMutation, refetch])

  const approveDay = useCallback(async (approvedBy = 'office'): Promise<string | null> => {
    if (!activeSession) return 'Brak sesji do zatwierdzenia'
    if (activeSession.status === 'approved') return 'Sesja już zatwierdzona'
    try {
      await approveMutation.mutate({ id: activeSession.id, by: approvedBy })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zatwierdzenia'
    }
  }, [activeSession, approveMutation, refetch])

  return {
    session:       activeSession ?? null,
    todaySessions: todaySessions ?? [],
    timeWindow,
    loading,
    error,
    startDay,
    closeDay,
    approveDay,
    startLoading:   startMutation.loading,
    closeLoading:   closeMutation.loading,
    approveLoading: approveMutation.loading,
    refetch,
  }
}

// ─── 3. useDeboningEntries — wpisy rozbioru w sesji ──────────────────────────

export function useDeboningEntries(sessionId: string | null) {
  const { data: entries, loading, error, refetch } = useApi(
    () => sessionId ? deboningApi.listEntries(sessionId) : Promise.resolve([] as DeboningEntry[]),
    [sessionId],
  )

  // Polling co 5s — wpisy z tabletu widoczne w biurze na bieżąco
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!sessionId) return
    pollRef.current = setInterval(() => refetch(), 5_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [sessionId, refetch])

  const createMutation = useMutation((dto: CreateDeboningEntryDto) => deboningApi.createEntry(dto))
  // Ostatnio utworzony wpis — dla przycisku „Cofnij" (sygnatura addEntry
  // zostaje string|null, bo używa jej 10 starszych stron HMI).
  const [lastCreated, setLastCreated] = useState<DeboningEntry | null>(null)
  const updateMutation = useMutation(({ id, dto }: { id: string; dto: UpdateDeboningEntryDto }) =>
    deboningApi.updateEntry(id, dto)
  )
  const removeMutation = useMutation((id: string) => deboningApi.deleteEntry(id))

  // Zapis wpisu — walidacja przed wysyłką
  const addEntry = useCallback(async (
    dto: CreateDeboningEntryDto,
    session: ProductionSession | null,
    kgAvailable: number,
    expiryDate: string,
  ): Promise<string | null> => {
    // Sprawdzenie sesji (bez blokady czasowej — backend decyduje)
    if (!session) return 'Brak aktywnej sesji. Rozpocznij dzień produkcyjny.'
    if (session.status === 'closed') return 'Sesja zamknięta — nie można dodawać wpisów.'
    if (session.status === 'approved') return 'Sesja zatwierdzona — dane zablokowane.'

    // HACCP — przeterminowana partia
    if (isExpired(expiryDate)) {
      return 'Partia przeterminowana — użycie zabronione (HACCP)'
    }

    // Walidacja domenowa
    const valError = validateDeboningEntry(dto.kgTaken, dto.kgMeat, kgAvailable)
    if (valError) return valError

    try {
      const created = await createMutation.mutate(dto)
      setLastCreated(created ?? null)
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zapisu wpisu'
    }
  }, [createMutation, refetch])

  const createTakeMutation = useMutation((dto: CreateDeboningTakeDto) => deboningApi.createTake(dto))
  const completeTakeMutation = useMutation(
    ({ id, dto }: { id: string; dto: CompleteDeboningTakeDto }) => deboningApi.completeTake(id, dto)
  )

  // Pobranie ćwiartki (mięso później) — walidacja przed wysyłką
  const addTake = useCallback(async (
    dto: CreateDeboningTakeDto,
    session: ProductionSession | null,
    kgAvailable: number,
    expiryDate: string,
  ): Promise<string | null> => {
    if (!session) return 'Brak aktywnej sesji. Rozpocznij dzień produkcyjny.'
    if (session.status !== 'open') return 'Sesja niedostępna do zapisu.'
    if (isExpired(expiryDate)) return 'Partia przeterminowana — użycie zabronione (HACCP)'
    if (dto.kgTaken <= 0) return 'Ilość pobranej ćwiartki musi być > 0'
    if (dto.kgTaken > kgAvailable + 0.01)
      return `⛔ Nie można pobrać ${dto.kgTaken} kg — dostępne tylko ${kgAvailable.toFixed(2)} kg`
    try {
      await createTakeMutation.mutate(dto)
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zapisu pobrania'
    }
  }, [createTakeMutation, refetch])

  const updateTakeMutation = useMutation(
    ({ id, kg }: { id: string; kg: number }) => deboningApi.updateTake(id, kg)
  )

  // Edycja otwartego pobrania (kg ćwiartki) — tylko przy otwartej sesji.
  const editTake = useCallback(async (
    entryId: string,
    kgTaken: number,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    if (session?.status !== 'open') return 'Edycja możliwa tylko przy otwartej sesji'
    if (kgTaken <= 0) return 'Ilość pobranej ćwiartki musi być > 0'
    try {
      await updateTakeMutation.mutate({ id: entryId, kg: kgTaken })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd edycji pobrania'
    }
  }, [updateTakeMutation, refetch])

  const weighPartMutation = useMutation(
    ({ id, dto }: { id: string; dto: WeighPartTakeDto }) => deboningApi.weighPart(id, dto)
  )

  // Częściowe ważenie mięsa — porcja na magazyn, pobranie zostaje otwarte
  const weighPart = useCallback(async (
    entryId: string,
    dto: WeighPartTakeDto,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    if (session?.status !== 'open') return 'Ważenie możliwe tylko przy otwartej sesji'
    if (dto.kgMeat <= 0) return 'Ilość mięsa musi być > 0'
    try {
      await weighPartMutation.mutate({ id: entryId, dto })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd częściowego ważenia'
    }
  }, [weighPartMutation, refetch])

  // Domknięcie pobrania mięsem
  const completeTake = useCallback(async (
    entryId: string,
    dto: CompleteDeboningTakeDto,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    if (session?.status !== 'open') return 'Domknięcie możliwe tylko przy otwartej sesji'
    if (dto.kgMeat <= 0) return 'Ilość mięsa musi być > 0'
    try {
      await completeTakeMutation.mutate({ id: entryId, dto })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd domknięcia pobrania'
    }
  }, [completeTakeMutation, refetch])

  const editEntry = useCallback(async (
    entryId: string,
    dto: UpdateDeboningEntryDto,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    // Edycja możliwa tylko przy otwartej sesji
    if (session?.status !== 'open') {
      return 'Edycja możliwa tylko przy otwartej sesji'
    }
    try {
      await updateMutation.mutate({ id: entryId, dto })
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd edycji wpisu'
    }
  }, [updateMutation, refetch])

  // Storno wpisu (przycisk „Cofnij" na HMI) — backend odwraca stany magazynowe
  const removeEntry = useCallback(async (
    entryId: string,
    session: ProductionSession | null,
  ): Promise<string | null> => {
    if (session?.status !== 'open') {
      return 'Cofnięcie możliwe tylko przy otwartej sesji'
    }
    try {
      await removeMutation.mutate(entryId)
      refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd cofnięcia wpisu'
    }
  }, [removeMutation, refetch])

  return {
    entries: entries ?? [],
    loading,
    error,
    addEntry,
    addTake,
    completeTake,
    weighPart,
    editTake,
    editEntry,
    removeEntry,
    lastCreated,
    addLoading:    createMutation.loading,
    addTakeLoading:      createTakeMutation.loading,
    completeTakeLoading: completeTakeMutation.loading,
    weighPartLoading:    weighPartMutation.loading,
    editLoading:   updateMutation.loading,
    removeLoading: removeMutation.loading,
    refetch,
  }
}

// ─── 4. useSessionSummary — podsumowanie HACCP sesji ─────────────────────────

export function useSessionSummary(sessionId: string | null) {
  const { data, loading } = useApi(
    () => sessionId
      ? deboningApi.getSessionSummary(sessionId)
      : Promise.resolve(null as SessionSummary | null),
    [sessionId],
  )
  return { summary: data ?? null, loading }
}
