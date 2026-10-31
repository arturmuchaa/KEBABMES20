/**
 * Drukarka etykiet w PROTRIMA — druk bez obsługi.
 *
 * Biuro klika „Drukuj”, resztę robi ta warstwa nad `lib/zebra` (tą samą,
 * sprawdzoną w starym MES; nie zmieniamy jej):
 *  - drukarka: zapamiętana na tym komputerze albo domyślna BrowserPrint,
 *  - po zmianie rolki (albo przy pierwszym druku na stanowisku) kalibruje ją
 *    sama i bierze skok taśmy z JEJ pomiaru — „spór o skok rozstrzyga drukarka”,
 *    ręczne „Ustaw skok z drukarki” ze starego MES nie jest już potrzebne,
 *  - nastawa stanowiska (przesunięcia, punkt odrywania) zostaje w localStorage
 *    i zmienia się tylko w schowanych „Precyzyjnych ustawieniach”.
 */
import {
  calibrateZebra, discoverZebraDevices, getDevices, probeBrowserPrint, readZebraStatus, sendZpl, sendZplJobs,
  withZebraPrinter, zebraErrorMessage, type ZebraDevice,
} from '@/lib/zebra'
import { loadedZebraMedia, selectZebra, selectedZebraUid, zebraCalibrationPending, zebraLengthMatches, ZEBRA_PROFILES, type ZebraProfileId } from '@/lib/zebraProfiles'
import { IDENTIFY_ZPL, parsePrinterIdentity, printerProblems } from '@/features/raw-batches/printerStatus'
import type { ReceptionTagInput } from '@/features/raw-batches/receptionTagZpl'
import { receptionTagsPrintJobs, tagPrintDelayMs } from '@/features/raw-batches/receptionTagsPrint'
import {
  LABEL_LENGTH_MAX_MM, LABEL_LENGTH_MIN_MM, calibrationTestZpl, loadCalibration, saveCalibration, tearOffZpl,
  type TagPrinterCalibration,
} from '@/features/raw-batches/tagPrinterCalibration'

/** Rolka zawieszek przyjęcia. */
export const ROLKA_ZAWIESZEK: ZebraProfileId = '80x100'

export interface Postep { onStatus?: (tekst: string) => void; onProgress?: (wyslane: number, razem: number) => void }

/** Drukarka do druku — albo błąd słowami biura. */
export async function drukarka(): Promise<ZebraDevice> {
  const { default: def, list } = await getDevices()
  const dev = def ?? list[0]
  if (!dev) throw new Error(selectedZebraUid()
    ? 'Zapamiętana drukarka etykiet nie odpowiada — sprawdź USB i zasilanie albo wybierz inną w ustawieniach drukarki.'
    : 'Nie widzę drukarki etykiet — sprawdź, czy Zebra jest włączona i podłączona do tego komputera.')
  return dev
}

/** Komunikat błędu z podpowiedzią sondy — zwykle winna jest usługa BrowserPrint, nie drukarka. */
export async function opisBledu(e: unknown): Promise<string> {
  const probe = await probeBrowserPrint().catch(() => ({ ok: false, reason: undefined as string | undefined }))
  return `${zebraErrorMessage(e)}${!probe.ok && probe.reason ? ` ${probe.reason}` : ''}`
}

const skokWZakresie = (mm: number | null): mm is number => mm !== null && mm >= LABEL_LENGTH_MIN_MM && mm <= LABEL_LENGTH_MAX_MM

/**
 * Przed serią: rolka ta sama i drukarka zgłasza pasującą długość → bierzemy jej
 * pomiar; inna rolka, przerwana kalibracja albo długość nie pasuje → kalibracja
 * teraz (i tak zrobiłby ją `lib/zebra` przy pierwszej etykiecie, ale wtedy nie
 * znalibyśmy skoku dla `^LL`). null = brak odczytu — zostaje nastawa stanowiska.
 */
export async function przygotuj(dev: ZebraDevice, profil: ZebraProfileId, p: Postep = {}): Promise<number | null> {
  if (!dev.sendThenRead) return null // starszy BrowserPrint nie odczytuje — sam zapis jak w starym MES
  if (loadedZebraMedia(dev.uid) === profil && !zebraCalibrationPending(dev.uid)) {
    const { status } = await withZebraPrinter(dev, io => readZebraStatus(io))
    // Brak pełnej odpowiedzi: wydruk i tak zatrzyma się z czytelnym błędem (kontrola gotowości w lib/zebra).
    if (!status.valid) return null
    if (zebraLengthMatches(profil, status.labelLengthMm)) return status.labelLengthMm
  }
  p.onStatus?.('Nowa rolka — drukarka sama mierzy etykietę…')
  return (await calibrateZebra(dev, profil, p.onStatus)).lengthMm
}

/** Skok taśmy z pomiaru drukarki do nastawy stanowiska (po cichu, tylko gdy się zmienił). */
export function przyjmijSkok(mm: number | null, cal: TagPrinterCalibration = loadCalibration()): TagPrinterCalibration {
  return skokWZakresie(mm) && Math.abs(mm - cal.labelLengthMm) >= 0.05 ? saveCalibration({ ...cal, labelLengthMm: mm }) : cal
}

