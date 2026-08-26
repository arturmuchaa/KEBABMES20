/**
 * Kalibracja drukarki zawieszek — nastawa KONKRETNEGO komputera w biurze.
 *
 * Zawieszki na palety drukują się seriami po kilkanaście sztuk i biuro
 * zgłosiło (22.08.2026), że „co druga jest źle skalibrowana": jedna wychodzi
 * równo, następna przesunięta. To nie wina układu etykiety — ten sam ZPL jedzie
 * na każdą sztukę — tylko tego, że drukarka gubi początek etykiety między
 * wydrukami. Lekarstwo to `~JC`: drukarka wypuszcza kilka etykiet i MIERZY
 * czujnikiem etykietę razem z przerwą.
 *
 * ODRZUCONA HIPOTEZA (nie wracać): że winne jest powtarzanie `^LL` i `^MNY`
 * w każdej etykiecie. Wyniesienie ich do preambuły wysyłanej raz na serię
 * urwało wydruki w 3/4 etykiety na Zebrze GC420t — bez `^LL` w formacie
 * drukarka bierze długość zapisaną u siebie. Komendy wróciły do każdej
 * etykiety, a serię wysyłamy jednym strumieniem (`receptionTagsStreamZpl`).
 *
 * Jeżeli po kalibracji wydruk nadal siedzi krzywo o stałą wartość — to już
 * cecha rolki i drukarki, nie logiki — biuro dosuwa go `offsetXMm`/`offsetYMm`.
 * Nastawa zostaje na TYM komputerze (localStorage), bo drugie stanowisko ma
 * swoją drukarkę i swoją rolkę.
 *
 * Czysta logika bez DOM i bez Reacta — testowana jednostkowo.
 */
import { LABEL_DPI, LABEL_H_MM, LABEL_W_MM, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { CALIBRATE_ZPL, tearOffMaxMm, tearOffZpl } from '@/features/deboning/labelPrinterSetup'

// Komendy serwisowe są wspólne z halą — JEDNO źródło, żeby kiosk i biuro nie
// rozjechały się przy pierwszej poprawce.
export { CALIBRATE_ZPL, tearOffMaxMm, tearOffZpl }

/** Ile wolno dosunąć wydruk. Więcej niż 5 mm to nie kalibracja, tylko objaw:
 *  źle zmierzona taśma (`~JC`) albo źle założona rolka. */
export const OFFSET_MAX_MM = 5

/** Rozsądny zakres skoku taśmy dla zawieszek 50×80 mm z przerwą. */
export const LABEL_LENGTH_MIN_MM = 60
export const LABEL_LENGTH_MAX_MM = 110

/** Klucz w localStorage — nastawa jest cechą stanowiska, nie użytkownika. */
export const CALIBRATION_STORAGE_KEY = 'kebab.biuro.zawieszki.kalibracja'

export interface TagPrinterCalibration {
  /** Przesunięcie wydruku w poprzek taśmy; + w prawo. */
  offsetXMm: number
  /** Przesunięcie wydruku wzdłuż taśmy; + w dół (dalej od początku etykiety). */
  offsetYMm: number
  /** Rzeczywisty skok taśmy: etykieta + przerwa. */
  labelLengthMm: number
  /** Punkt zatrzymania taśmy po wydruku (`~TA`). */
  tearOffMm: number
}

/**
 * Skok taśmy zmierzony przez drukarkę biura (ZTC GC420t, wydruk
 * konfiguracyjny 22.08.2026): `LABEL LENGTH 0658` = 82,3 mm. Zawieszka ma
 * 80 mm — reszta to przerwa między etykietami.
 *
 * To musi być WARTOŚĆ DOMYŚLNA, nie coś do wyklikania. Do 26.08 domyślne było
 * 80 mm, a zmierzone 82,3 dawał dopiero przycisk „Ustaw skok taśmy z drukarki"
 * po udanym odczycie ustawień — a ta drukarka odpowiada tylko wydrukiem
 * konfiguracji na taśmie, więc przycisk nigdy się nie pokazał i biuro przez
 * cztery dni odrywało zawieszki w poprzek.
 */
export const MEASURED_LABEL_PITCH_MM = 82.3

/** Stara wartość domyślna — po niej poznajemy nastawę, której nikt nie ruszał. */
const LEGACY_LABEL_LENGTH_MM = LABEL_H_MM

export const DEFAULT_CALIBRATION: TagPrinterCalibration = {
  offsetXMm: 0,
  offsetYMm: 0,
  labelLengthMm: MEASURED_LABEL_PITCH_MM,
  tearOffMm: 0,
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return round1(Math.min(max, Math.max(min, n)))
}

/** Nastawa z dowolnego wejścia (JSON z localStorage, pole formularza) sprowadzona
 *  do wartości, którą wolno wysłać na drukarkę. Śmieć = wartość domyślna, nie NaN:
 *  `^FO` z NaN drukarka odrzuca w całości i etykieta wychodzi pusta. */
export function clampCalibration(patch?: Partial<TagPrinterCalibration> | null): TagPrinterCalibration {
  const maxTear = tearOffMaxMm()
  return {
    offsetXMm: clamp(patch?.offsetXMm, -OFFSET_MAX_MM, OFFSET_MAX_MM, DEFAULT_CALIBRATION.offsetXMm),
    offsetYMm: clamp(patch?.offsetYMm, -OFFSET_MAX_MM, OFFSET_MAX_MM, DEFAULT_CALIBRATION.offsetYMm),
    labelLengthMm: clamp(
      patch?.labelLengthMm, LABEL_LENGTH_MIN_MM, LABEL_LENGTH_MAX_MM, DEFAULT_CALIBRATION.labelLengthMm),
    tearOffMm: clamp(patch?.tearOffMm, -maxTear, maxTear, DEFAULT_CALIBRATION.tearOffMm),
  }
}

/** Czy nastawa jest zerowa — ekran nie musi krzyczeć o czymś, czego nie ruszono. */
export function isDefaultCalibration(cal: TagPrinterCalibration): boolean {
  const c = clampCalibration(cal)
  return c.offsetXMm === 0 && c.offsetYMm === 0 && c.tearOffMm === 0
    && c.labelLengthMm === DEFAULT_CALIBRATION.labelLengthMm
}

type Magazyn = Pick<Storage, 'getItem' | 'setItem'>

function storage(): Magazyn | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadCalibration(store: Magazyn | null = storage()): TagPrinterCalibration {
  try {
    const raw = store?.getItem(CALIBRATION_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CALIBRATION }
    const zapisana = clampCalibration(JSON.parse(raw) as Partial<TagPrinterCalibration>)
    // Nastawa zapisana STARĄ wartością domyślną (80 mm) znaczy „nikt tego nie
    // ruszał" — podnosimy ją do zmierzonej. Bez tego poprawka minęłaby każdą
    // maszynę, która choć raz otworzyła ten ekran.
    return zapisana.labelLengthMm === LEGACY_LABEL_LENGTH_MM
      ? { ...zapisana, labelLengthMm: MEASURED_LABEL_PITCH_MM }
      : zapisana
  } catch {
    // Uszkodzony wpis nie może zablokować druku zawieszek — wracamy do domyślnej.
    return { ...DEFAULT_CALIBRATION }
  }
}

export function saveCalibration(cal: TagPrinterCalibration, store: Magazyn | null = storage()): TagPrinterCalibration {
  const czysta = clampCalibration(cal)
  try {
    store?.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(czysta))
  } catch {
    // Tryb prywatny albo pełny dysk: druk ma działać dalej, tylko bez pamięci.
  }
  return czysta
}

