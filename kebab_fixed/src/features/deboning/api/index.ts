/**
 * deboning/api/index.ts
 *
 * Warstwa API modułu rozbioru.
 * Hooki importują TYLKO stąd.
 * Zero logiki biznesowej — tylko mapowanie na/z backendu.
 *
 * Backend MUSI wymuszać:
 *   - zapis tylko gdy session.status === 'open'
 *   - zapis tylko 04:00–18:00
 *   - HACCP: brak zapisu dla przeterminowanej partii
 */
import type {
  ProductionSession, DeboningEntry, SessionSummary, DeboningTraceability,
  StartSessionDto, CloseSessionDto, ApproveSessionDto,
  CreateDeboningEntryDto, UpdateDeboningEntryDto,
} from '../types'
import { calcSessionSummary } from '../utils'

// ─── Kontrakt API ─────────────────────────────────────────────────────────────

export interface DeboningApi {
  // Sesje
  getActiveSession(processType: 'deboning'): Promise<ProductionSession | null>
  getTodaySessions(processType: 'deboning'): Promise<ProductionSession[]>
  startSession(dto: StartSessionDto): Promise<ProductionSession>
  closeSession(sessionId: string, dto: CloseSessionDto): Promise<ProductionSession>
  approveSession(sessionId: string, dto: ApproveSessionDto): Promise<ProductionSession>

  // Wpisy rozbioru
  listEntries(sessionId: string): Promise<DeboningEntry[]>
  createEntry(dto: CreateDeboningEntryDto): Promise<DeboningEntry>
  updateEntry(entryId: string, dto: UpdateDeboningEntryDto): Promise<DeboningEntry>

  // Agregacje
  getSessionSummary(sessionId: string): Promise<SessionSummary>
  getTraceability(entryId: string): Promise<DeboningTraceability>
}

// ─── Implementacja mock (localStorage) ───────────────────────────────────────

import {
  productionSessionsApi as sessionsStore,
  deboningEntriesApi    as entriesStore,
} from '@/lib/apiClient'

export const deboningApi: DeboningApi = {

  // BUGFIX: używa dedykowanego endpointu /active zamiast list().find()
  getActiveSession: async (_processType: 'deboning' = 'deboning') => {
    try {
      const session = await sessionsStore.active('deboning')
      if (!session || !session.id) return null
      return session as ProductionSession
    } catch {
      return null
    }
  },

  getTodaySessions: async (_processType: 'deboning' = 'deboning') => {
    const today = new Date()
    const h = today.getHours()
    const dateStr = h < 4
      ? new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)
      : today.toISOString().slice(0, 10)
    const sessions = await sessionsStore.list('deboning')
    return (Array.isArray(sessions) ? sessions : []).filter((s: any) => s.sessionDate === dateStr)
  },

  startSession: (dto) => sessionsStore.start(dto),
  closeSession:   (id, dto) => sessionsStore.close(id, dto),
  approveSession: (id, dto) => sessionsStore.approve(id, dto),

  // BUGFIX: przekazuje sessionId jako parametr zapytania
  listEntries: (sessionId) => entriesStore.list(sessionId),
  createEntry: (dto)       => entriesStore.create(dto),
  updateEntry: (id, dto)   => entriesStore.update(id, dto),

  getSessionSummary: async (sessionId) => {
    const session = await sessionsStore.byId(sessionId)
    const entries = await entriesStore.list(sessionId)
    const agg = calcSessionSummary(entries)
    return { sessionId, sessionDate: session.sessionDate, status: session.status, ...agg }
  },

  getTraceability: async (entryId) => {
    return entriesStore.traceability(entryId)
  },
}
