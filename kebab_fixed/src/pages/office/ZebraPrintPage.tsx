import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { labelPrintJobsApi, labelsZebraApi, zebraDesignsApi, type LabelPrintJob, type ZebraRenderResult } from '@/lib/api'
import { getDevices, zebraErrorMessage } from '@/lib/zebra'
import { ZebraPrinterPanel } from '@/components/ZebraPrinterPanel'
import { deliverLabelJob, labelJobStateLabel, newLabelOperationKey } from '@/features/labels/printJobWorkflow'

export function ZebraPrintPage() {
  const [params, setParams] = useSearchParams()
  const planLineId = params.get('planLineId') || ''
  const clientId = params.get('clientId') || ''
  const recipeId = params.get('recipeId') || ''
  const unitIds = params.get('unitIds') ?? undefined
  const sourceJobId = params.get('sourceJobId') || ''
  const jobId = params.get('jobId') || ''
  const requestKey = params.get('requestKey') || ''
  const search = params.toString()
  const routeRef = useRef(search)
  routeRef.current = search
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const [render, setRender] = useState<ZebraRenderResult | null>(null)
  const [job, setJob] = useState<LabelPrintJob | null>(null)
  const [source, setSource] = useState<LabelPrintJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [acknowledged, setAcknowledged] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [printerBusy, setPrinterBusy] = useState(false)

  useEffect(() => {
    if (busy) return
    let cancelled = false
    setLoading(true)
    setRender(null)
    setJob(null)
    setSource(null)
    async function load() {
      const saved = jobId ? await labelPrintJobsApi.get(jobId)
        : requestKey ? await labelPrintJobsApi.findByKey(requestKey) : null
      if (cancelled) return
      if (saved) { setJob(saved); setRender(saved); return }
      if (sourceJobId) {
        const original = await labelPrintJobsApi.get(sourceJobId, unitIds === undefined ? undefined : unitIds.split(','))
        if (cancelled) return
        setSource(original)
        setRender(['submitted', 'exported', 'uncertain'].includes(original.state)
          ? original : { ok: false, reason: 'Źródłowe zadanie nie jest zakończone. Otwórz jego stan i sprawdź drukarkę.' })
        return
      }
      // Preview only. The actual send ALWAYS uses the server-frozen job.
      const preview = await zebraDesignsApi.render(clientId, recipeId, planLineId, unitIds)
      const result = !preview.ok && preview.reason === 'Brak projektu etykiety Zebra'
        ? await labelsZebraApi.render(planLineId, clientId, recipeId, unitIds) : preview
      if (!cancelled) setRender(result)
    }
    load().catch(error => {
      if (!cancelled) setRender({ ok: false, reason: `Błąd pobierania ZPL lub historii: ${zebraErrorMessage(error)}` })
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [planLineId, clientId, recipeId, unitIds, sourceJobId, jobId, requestKey, busy, refresh])

  useEffect(() => { setAcknowledged(false); setMsg(null) }, [planLineId, clientId, recipeId, unitIds, sourceJobId, jobId])

  const needsAcknowledgement = !job && (Boolean(sourceJobId) || unitIds !== undefined)
  const canSend = !busy && !printerBusy && !loading && render?.ok && (!job || job.state === 'prepared')
    && (!needsAcknowledgement || acknowledged)

  async function print(transport: 'browserprint' | 'file') {
    if (busyRef.current || !canSend) return
    busyRef.current = true
    setBusy(true)
    setMsg(null)
    let expectedRoute = search
    const isActive = () => mounted.current && routeRef.current === expectedRoute
    function remember(next: URLSearchParams) {
      expectedRoute = next.toString()
      routeRef.current = expectedRoute
      setParams(next, { replace: true })
    }
    try {
      const device = transport === 'browserprint' ? (await getDevices()).default : undefined
      if (!isActive()) return
      if (transport === 'browserprint' && !device) throw new Error('Wybrana drukarka Zebra jest niedostępna. Odśwież listę i sprawdź USB.')
      let prepared = job
      const next = new URLSearchParams(search)
      if (!prepared) {
        const key = requestKey || newLabelOperationKey()
        // Persist BEFORE the POST; recover a lost response after reload.
        next.set('requestKey', key)
        remember(next)
        prepared = await labelPrintJobsApi.prepare({
          idempotency_key: key, transport,
          printer_name: device?.name || 'Eksport pliku ZPL', printer_uid: device?.uid || 'file:zpl',
          ...(source ? { source_job_id: source.id, unit_ids: source.unitIds, acknowledge_uncertain: acknowledged } : {
            plan_line_id: planLineId, client_id: clientId, recipe_id: recipeId,
            ...(unitIds !== undefined ? { unit_ids: unitIds.split(',') } : {}),
          }),
        })
        if (!isActive()) return
        next.set('jobId', prepared.id)
        next.delete('requestKey')
        remember(next)
      }
      if (prepared.transport !== transport) throw new Error('Zadanie ma inne wyjście. Anuluj niewysłane zadanie przed zmianą transportu.')
      setJob(prepared)
      setRender(prepared)
      const state = await deliverLabelJob(prepared, {
        device: device ?? undefined, isActive,
        onState: state => { if (isActive()) setJob(previous => previous ? { ...previous, state } : previous) },
        onStatus: text => { if (isActive()) setMsg({ ok: true, text }) },
      })
      if (isActive()) setMsg({ ok: true, text: labelJobStateLabel[state] })
    } catch (e) {
      if (isActive()) setMsg({ ok: false, text: `${zebraErrorMessage(e)} Nie ponawiam automatycznie. Sprawdź zapisany stan poniżej.` })
    } finally {
      if (mounted.current) setBusy(false)
      busyRef.current = false
    }
  }

  async function changeState(action: 'cancel' | 'recover') {
    if (!job || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await labelPrintJobsApi.action(job.id, { action, acknowledge_uncertain: acknowledged })
    } catch (e) { if (mounted.current) setMsg({ ok: false, text: zebraErrorMessage(e) }) }
    finally { if (mounted.current) setBusy(false); busyRef.current = false }
  }

  const restartParams = new URLSearchParams(params)
  restartParams.delete('jobId'); restartParams.delete('requestKey')

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-xl space-y-4">
        <Link to="/office/szablony-etykiet" className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Szablony etykiet
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-black"><Printer size={20} /> Druk Zebra</h1>
        {unitIds !== undefined && !sourceJobId && !job && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Dodruk wybranych istniejących sztuk z oryginalnym QR. Używany jest aktualny szablon i aktualne dane —
          ta ścieżka nie odtwarza wcześniejszego wydruku. Dla zapisanych zadań wybierz wersję z historii sztuki.
        </div>}
        {source && <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm">
          Dodruk historyczny {source.count} szt. z rewizji #{source.revisionId}. Oryginalne dane, grafika i QR — bez użycia bieżącego szablonu.
          <div className="mt-1 font-semibold">Źródło: {labelJobStateLabel[source.state]}</div>
        </div>}
        <p className="text-xs text-slate-600">Przekazanie do drukarki nie potwierdza fizycznego wydruku. Brak skanu nie oznacza braku wydruku.</p>
        <p className="text-xs text-slate-600">Ta ścieżka wysyła ZPL, nie EPL. Kalibrację materiału wykonaj w panelu drukarki przed wysłaniem.</p>
        {loading && !busy && <p role="status" className="text-sm">Wczytywanie zapisanego stanu…</p>}

        {render && !render.ok && (
          <div className="rounded-lg border border-red-200 bg-white p-4 text-sm">
            <div className="font-bold text-red-700">{render.reason}</div>
            {!jobId && !sourceJobId && <Link to={`/etykiety/zebra-designer?clientId=${encodeURIComponent(clientId)}&recipeId=${encodeURIComponent(recipeId)}`}
              className="mt-2 inline-block text-ink underline">Otwórz Projektant Zebra</Link>}
          </div>
        )}

        {needsAcknowledgement && <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} className="mt-1" />
          {sourceJobId ? 'Sprawdziłem wydruki i kolejkę drukarki. Świadomie zlecam dodatkowe etykiety z tym samym QR.'
            : 'Sprawdziłem partię i rozumiem, że dodruk użyje aktualnych danych, nie wersji historycznej.'}
        </label>}

        <button disabled={!canSend || job?.transport === 'file'} onClick={() => print('browserprint')}
          className="w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? 'Trwa operacja…' : `${job?.state === 'prepared' ? 'Wyślij zapisane zadanie' : 'Drukuj'}${render?.ok ? ` (${render.count})` : ''}`}
        </button>

        {/* Awaryjny druk USB bez BrowserPrint: pobierz ZPL i wyślij przez Zebra Setup Utilities */}
        {render?.ok && (
          <button onClick={() => print('file')} disabled={!canSend || job?.transport === 'browserprint'}
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Pobierz ZPL (druk USB bez BrowserPrint)
          </button>
        )}

        {msg && (
          <div role={msg.ok ? 'status' : 'alert'} className={`flex items-center gap-2 rounded-lg border-2 p-3 text-sm font-semibold ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
            {msg.ok ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />} {msg.text}
          </div>
        )}
        {job && <section aria-label="Historia zadania" className="space-y-3 rounded-lg border bg-white p-4 text-sm">
          <h2 className="font-bold">{labelJobStateLabel[job.state]}</h2>
          <p className="break-all text-xs text-slate-600">Zadanie {job.id} · rewizja #{job.revisionId} · {job.count} szt. · {job.printerName}</p>
          <ol className="space-y-1 text-xs">
            {job.events.map((event, index) => <li key={index}>{labelJobStateLabel[event.state]} — {event.actor}, {event.createdAt}</li>)}
          </ol>
          {job.state === 'prepared' && <button disabled={busy} onClick={() => changeState('cancel')} className="rounded border px-3 py-2 font-semibold disabled:opacity-50">Anuluj niewysłane zadanie</button>}
          {job.state === 'submitting' && <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-3">
            <p>Nie wysyłaj ponownie. Po awarii zamknij poprzednią próbę, sprawdź etykiety i zrestartuj BrowserPrint. Po 5 minutach można oznaczyć wynik jako nieznany — to nie anuluje danych w drukarce.</p>
            <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={busy} />Zamknąłem poprzednią próbę i sprawdziłem drukarkę.</label>
            <button disabled={busy || !acknowledged} onClick={() => changeState('recover')} className="rounded border bg-white px-3 py-2 font-semibold disabled:opacity-50">Zapisz nieznany wynik</button>
          </div>}
          {['submitted', 'exported', 'uncertain'].includes(job.state) && !busy && <Link
            to={`?${new URLSearchParams({ sourceJobId: job.id })}`} className="inline-block rounded border px-3 py-2 font-semibold">
            Zleć świadomy dodruk całego zadania ({job.count})
          </Link>}
          {job.state === 'cancelled' && !busy && (planLineId || sourceJobId) && <Link to={`?${restartParams}`} className="inline-block rounded border px-3 py-2 font-semibold">Przygotuj nowe zadanie</Link>}
        </section>}
        <button disabled={busy} onClick={() => setRefresh(n => n + 1)} className="rounded border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">Odśwież stan (bez ponawiania druku)</button>
        <ZebraPrinterPanel defaultProfile="100x150" disabled={busy} onBusyChange={setPrinterBusy} manualCalibrationOnly />
      </div>
    </div>
  )
}
