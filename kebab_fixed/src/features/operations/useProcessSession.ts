/**
 * useProcessSession — pollowanie statusu sesji procesu (deboning / mixing / production).
 *
 * Stany:
 *   null               → brak aktywnej sesji (proces nie rozpoczęty lub zatwierdzony)
 *   session.status='open'   → operator pracuje (LIVE)
 *   session.status='closed' → operator zakończył na tablecie, biuro musi potwierdzić
 *
 * Po approve karta wraca do null przy następnym pollu (active() filtruje 'approved').
 */
import { useEffect, useState, useCallback } from 'react'
import { productionSessionsApi } from '@/lib/apiClient'

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
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const data = await productionSessionsApi.active(processType)
      setSession(data && data.id ? (data as ProcessSession) : null)
    } catch {
      setSession(null)
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

  return { session, approve, busy, refetch }
}
