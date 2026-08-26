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
  /** Długość etykiety, jaką drukarka ma u siebie — w punktach. */
  labelLengthDots: number | null
  /** To samo w milimetrach, przy rozdzielczości drukarki. */
  labelLengthMm: number | null
  paperOut: boolean
  paused: boolean
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
    labelLengthDots: null, labelLengthMm: null, paperOut: false, paused: false,
  }
  const wiersz = odczyszczone(raw).split('\n').map(w => w.trim()).find(w => w.includes(','))
  if (!wiersz) return pusty

  const pola = wiersz.split(',')
  if (pola.length < 4) return pusty

  const dots = Number.parseInt(pola[3], 10)
  const ok = Number.isFinite(dots) && dots > 0
  return {
    labelLengthDots: ok ? dots : null,
    labelLengthMm: ok ? Math.round((dots * 25.4) / dpi * 10) / 10 : null,
    paperOut: pola[1]?.trim() === '1',
    paused: pola[2]?.trim() === '1',
  }
}

/** `~HI` → „model,wersja firmware,dpi,pamięć" (pola bywają puste na starych seriach). */
export function parsePrinterIdentity(raw: string): PrinterIdentity {
  const tekst = odczyszczone(raw).trim()
  const pola = tekst.split(',').map(p => p.trim())
  const dpi = Number.parseInt((pola[2] ?? '').replace(/[^0-9]/g, ''), 10)
  return {
    model: pola[0] || '',
    firmware: pola[1] || '',
    dpi: Number.isFinite(dpi) && dpi > 0 ? dpi : null,
  }
}

/**
 * Podsumowanie dla biura: jedno zdanie, z którego widać, czy drukarka i MES
 * mówią o tej samej etykiecie. Nominał to wysokość zawieszki (80 mm).
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
        `⚠ Rozjazd ${roznica > 0 ? '+' : ''}${String(roznica).replace('.', ',')} mm — TO jest przyczyna.`
        + ' Wpisz zmierzoną długość w „Skok taśmy" albo uruchom „Kalibruj etykiety".',
      )
    }
  }
  if (status.paperOut) linie.push('⚠ Drukarka zgłasza brak papieru.')
  if (status.paused) linie.push('⚠ Drukarka jest w pauzie.')
  return linie
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
