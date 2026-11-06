import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { labelA4JobsApi, type A4PrintJob } from '@/lib/api'
import { labelJobStateLabel, newLabelOperationKey } from './printJobWorkflow'

export function useA4PrintJob() {
  const [params, setParams] = useSearchParams()
  const search = params.toString()
  const jobId = params.get('jobId') || '', sourceId = params.get('sourceJobId') || '', key = params.get('requestKey') || ''
  const ids = params.get('unitIds')
  const route = useRef(search)
  const routeEpoch = useRef(0)
  if (route.current !== search) routeEpoch.current++
  route.current = search
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const pending = useRef<{ id: string; route: string; epoch: number } | null>(null)
  const [job, setJob] = useState<A4PrintJob | null>(null)
  const [source, setSource] = useState<A4PrintJob | null>(null)
  const [loadedRoute, setLoadedRoute] = useState(search)
  const [loading, setLoading] = useState(Boolean(jobId || sourceId || key))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null } }, [])
  useEffect(() => {
    if (pending.current && pending.current.route !== search) {
      pending.current = null; busyRef.current = false; setBusy(false)
    }
  }, [search])
  useEffect(() => { setAcknowledged(false); setMessage('') }, [sourceId, jobId, ids])
  useEffect(() => {
    if (busy) return
    let cancelled = false
    setLoading(true); setError(''); setJob(null); setSource(null); setLoadedRoute(search)
    async function load() {
      const saved = jobId ? await labelA4JobsApi.get(jobId) : key ? await labelA4JobsApi.findByKey(key) : null
      if (cancelled || route.current !== search) return
      if (saved) setJob(saved)
      else if (sourceId) {
        const original = await labelA4JobsApi.get(sourceId, ids === null ? undefined : ids.split(','))
        if (cancelled || route.current !== search) return
        if (!['dialog_opened', 'exported', 'uncertain'].includes(original.state)) throw new Error('Źródłowe zadanie nie jest zakończone. Najpierw otwórz jego stan.')
        setSource(original)
      }
    }
    load().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Błąd historii A4') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [search, busy, refresh])
  const routePending = loadedRoute !== search
  const snapshot = routePending ? null : job || source
  const skipLive = Boolean(jobId || sourceId || (key && (loading || routePending || error || snapshot)))

  async function prepare(transport: 'browser' | 'file', orgCode: string) {
    if (busyRef.current || loading || routePending || error || (!job && (sourceId || ids !== null) && !acknowledged)) return
    busyRef.current = true; setBusy(true); setError(''); setMessage('')
    let expected = search
    const epoch = routeEpoch.current
    const active = () => mounted.current && route.current === expected && routeEpoch.current === epoch
    const remember = (next: URLSearchParams) => {
      expected = next.toString(); route.current = expected; setLoadedRoute(expected); setParams(next, { replace: true })
    }
    try {
      let saved = job
      if (!saved) {
        const next = new URLSearchParams(params)
        const operation = key || newLabelOperationKey()
        next.set('requestKey', operation); remember(next)
        saved = await labelA4JobsApi.prepare({
          idempotency_key: operation, language: 'a4', transport,
          printer_name: transport === 'file' ? 'Eksport PDF' : 'Systemowe okno druku (urządzenie wybiera operator)',
          printer_uid: transport === 'file' ? 'file:pdf' : 'browser:dialog',
          ...(source ? { source_job_id: source.id, unit_ids: source.unitIds, acknowledge_uncertain: acknowledged } : {
            plan_line_id: params.get('planLineId') || '', client_id: params.get('clientId') || '', recipe_id: params.get('recipeId') || '',
            org_code: orgCode, ...(ids !== null ? { unit_ids: ids.split(',') } : {}),
          }),
        })
        if (!active()) { busyRef.current = false; if (mounted.current) setBusy(false); return }
        next.set('jobId', saved.id); next.delete('requestKey'); remember(next)
      }
      if (saved.state !== 'prepared' || saved.transport !== transport) throw new Error('Zadanie nie jest gotowe dla tego wyjścia. Sprawdź historię; nie ponawiaj automatycznie.')
      pending.current = { id: saved.id, route: expected, epoch }
      setJob(saved) // The page now renders ONLY this frozen input, then calls complete.
    } catch (e) {
      if (active()) setMessage(e instanceof Error ? e.message : 'Błąd przygotowania')
      busyRef.current = false; if (mounted.current) { setBusy(false); setRefresh(n => n + 1) }
    }
  }

  async function complete(renderKey: string, output: (assertActive: () => void) => Promise<void>, preflight?: () => Promise<void>) {
    const intent = pending.current
    if (!intent || !job || intent.id !== job.id || renderKey !== job.id || route.current !== intent.route || routeEpoch.current !== intent.epoch) return
    pending.current = null // consume before await, including React StrictMode
    let token: string | undefined
    const active = () => mounted.current && route.current === intent.route && routeEpoch.current === intent.epoch
    const assertActive = () => { if (!active()) throw new Error('Zmieniono ekran — przerwano próbę druku') }
    try {
      // Decode images/load fonts before claiming a send. A failed local render
      // leaves the durable job prepared; it is not an uncertain printer IO.
      await preflight?.()
      assertActive()
      const claim = await labelA4JobsApi.action(job.id, { action: 'begin', printer_uid: job.printerUid })
      token = claim.attemptToken
      if (!token || claim.state !== 'submitting' || !active()) throw new Error('Przerwano próbę — odśwież stan zadania, nie ponawiaj automatycznie.')
      await output(assertActive)
      const state = job.transport === 'file' ? 'exported' : 'dialog_opened'
      await labelA4JobsApi.action(job.id, { action: state, attempt_token: token })
      if (active()) setMessage(labelJobStateLabel[state])
    } catch (e) {
      if (token) await labelA4JobsApi.action(job.id, { action: 'uncertain', attempt_token: token }).catch(() => {})
      if (active()) setMessage(`${e instanceof Error ? e.message : 'Błąd druku'}. Nie ponowiono wysyłki.`)
    } finally { busyRef.current = false; if (mounted.current) { setBusy(false); setRefresh(n => n + 1) } }
  }

  function renderFailed(reason: string) {
    if (!pending.current) return
    pending.current = null; busyRef.current = false; setBusy(false); setMessage(reason)
  }
  async function changeState(action: 'cancel' | 'recover') {
    if (!job || busyRef.current || routePending) return
    busyRef.current = true; setBusy(true)
    try { await labelA4JobsApi.action(job.id, { action, acknowledge_uncertain: acknowledged }) }
    catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Błąd zmiany stanu') }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); setRefresh(n => n + 1) } }
  }
  return { job: routePending ? null : job, source: routePending ? null : source, snapshot, skipLive,
    loading: loading || routePending, busy, error, message, acknowledged, setAcknowledged,
    needsAcknowledgement: !job && Boolean(sourceId || ids !== null), prepare, complete, renderFailed, changeState,
    reload: () => setRefresh(n => n + 1) }
}