/**
 * Seria zawieszek: ciągiem (domyślnie) albo po jednej.
 * Ciągiem — jedno zadanie z całą serią: jedna kontrola gotowości i druk bez przerw
 * (właściciel 31.10.2026: „ma drukować ciągle, szybko”). Każdy format niesie `^LL`
 * i `^MNY`, więc etykiety trzymają się przerw na taśmie; do oderwania staje
 * po ostatniej. Po jednej — zadanie na zawieszkę z przerwą, każda staje do
 * oderwania osobno (tak drukował stary MES od 26.08.2026).
 */
export async function drukujZawieszki(tags: readonly ReceptionTagInput[], p: Postep = {}): Promise<void> {
  const dev = await drukarka()
  const cal = przyjmijSkok(await przygotuj(dev, ROLKA_ZAWIESZEK, p))
  const zadania = receptionTagsPrintJobs(tags, cal)
  if (trybSerii() === 'ciagiem') {
    p.onStatus?.(`Drukuję ciągiem: ${tags.length} szt.…`)
    await sendZplJobs(dev, [zadania.join('\n')], { onStatus: p.onStatus })
    p.onProgress?.(tags.length, tags.length)
    return
  }
  await sendZplJobs(dev, zadania, { delayMs: tagPrintDelayMs(cal.labelLengthMm), onProgress: p.onProgress, onStatus: p.onStatus })
}

export type TrybSerii = 'ciagiem' | 'pojedynczo'
const KLUCZ_SERII = 'protrima.zawieszki.seria'
/** Osobny klucz, nie nastawa ze starego MES: jego zapis kalibracji wyciąłby nieznane pole. */
export function trybSerii(): TrybSerii {
  try { return localStorage.getItem(KLUCZ_SERII) === 'pojedynczo' ? 'pojedynczo' : 'ciagiem' } catch { return 'ciagiem' }
}
export function ustawTrybSerii(t: TrybSerii) {
  try { localStorage.setItem(KLUCZ_SERII, t) } catch { /* bez pamięci — zostaje domyślny */ }
}

/** „Zmieniam rolkę”: kalibracja na żądanie, skok z pomiaru. */
export async function zmienRolke(p: Postep = {}): Promise<string> {
  const dev = await drukarka()
  const wynik = await calibrateZebra(dev, ROLKA_ZAWIESZEK, p.onStatus)
  przyjmijSkok(wynik.lengthMm)
  return skokWZakresie(wynik.lengthMm)
    ? `Drukarka zmierzyła etykietę: ${String(wynik.lengthMm).replace('.', ',')} mm. Gotowa do druku.`
    : wynik.message
}

export async function drukujTest(): Promise<void> {
  await sendZplJobs(await drukarka(), [calibrationTestZpl(loadCalibration())])
}

/** Punkt odrywania to nastawa TRWAŁA drukarki — idzie wyłącznie na żądanie, nigdy z wydrukiem (22.08.2026). */
export async function ustawOdrywanie(mm: number): Promise<void> {
  await sendZpl(await drukarka(), tearOffZpl(mm))
}

export interface StanDrukarki {
  /** null = drukarki nie widać (powód w `powod`). */
  nazwa: string | null
  uid: string | null
  model: string
  gotowa: boolean
  /** Problemy zgłoszone przez drukarkę, słowami (brak papieru, otwarta pokrywa…). */
  problemy: string[]
  rolka: string | null
  skokMm: number | null
  powod?: string
  /** Inne drukarki widoczne przez BrowserPrint — wybór pokazujemy tylko, gdy jest z czego. */
  inne: Array<{ uid: string; nazwa: string }>
}

/** Odczyt stanu bez drukowania: kto, czy gotowa, jaka rolka i skok. */
export async function stanDrukarki(): Promise<StanDrukarki> {
  const pusty: StanDrukarki = { nazwa: null, uid: null, model: '', gotowa: false, problemy: [], rolka: null, skokMm: null, inne: [] }
  let lista: ZebraDevice[] = []
  try {
    lista = await discoverZebraDevices()
  } catch (e) {
    return { ...pusty, powod: await opisBledu(e) }
  }
  const inne = lista.map(d => ({ uid: d.uid, nazwa: d.name }))
  let dev: ZebraDevice
  try { dev = await drukarka() } catch (e) { return { ...pusty, inne, powod: e instanceof Error ? e.message : String(e) } }
  const rolkaId = loadedZebraMedia(dev.uid)
  const baza = { ...pusty, nazwa: dev.name, uid: dev.uid, inne, rolka: rolkaId ? ZEBRA_PROFILES[rolkaId].name : null }
  if (!dev.sendThenRead) return { ...baza, gotowa: true, powod: 'Ta wersja BrowserPrint nie odczytuje stanu drukarki — druk działa, ale bez kontroli gotowości.' }
  try {
    const { id, status } = await withZebraPrinter(dev, async io => {
      const id = parsePrinterIdentity(await io.read(IDENTIFY_ZPL))
      return { id, status: (await readZebraStatus(io)).status }
    })
    if (!status.valid) return { ...baza, model: id.model, powod: 'Drukarka nie odpowiada na pytanie o stan — sprawdź zieloną kontrolkę, papier i USB.' }
    const problemy = printerProblems(status)
    return { ...baza, model: id.model, gotowa: problemy.length === 0, problemy, skokMm: status.labelLengthMm }
  } catch (e) {
    return { ...baza, powod: await opisBledu(e) }
  }
}

export const wybierzDrukarke = (uid: string) => selectZebra(uid)
