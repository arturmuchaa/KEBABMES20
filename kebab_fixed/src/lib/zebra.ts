import { parsePrinterIdentity, parsePrinterStatus, printerProblems } from '@/features/raw-batches/printerStatus'
import {
  beginZebraCalibration, checkZebraMedia, loadedZebraMedia, rememberZebraMedia, selectedZebraUid,
  ZEBRA_PROFILES, zebraCalibrationPending, zebraLengthMatches, zebraMediaSetupZpl, zebraProfileForZpl,
  type ZebraProfileId,
} from './zebraProfiles'

declare global { interface Window { BrowserPrint?: any } }

export interface ZebraDevice {
  name: string
  uid: string
  send: (data: string, ok: () => void, err: (e: unknown) => void) => void
  sendThenRead?: (data: string, ok: (response: string) => void, err: (e: unknown) => void) => void
  read?: (ok: (response: string) => void, err: (e: unknown) => void) => void
}
export const ZEBRA_TIMEOUT_MS = 15000
let loadPromise: Promise<any> | null = null

export function zebraErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    for (const key of ['message', 'error', 'responseText', 'statusText']) {
      const text = (error as Record<string, unknown>)[key]
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
  }
  return 'BrowserPrint nie podał przyczyny błędu. Sprawdź USB, kontrolkę drukarki i usługę Zebra BrowserPrint.'
}

/** SDK potrafi nie wywołać żadnego callbacka. Spóźniony callback nie ponawia zadania. */
function callback<T>(start: (ok: (value: T) => void, fail: (error: unknown) => void) => void,
  label: string, onTimeout?: () => void, onSettled?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(`${label}: przekroczono czas oczekiwania. Wynik operacji jest nieznany. Sprawdź wydruki, USB i BrowserPrint przed ponowieniem.`))
    }, ZEBRA_TIMEOUT_MS)
    const ok = (value: T) => { clearTimeout(timer); onSettled?.(); resolve(value) }
    const fail = (error: unknown) => {
      clearTimeout(timer); onSettled?.()
      reject(new Error(`${label}: ${zebraErrorMessage(error)}`))
    }
    try { start(ok, fail) } catch (error) { fail(error) }
  })
}

export async function loadBrowserPrint(): Promise<any> {
  if (window.BrowserPrint) return window.BrowserPrint
  if (!loadPromise) {
    loadPromise = callback<void>((ok, fail) => {
      const script = document.createElement('script')
      script.src = '/browserprint/BrowserPrint-3.1.250.min.js'
      script.async = true
      script.onload = () => { script.remove(); ok() }
      script.onerror = () => { script.remove(); fail('Nie udało się wczytać klienta BrowserPrint') }
      document.head.appendChild(script)
    }, 'Wczytywanie BrowserPrint').then(() => {
      if (!window.BrowserPrint) throw new Error('BrowserPrint niedostępny')
      return window.BrowserPrint
    }).catch(e => { loadPromise = null; throw e })
  }
  return loadPromise
}

export async function getDevices(): Promise<{ default: ZebraDevice | null; list: ZebraDevice[] }> {
  const BP = await loadBrowserPrint()
  const [defResult, listResult] = await Promise.allSettled([
    callback<ZebraDevice | null>((ok, fail) => BP.getDefaultDevice('printer', ok, fail), 'Domyślna drukarka'),
    callback<ZebraDevice[]>((ok, fail) => BP.getLocalDevices(ok, fail, 'printer'), 'Lista drukarek'),
  ])
  const def = defResult.status === 'fulfilled' ? defResult.value : null
  const list = listResult.status === 'fulfilled' && Array.isArray(listResult.value) ? [...listResult.value] : []
  if (def && !list.some(d => d.uid === def.uid)) list.push(def)
  if (!list.length && listResult.status === 'rejected') throw listResult.reason
  const uid = selectedZebraUid()
  if (uid) {
    const selected = list.find(d => d.uid === uid)
    // Nie przełączaj po cichu na inną drukarkę, gdy wybrana straci USB.
    return { default: selected ?? null, list: selected ? list : [] }
  }
  return { default: def ?? list[0] ?? null, list }
}

/** Lista także z odłączoną zapamiętaną drukarką: panel pozwala wybrać inną. */
export async function discoverZebraDevices(): Promise<ZebraDevice[]> {
  const BP = await loadBrowserPrint()
  return callback<ZebraDevice[]>((ok, fail) => BP.getLocalDevices(ok, fail, 'printer'), 'Lista drukarek')
    .then(list => Array.isArray(list) ? list : [])
}

const queues = new Map<string, Promise<unknown>>()
const uncertain = new Set<string>()
export interface ZebraConnection {
  send: (zpl: string) => Promise<void>
  read: (zpl: string) => Promise<string>
  receive?: () => Promise<string>
}

/** Cała seria / kalibracja trzyma jedną blokadę, również między etykietami.
 * Web Locks dodatkowo serializuje karty tej samej aplikacji (jeśli dostępne).
 * Po timeout nie wolno puścić kolejnego zapisu na wciąż trwające żądanie SDK. */
