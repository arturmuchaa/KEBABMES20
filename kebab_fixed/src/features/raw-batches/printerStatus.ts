/**
 * Odczyt ustawień z drukarki etykiet — czym ona sama się posługuje.
 *
 * POWÓD ISTNIENIA: 22.08.2026 poszły trzy wydania pod rząd na zgadywanie, czemu
 * zawieszki wychodzą urwane i tną się w złym miejscu. Ustawienia drukarki były
 * dla nas czarną skrzynką, więc każda poprawka była strzałem. Drukarka umie
 * powiedzieć, jaką ma DŁUGOŚĆ ETYKIETY — wystarczy ją zapytać.
 *
 * `^HH` (konfiguracja do hosta) NIE działa na Zebrze GC420t — biuro dostało
 * pustą odpowiedź, choć zapis (`~JC`) działał. GC420t to stara seria G i zna
 * komendy natychmiastowe `~HI` (identyfikacja) i `~HS` (status), i to ich
 * używamy. `~HS` niesie długość etykiety W PUNKTACH — jedyną liczbę, która
 * rozstrzyga, czy drukarka i my mówimy o tej samej etykiecie.
 *
 * Czyste parsery bez DOM — testowane jednostkowo.
 */
import { LABEL_DPI } from '@/features/deboning/byproductLabelZpl'

/** Identyfikacja drukarki (`~HI`) i status (`~HS`) — obie natychmiastowe,
 *  wysyłane POZA `^XA…^XZ`. Kolejność ma znaczenie: najpierw kto, potem co. */
export const IDENTIFY_ZPL = '~HI'
export const STATUS_ZPL = '~HS'

/** `~WC` drukuje etykietę konfiguracyjną — ratunek, gdy drukarka nie gada. */
export const PRINT_CONFIG_ZPL = '~WC'

export interface PrinterStatus {
  /** Pełne trzy wiersze ~HS; pustej odpowiedzi nie wolno uznać za gotowość. */
  valid: boolean
  /** Długość etykiety, jaką drukarka ma u siebie — w punktach. */
  labelLengthDots: number | null
  /** To samo w milimetrach, przy rozdzielczości drukarki. */
  labelLengthMm: number | null
  paperOut: boolean
  paused: boolean
  bufferFull: boolean
  formatsInBuffer: number
  labelsRemaining: number
  headOpen: boolean
  ribbonOut: boolean
  tooCold: boolean
  tooHot: boolean
  corruptRam: boolean
  partialFormat: boolean
}

export interface PrinterIdentity {
  model: string
  firmware: string
  /** Rozdzielczość zgłoszona przez drukarkę (dpi), o ile ją podała. */
  dpi: number | null
}

/** Znaki sterujące ramki odpowiedzi (STX/ETX/CR/LF) — do wyrzucenia. */
function odczyszczone(raw: string): string {
  return (raw ?? '').replace(/[\r]/g, '')
}

/**
 * `~HS` → pierwszy wiersz odpowiedzi to:
 *   aaa,b,c,dddd,eee,f,g,h,iii,j,k,l
 * gdzie `b` = brak papieru, `c` = pauza, a `dddd` = DŁUGOŚĆ ETYKIETY w punktach.
 */
export function parsePrinterStatus(raw: string, dpi: number = LABEL_DPI): PrinterStatus {
  const pusty: PrinterStatus = {
    valid: false, labelLengthDots: null, labelLengthMm: null, paperOut: false, paused: false,
    bufferFull: false, formatsInBuffer: 0, labelsRemaining: 0, headOpen: false,
    ribbonOut: false, tooCold: false, tooHot: false, corruptRam: false, partialFormat: false,
  }
  const rows = (raw ?? '').replace(/[\x02\r]/g, '').split(/[\x03\n]/).map(w => w.trim()).filter(Boolean)
  const wiersz = rows.find(w => /^\d{3},[01],[01],\d+,/.test(w))
  if (!wiersz) return pusty

  const pola = wiersz.split(',')
  if (pola.length < 4) return pusty

  const dots = Number.parseInt(pola[3], 10)
  const ok = Number.isFinite(dots) && dots > 0
  const second = rows[rows.indexOf(wiersz) + 1]?.split(',') ?? []
  const third = rows[rows.indexOf(wiersz) + 2]?.split(',') ?? []
  return {
    valid: pola.length === 12 && second.length === 11 && third.length === 2
      && [...pola, ...second, ...third].every(p => /^\d+$/.test(p.trim())) && ok,
    labelLengthDots: ok ? dots : null,
    labelLengthMm: ok ? Math.round((dots * 25.4) / dpi * 10) / 10 : null,
    paperOut: pola[1]?.trim() === '1',
    paused: pola[2]?.trim() === '1',
    formatsInBuffer: Number(pola[4]) || 0,
    bufferFull: pola[5] === '1',
    partialFormat: pola[7] === '1',
    corruptRam: pola[9] === '1',
    tooCold: pola[10] === '1',
    tooHot: pola[11] === '1',
    headOpen: second[2] === '1',
    ribbonOut: second[3] === '1',
    labelsRemaining: Number(second[8]) || 0,
  }
}