/** Milimetry ze znakiem, po polsku: „+1,5 mm". */
export function fmtOffsetMm(mm: number): string {
  const r = round1(Number(mm) || 0)
  const s = (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',')
  return r > 0 ? `+${s}` : s
}

/**
 * Wydruk testowy: ramka po KRAWĘDZI etykiety i druga po polu zadruku zawieszki.
 * Brakująca krawędź mówi wprost, w którą stronę uciekł wydruk — inaczej biuro
 * ocenia kalibrację po tym, czy „wygląda krzywo", a to nie jest miara.
 */
export function calibrationTestZpl(
  cal: TagPrinterCalibration = DEFAULT_CALIBRATION,
  dpi: number = LABEL_DPI,
): string {
  const c = clampCalibration(cal)
  const dot = (mm: number) => Math.max(0, mmToDots(mm, dpi))
  const gruba = Math.max(1, mmToDots(0.5, dpi))
  const cienka = Math.max(1, mmToDots(0.3, dpi))
  const M = 3 // margines pola zadruku zawieszki

  const fo = (xMm: number, yMm: number) => `^FO${dot(xMm + c.offsetXMm)},${dot(yMm + c.offsetYMm)}`
  const text = (xMm: number, yMm: number, fontMm: number, value: string) => {
    const h = mmToDots(fontMm, dpi)
    return `${fo(xMm, yMm)}^A0N,${h},${h}^FD${value}^FS`
  }

  // Znaczniki co 10 mm wzdłuż taśmy: po nich widać, o ile milimetrów uciekł
  // wydruk, bez przykładania linijki do etykiety.
  const podzialka: string[] = []
  for (let y = 10; y < LABEL_H_MM; y += 10) {
    podzialka.push(`${fo(0, y)}^GB${dot(4)},${cienka},${cienka}^FS`)
    podzialka.push(text(5, y - 1.5, 2.6, `${y}`))
  }

  return [
    '^XA',
    '^CI28',
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,
    `^LL${mmToDots(c.labelLengthMm, dpi)}`,
    '^LH0,0',
    '^MNY',
    '^LS0',
    // Krawędź etykiety — musi wyjść w całości, na wszystkich czterech bokach.
    `${fo(0, 0)}^GB${dot(LABEL_W_MM)},${dot(LABEL_H_MM)},${gruba}^FS`,
    // Pole zadruku zawieszki (3 mm marginesu) — w nim siedzą wszystkie napisy.
    `${fo(M, M)}^GB${dot(LABEL_W_MM - 2 * M)},${dot(LABEL_H_MM - 2 * M)},${cienka}^FS`,
    ...podzialka,
    text(M + 2, 30, 4.5, 'KALIBRACJA'),
    text(M + 2, 36, 3.2, `X ${fmtOffsetMm(c.offsetXMm)} mm`),
    text(M + 2, 40, 3.2, `Y ${fmtOffsetMm(c.offsetYMm)} mm`),
    text(M + 2, 44, 3.2, `Etykieta ${fmtOffsetMm(c.labelLengthMm).replace('+', '')} mm`),
    text(M + 2, 48, 3.2, `Odrywanie ${fmtOffsetMm(c.tearOffMm)} mm`),
    '^XZ',
  ].join('\n')
}
