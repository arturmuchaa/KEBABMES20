/**
 * useProcessSession — pollowanie statusu sesji procesu (deboning / mixing / production).
 *
 * Stany:
 *   session.status='open'   → operator pracuje (LIVE)
 *   session.status='closed' → operator zakończył, biuro musi potwierdzić
 *   session = null & todayApproved=true → biuro już zatwierdziło dziś (Zakończono)
 *   session = null & todayApproved=false → brak sesji (Oczekuje / fallback dataActive)
 *
 * active() filtruje 'approved' więc po approve trzeba osobno sprawdzić listę
 * dzisiejszych sesji żeby wiedzieć czy dzień jest już domknięty.
 */
import { useEffect, useState, useCallback } from 'react'
import { productionSessionsApi } from '@/lib/apiClient'
import { todayIso } from '@/lib/utils'

export type ProcessType = 'deboning' | 'mixing' | 'production'

export interface ProcessSession {
  id: string
  status: 'open' | 'closed' | 'approved'
  sessionDate: string
  startedAt?: string
  endedAt?: string | null
}

const POLL_MS = 7000

export function useProcessSession(processType: ProcessType) {
  const [session, setSession] = useState<ProcessSession | null>(null)
  const [todayApproved, setTodayApproved] = useState(false)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const [active, all] = await Promise.all([
        productionSessionsApi.active(processType),
        productionSessionsApi.list(processType),
      ])
      setSession(active && active.id ? (active as ProcessSession) : null)
      const today = todayIso()
      const approved = Array.isArray(all)
        ? all.some((s: any) => s.sessionDate === today && s.status === 'approved')
        : false
      setTodayApproved(approved)
    } catch {
      setSession(null)
      setTodayApproved(false)
    }
  }, [processType])

  useEffect(() => {
    refetch()
    const t = setInterval(refetch, POLL_MS)
    return () => clearInterval(t)
  }, [refetch])

  const approve = useCallback(async (): Promise<string | null> => {
    if (!session) return 'Brak sesji do zatwierdzenia'
    setBusy(true)
    try {
      await productionSessionsApi.approve(session.id, { approvedBy: 'office' })
      await refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zatwierdzania'
    } finally {
      setBusy(false)
    }
  }, [session, refetch])

  // Biuro domyka dzień, gdy tablet zapomniał kliknąć "Zakończ dzień":
  // zamyka otwartą sesję i od razu ją zatwierdza.
  const closeAndApprove = useCallback(async (): Promise<string | null> => {
    if (!session) return 'Brak otwartej sesji'
    setBusy(true)
    try {
      if (session.status === 'open') {
        await productionSessionsApi.close(session.id, { notes: 'zamknięte przez biuro' })
      }
      await productionSessionsApi.approve(session.id, { approvedBy: 'office' })
      await refetch()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Błąd zamykania'
    } finally {
      setBusy(false)
    }
  }, [session, refetch])

  return { session, todayApproved, approve, closeAndApprove, busy, refetch }
}
