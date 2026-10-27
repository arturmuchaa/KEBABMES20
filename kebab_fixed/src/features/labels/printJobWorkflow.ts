import { labelPrintJobsApi, type LabelPrintJob, type LabelJobState } from '@/lib/api'
import { sendZpl, type ZebraDevice } from '@/lib/zebra'

export const labelJobStateLabel: Record<LabelJobState, string> = {
  prepared: 'Przygotowane — jeszcze nie wysłano',
  submitting: 'Rozpoczęto wysyłkę — wynik niepotwierdzony',
  submitted: 'Przekazano do BrowserPrint — sprawdź wydruk',
  exported: 'Przekazano plik do pobrania — nie potwierdza druku',
  dialog_opened: 'Wywołano okno druku — wynik fizyczny niepotwierdzony',
  uncertain: 'Nieznany wynik — sprawdź drukarkę przed dodrukiem',
  cancelled: 'Anulowano przed wysyłką',
}

export function newLabelOperationKey(): string {
  // MES also runs on HTTP intranet origins. randomUUID() is secure-context
  // only, but getRandomValues() is available there. This is NOT a unit QR.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `label-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function download(job: LabelPrintJob) {
  const url = URL.createObjectURL(new Blob([job.zpl], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `etykiety-${job.id}.zpl`
  document.body.appendChild(a)
  try { a.click() } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** No retries, no rendering, no unit creation. A failed preflight remains
 * prepared; after a successful claim every transport failure is uncertain. */
export async function deliverLabelJob(job: LabelPrintJob, options: {
  device?: ZebraDevice
  isActive?: () => boolean
  onState?: (state: LabelJobState) => void
  onStatus?: (text: string) => void
} = {}) {
  if (job.language !== 'zpl') throw new Error('Ten transport obsługuje wyłącznie ZPL, nie A4/PDF.')
  if (job.state !== 'prepared') throw new Error('To zadanie nie może zostać ponownie wysłane. Otwórz historię dodruku.')
  if (job.transport === 'browserprint' && options.device?.uid !== job.printerUid) {
    throw new Error('Wybierz drukarkę zapisaną w zadaniu. Nie przełączono urządzenia automatycznie.')
  }
  let token: string | undefined
  const begin = async () => {
    if (options.isActive && !options.isActive()) throw new Error('Ekran został zmieniony — nie wysłano etykiet.')
    const claim = await labelPrintJobsApi.action(job.id, { action: 'begin', printer_uid: job.printerUid })
    token = claim.attemptToken
    if (!token || claim.state !== 'submitting') throw new Error('Nie potwierdzono prawa do wysyłki. Odśwież stan zadania.')
    if (options.isActive && !options.isActive()) throw new Error('Ekran został zmieniony — przerwano próbę wysyłki.')
    options.onState?.('submitting')
  }
  try {
    if (job.transport === 'file') {
      await begin()
      download(job)
    } else {
      // No automatic ^MF rewrite: replay the frozen label bytes exactly.
      // Existing media checks remain; calibration is explicit in the panel.
      await sendZpl(options.device!, job.zpl, {
        autoCalibrate: false, beforeSend: begin, onStatus: options.onStatus,
      })
    }
    const state = job.transport === 'file' ? 'exported' : 'submitted'
    await labelPrintJobsApi.action(job.id, { action: state, attempt_token: token })
    options.onState?.(state)
    return state
  } catch (error) {
    if (token) {
      // The acknowledgement may itself have been lost. Never retry the send.
      // A concurrent committed 'submitted' stays terminal on the server.
      await labelPrintJobsApi.action(job.id, { action: 'uncertain', attempt_token: token }).catch(() => {})
      options.onState?.('uncertain')
    }
    throw error
  }
}
