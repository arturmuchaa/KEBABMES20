import { useCallback, useEffect, useRef, useState } from 'react'
import { takeSettlementApi } from '@/lib/api'
import {
  settlementPendingKey,
  type PendingSettlementWrite, type SettlementInitial, type SettlementKind, type SettlementMeasurement, type TakeSettlement,
} from './settlement'

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`)
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export const tileStage = (s: TakeSettlement | null): SettlementKind | null =>
  s && (s.stage === 'meat' || s.stage === 'backs' || s.stage === 'bones') ? s.stage : null

/**
 * Per-worker settlement driven from the meat weighing tile (meat → backs → bones).
 *
 * Same write contract as the old wizard: every measurement is stored on the
 * station BEFORE it is sent and an uncertain write (timeout, 5xx) is retried
 * with the SAME id and body — never a second measurement. A definitive 4xx
 * clears it so the operator can weigh again.
 */
export function useTileSettlement(opts: {
  /** Meat weighed together with the take (saved by itself when the tile opens): the page
   *  needs the same follow-up as after "ZAPISZ" — drive off, 200 kg label, or the error. */
  onInitialResult?: (error: string | null, measurement: SettlementMeasurement) => void
} = {}) {
  const onInitialRef = useRef(opts.onInitialResult)
  onInitialRef.current = opts.onInitialResult
  const [state, setStateRaw] = useState<TakeSettlement | null>(null)
  // Latest server state for chained steps (correction → back to where the operator was).
  const latestRef = useRef<TakeSettlement | null>(null)
  const setState = useCallback((s: TakeSettlement | null) => { latestRef.current = s; setStateRaw(s) }, [])
  const [pending, setPending] = useState<PendingSettlementWrite | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // Meat weighed before the settlement opened (take + meat in one go): saved once, as the first portion.
  const initialRef = useRef<PendingSettlementWrite | null>(null)

  useEffect(() => {
    if (!state) { setPending(null); return }
    try {
      const raw = localStorage.getItem(settlementPendingKey(state.id))
      setPending(raw ? JSON.parse(raw) as PendingSettlementWrite : null)
    } catch { setPending(null) }
  }, [state?.id])

  const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T> => {
    busyRef.current = true; setBusy(true)
    try { return await op() } finally { busyRef.current = false; setBusy(false) }
  }, [])

  const open = useCallback((s: TakeSettlement, initial?: SettlementInitial) => {
    initialRef.current = initial && initial.kgNet > 0 && s.stage === 'meat' ? { measurement: {
      ...initial, requestId: newId(), kind: 'meat',
      reason: initial.weighMode === 'manual' ? 'Wpisane ręcznie na panelu' : '',
    } } : null
    setState(s)
  }, [setState])
  const close = useCallback(() => { initialRef.current = null; setState(null) }, [setState])

  /** Sends a measurement (or retries the stored uncertain one). Returns an error text or null. */
  const send = useCallback(async (write: PendingSettlementWrite): Promise<string | null> => {
    const current = latestRef.current
    if (!current || busyRef.current) return 'Poczekaj na zakończenie zapisu'
    try { localStorage.setItem(settlementPendingKey(current.id), JSON.stringify(write)) }
    catch { return 'Nie można zabezpieczyć pomiaru w pamięci stanowiska. Nie wysłano zapisu.' }
    setPending(write)
    return run(async () => {
      try {
        const updated = write.correctingId
          ? await takeSettlementApi.correct(current.id, write.correctingId, write.measurement)
          : await takeSettlementApi.weigh(current.id, write.measurement)
        localStorage.removeItem(settlementPendingKey(current.id)); setPending(null)
        setState(updated)
        return null
      } catch (e) {
        const status = (e as { status?: number }).status
        if (status && status >= 400 && status < 500) {
          localStorage.removeItem(settlementPendingKey(current.id)); setPending(null)
        }
        return message(e, 'Nie zapisano ważenia — sprawdź połączenie i ponów')
      }
    })
  }, [run, setState])

  useEffect(() => {
    const first = initialRef.current
    if (!state || !first || pending) return
    initialRef.current = null   // cleared before sending: a re-run never sends it twice
    void send(first).then(err => onInitialRef.current?.(err, first.measurement))
  }, [state?.id, pending, send])

  const weigh = useCallback((m: Omit<SettlementMeasurement, 'requestId'>) =>
    send({ measurement: { ...m, requestId: newId() } }), [send])
  /** Replaces one saved weighing (same fraction) — the server keeps the audit trail. */
  const correct = useCallback((weighingId: string, m: Omit<SettlementMeasurement, 'requestId'>) =>
    send({ measurement: { ...m, requestId: newId() }, correctingId: weighingId }), [send])
  const retryPending = useCallback(() => (pending ? send(pending) : Promise.resolve(null)), [pending, send])

  const transition = useCallback(async (op: (id: string) => Promise<TakeSettlement>, fallback: string): Promise<string | null> => {
    const current = latestRef.current
    if (!current) return 'Rozliczenie nie jest otwarte'
    if (busyRef.current) return 'Poczekaj na zakończenie zapisu'
    return run(async () => {
      try { setState(await op(current.id)); return null }
      catch (e) { return message(e, fallback) }
    })
  }, [run, setState])

  const advance = useCallback((kind: SettlementKind, overrideYield = false) =>
    transition(id => takeSettlementApi.advance(id, kind, overrideYield), 'Nie udało się przejść dalej'), [transition])
  const reopen = useCallback((kind: SettlementKind) =>
    transition(id => takeSettlementApi.reopen(id, kind), 'Nie udało się wrócić do ważenia'), [transition])
  const finish = useCallback((exception?: { code: string; reason: string }) =>
    transition(id => takeSettlementApi.finish(id, exception), 'Nie zatwierdzono rozliczenia'), [transition])
  const latest = useCallback(() => latestRef.current, [])

  return { state, open, close, setState, latest, pending, busy, weigh, correct, retryPending, advance, reopen, finish }
}