/** `~HI` → „model,wersja firmware,dpi,pamięć" (pola bywają puste na starych seriach). */
export function parsePrinterIdentity(raw: string): PrinterIdentity {
  const tekst = odczyszczone(raw).trim()
  const pola = tekst.split(',').map(p => p.trim())
  const resolution = Number.parseInt((pola[2] ?? '').replace(/[^0-9]/g, ''), 10)
  // ~HI na serii G podaje dots/mm (8), nie zawsze dpi (203).
  const dpi = ({ 6: 152, 8: 203, 12: 300, 24: 600 } as Record<number, number>)[resolution] ?? resolution
  return {
    model: pola[0] || '',
    firmware: pola[1] || '',
    dpi: Number.isFinite(dpi) && dpi > 0 ? dpi : null,
  }
}

/**
 * Podsumowanie dla biura: jedno zdanie, z którego widać, czy drukarka i MES
 * mówią o tej samej etykiecie. Nominał to wysokość zawieszki (100 mm).
 */
export function printerSummary(
  identity: PrinterIdentity,
  status: PrinterStatus,
  nominalMm: number,
): string[] {
  const linie: string[] = []
  if (identity.model) {
    linie.push(`Drukarka: ${identity.model}${identity.firmware ? ` (${identity.firmware})` : ''}`)
  }
  if (status.labelLengthMm !== null) {
    const roznica = Math.round((status.labelLengthMm - nominalMm) * 10) / 10
    linie.push(
      `Długość etykiety w drukarce: ${String(status.labelLengthMm).replace('.', ',')} mm`
      + ` (${status.labelLengthDots} pkt), zawieszka ma ${nominalMm} mm`,
    )
    if (Math.abs(roznica) >= 1) {
      linie.push(
        `⚠ Różnica ${roznica > 0 ? '+' : ''}${String(roznica).replace('.', ',')} mm.`
        + ' Sprawdź rolkę i kalibrację; odczyt może uwzględniać przerwę między etykietami.',
      )
    }
  }
  linie.push(...printerProblems(status).map(p => `⚠ ${p}`))
  if (status.formatsInBuffer || status.labelsRemaining) {
    linie.push(`W buforze: ${status.formatsInBuffer} formatów; pozostało etykiet: ${status.labelsRemaining}.`)
  }
  return linie
}

export function printerProblems(status: PrinterStatus): string[] {
  return [
    status.paperOut && 'Drukarka zgłasza brak papieru.',
    status.paused && 'Drukarka jest w pauzie.',
    status.headOpen && 'Pokrywa / głowica drukarki jest otwarta.',
    status.ribbonOut && 'Drukarka zgłasza brak kalki. Dla Waszych rolek wybierz druk termiczny bez kalki.',
    status.bufferFull && 'Bufor drukarki jest pełny. Poczekaj na zakończenie poprzednich wydruków.',
    status.tooHot && 'Głowica drukarki jest przegrzana.',
    status.tooCold && 'Głowica drukarki jest zbyt zimna.',
    status.corruptRam && 'Drukarka zgłasza błąd pamięci RAM.',
    status.partialFormat && 'W buforze jest niekompletny format. Sprawdź poprzednie zadanie i połączenie USB.',
  ].filter((p): p is string => Boolean(p))
}

/**
 * Przestawienie drukarki na ZPL — polecenie SGD, wysyłane POZA `^XA…^XZ`.
 *
 * GC420t bywa fabrycznie w trybie EPL (nagłówek wydruku konfiguracyjnego:
 * „ZTC GC420t (EPL)"). Formaty ZPL wtedy jeszcze się drukują, bo drukarka
 * rozpoznaje je per zadanie, ale TRWAŁE nastawy ZPL nie mają się gdzie
 * zapisać: punkt odrywania `~TA` i śledzenie taśmy `^MN` przechodzą bez
 * echa, `~HI` milczy, a wydruk urywa się na długości zapamiętanej po stronie
 * EPL. Biuro widziało to jako „wpisane, a nic nie zmienia" i etykiety ucięte
 * w 3/4 z czerwoną kontrolką.
 *
 * Nastawa jest TRWAŁA — wystarczy raz na drukarkę.
 */
export const SET_ZPL_MODE = '! U1 setvar "device.languages" "zpl"\n'

/**
 * Czy drukarka wygląda na stojącą w EPL.
 *
 * Dwa sygnały: `~HI` (identyfikacja) milczy, choć `~HS` (status) odpowiada —
 * albo identyfikacja wprost niesie „(EPL)". Cisza na OBU pytaniach to zwykły
 * brak łączności, nie tryb języka; nie strasz wtedy bez powodu.
 */
export function epLModeSuspected(o: { identify: string; status: string }): boolean {
  const hi = (o.identify || '').trim()
  const hs = (o.status || '').trim()
  if (hi.toUpperCase().includes('(EPL)')) return true
  return hs.length > 0 && hi.length === 0
}