export function withZebraPrinter<T>(device: ZebraDevice, task: (io: ZebraConnection) => Promise<T>): Promise<T> {
  const run = async () => {
    if (uncertain.has(device.uid)) throw new Error('Poprzednia operacja BrowserPrint nadal nie odpowiedziała. Sprawdź wydruki, uruchom ponownie BrowserPrint i odśwież MES.')
    const call = <R>(start: Parameters<typeof callback<R>>[0], label: string) => {
      if (uncertain.has(device.uid)) return Promise.reject(new Error('Poprzednia operacja BrowserPrint nadal nie odpowiedziała. Sprawdź połączenie i uruchom ponownie BrowserPrint.'))
      return callback(start, `${device.name}: ${label}`,
        () => uncertain.add(device.uid), () => uncertain.delete(device.uid))
    }
    return task({
      send: zpl => call<void>((ok, fail) => device.send(zpl, () => ok(), fail), 'wysyłanie'),
      read: zpl => {
        if (!device.sendThenRead) return Promise.reject(new Error('Ta wersja BrowserPrint nie umie odczytać odpowiedzi drukarki'))
        return call<string>((ok, fail) => device.sendThenRead!(zpl, r => ok(r ?? ''), fail), 'odczyt')
      },
      receive: device.read ? () => call<string>((ok, fail) => device.read!(r => ok(r ?? ''), fail), 'odczyt') : undefined,
    })
  }
  const queued = (queues.get(device.uid) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(`kebab-zebra-${device.uid}`, run)
    }
    return run()
  })
  queues.set(device.uid, queued)
  const cleanup = () => { if (queues.get(device.uid) === queued) queues.delete(device.uid) }
  void queued.then(cleanup, cleanup)
  return queued
}

const isPrint = (zpl: string) => /\^(?:FD|GF|GB|XG)/.test(zpl)
export const zebraWait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function readZebraStatus(io: ZebraConnection) {
  let raw = await io.read('~HS')
  // USB może zwrócić trzy ramki w osobnych odczytach. Nie wysyłaj kolejnego
  // ~HS, zanim nie odbierzesz reszty poprzedniej odpowiedzi.
  for (let i = 0; i < 5 && !parsePrinterStatus(raw).valid && io.receive; i++) {
    await zebraWait(200)
    raw += await io.receive()
  }
  return { raw, status: parsePrinterStatus(raw) }
}

async function checkReady(device: ZebraDevice, io: ZebraConnection) {
  if (!device.sendThenRead) return // starszy SDK: zachowaj sam zapis
  const { status } = await readZebraStatus(io)
  // GC420t potrafi milczeć nawet przy otwartej głowicy. Brak odpowiedzi NIE jest gotowością.
  if (!status.valid) throw new Error('Brak pełnej odpowiedzi ~HS. Sprawdź zieloną kontrolkę, papier, zamknięcie pokrywy i USB; użyj „Odczytaj stan”. Nie wysłano etykiety.')
  const problems = printerProblems(status)
  if (problems.length) throw new Error(problems.join(' '))
  return status
}

/** Już pod blokadą urządzenia: nie wolno ponownie wchodzić do kolejki. */
async function calibrateConnection(device: ZebraDevice, io: ZebraConnection, profile: ZebraProfileId,
  onProgress: (text: string) => void = () => {}) {
  if (!device.sendThenRead) throw new Error('Kalibracja z kontrolą wyniku wymaga odczytu BrowserPrint. Zaktualizuj BrowserPrint na stanowisku.')
  const identity = parsePrinterIdentity(await io.read('~HI'))
  if (identity.dpi && identity.dpi !== 203) throw new Error(`Drukarka zgłasza ${identity.dpi} dpi. Te profile są przeznaczone dla GC420t 203 dpi.`)
  const before = await readZebraStatus(io)
  if (before.status.valid && (before.status.formatsInBuffer || before.status.labelsRemaining)) {
    throw new Error('Drukarka ma jeszcze zadania w buforze. Poczekaj na zakończenie wydruków przed zmianą rolki.')
  }
  beginZebraCalibration(device.uid, profile)
  onProgress('Ustawiam czujnik przerwy i druk bez kalki…')
  await io.send(zebraMediaSetupZpl(profile))
  await io.send('~JC')
  onProgress('Dopasowuję drukarkę do etykiet — trwa automatyczna kalibracja…')
  await zebraWait(5000)
  const deadline = Date.now() + 30000
  let previous: number | null = null
  let last = 'Brak pełnej odpowiedzi drukarki.'
  while (Date.now() < deadline) {
    const { status } = await readZebraStatus(io)
    const problems = printerProblems(status)
    if (status.valid && problems.length) throw new Error(problems.join(' '))
    if (status.valid && !status.formatsInBuffer && !status.labelsRemaining) {
      const mm = status.labelLengthMm!
      last = `Drukarka zgłasza ${mm} mm, wybrana etykieta ma ${ZEBRA_PROFILES[profile].height} mm długości.`
      if (previous === status.labelLengthDots && zebraLengthMatches(profile, mm)) {
        rememberZebraMedia(device.uid, profile)
        return { lengthMm: mm, message: `${last} Odczyt jest stabilny. Wydrukuj jedną etykietę testową i sprawdź ramkę oraz zatrzymanie na przerwie.` }
      }
      previous = status.labelLengthDots
    } else { previous = null }
    await zebraWait(1000)
  }
  throw new Error(`Nie potwierdzono wyniku kalibracji. ${last} Sprawdź założenie rolki, prowadnice i czujnik; potem powtórz wydruk lub kalibrację.`)
}

/** ~HS nie ma flagi końca kalibracji: wymagamy dwóch stabilnych odczytów,
 * bez wpisywania ^LL przed pomiarem. Używane przez automat i konfigurację. */
export function calibrateZebra(device: ZebraDevice, profile: ZebraProfileId,
  onProgress?: (text: string) => void) {
  return withZebraPrinter(device, io => calibrateConnection(device, io, profile, onProgress))
}

interface ZebraPrintOptions {
  /** Test ręczny ma sprawdzić wybraną rolkę, bez automatycznej zmiany profilu. */
  autoCalibrate?: boolean
  onStatus?: (text: string) => void
  /** Durable single-send claim, under the printer lock and AFTER preflight.
   * A rejected/unknown claim must prevent sending any label bytes. */
  beforeSend?: () => Promise<void>
}

async function preparePrint(device: ZebraDevice, io: ZebraConnection, zpl: string, options: ZebraPrintOptions): Promise<string> {
  const profile = options.autoCalibrate === false ? null : zebraProfileForZpl(zpl)
  if (!profile) { checkZebraMedia(device.uid, zpl); await checkReady(device, io); return zpl }

  let status = await checkReady(device, io)
  const needsCalibration = loadedZebraMedia(device.uid) !== profile || zebraCalibrationPending(device.uid)
    || Boolean(status && !zebraLengthMatches(profile, status.labelLengthMm))
  if (needsCalibration) {
    // BrowserPrint potwierdza przekazanie danych, więc poprzedni wydruk może
    // jeszcze trwać. Zaczekaj na opróżnienie bufora przed ~JC.
    const deadline = Date.now() + 30000
    while (status && (status.formatsInBuffer || status.labelsRemaining)) {
      if (Date.now() >= deadline) throw new Error('Poprzedni wydruk nadal trwa. Poczekaj na jego zakończenie i ponów druk etykiet.')
      options.onStatus?.('Czekam na zakończenie poprzedniego wydruku…')
      await zebraWait(1000)
      status = await checkReady(device, io)
    }
    await calibrateConnection(device, io, profile, options.onStatus)
  }
  checkZebraMedia(device.uid, zpl)
  // Przełożenie takiej samej rolki nie zmienia wymiarów w ~HS. Kalibrację
  // po zamknięciu pokrywy wykonuje sama GC420t, także gdy panel jest zwinięty.
  return zpl.replace(/\^XA/g, '^XA^MFC,C')
}

export function sendZpl(device: ZebraDevice, zpl: string, options: ZebraPrintOptions = {}): Promise<void> {
  return withZebraPrinter(device, async io => {
    const payload = isPrint(zpl) ? await preparePrint(device, io, zpl, options) : zpl
    await options.beforeSend?.()
    await io.send(payload)
  })
}

export function sendThenReadZpl(device: ZebraDevice, zpl: string): Promise<string> {
  return withZebraPrinter(device, io => io.read(zpl))
}

export async function sendZplJobs(device: ZebraDevice, jobs: readonly string[], options: Omit<ZebraPrintOptions, 'beforeSend'> & {
  delayMs?: number
  onProgress?: (sent: number, total: number) => void
} = {}): Promise<void> {
  return withZebraPrinter(device, async io => {
    let sent = 0
    options.onProgress?.(0, jobs.length)
    try {
      for (const zpl of jobs) {
        await io.send(isPrint(zpl) ? await preparePrint(device, io, zpl, options) : zpl)
        sent++
        options.onProgress?.(sent, jobs.length)
        if (sent < jobs.length) await zebraWait(options.delayMs ?? 400)
      }
    } catch (error) {
      throw new Error(`Przekazano do BrowserPrint ${sent}/${jobs.length} zadań; zatrzymano na zadaniu ${sent + 1}. ${zebraErrorMessage(error)} Sprawdź ostatnią etykietę przed ponowieniem — mogła już dotrzeć do drukarki.`)
    }
  })
}

export function browserPrintBaseUrl(): string { return 'http://localhost:9100/' }

export async function probeBrowserPrint(): Promise<{ ok: boolean; reason?: string }> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 4000)
  try {
    await fetch(browserPrintBaseUrl() + 'available', { method: 'GET', mode: 'no-cors', signal: abort.signal })
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: 'Nie można połączyć z Zebra BrowserPrint (localhost:9100). Sprawdź, czy usługa działa na tym komputerze oraz czy przeglądarka zezwala MES na dostęp do sieci lokalnej.',
    }
  } finally { clearTimeout(timer) }
}
