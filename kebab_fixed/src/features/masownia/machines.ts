/**
 * Stałe masowni potwierdzone przez halę (2026-08-27).
 */

/**
 * Masownice hali: `cap` to wsad STANDARDOWY, `max` to granica, powyżej której
 * maszyna już nie miesza.
 *
 * Na ekranie pokazujemy wyłącznie `cap`. Wypisany zapas zrobiłby z siebie
 * normę — operator widzi 200 i 600, a o granicy dowiaduje się dopiero wtedy,
 * gdy w nią uderzy, bo wtedy musi wiedzieć, ile zdjąć.
 */
export const MACHINES: { id: 1 | 2 | 3; cap: number; max: number }[] = [
  { id: 1, cap: 200, max: 250 },
  { id: 2, cap: 200, max: 250 },
  { id: 3, cap: 600, max: 700 },
]

export const maszyna = (id: number) => MACHINES.find(m => m.id === id) ?? null

/** O ile wolno przekroczyć dany wsad nominalny — `max` minus standard tej
 *  maszyny. Używane przy ważeniu przypraw, gdzie maszyny jeszcze nie ma. */
export function zapasNadNominalem(cap: number): number {
  const m = MACHINES.find(x => x.cap === cap)
  return m ? m.max - m.cap : 0
}

/** Minuty masowania — tyle trzyma blokada maszyny w MES. */
export const T_MIX_MIN = 50

/** Tolerancja wagi przypraw = DZIAŁKA wagi masowni: 100 g.
 *
 *  Prototyp mówił 0,05 kg, ale hala potwierdziła (17.09.2026), że waga
 *  przypraw ma działkę 100 g. Próg węższy od działki jest nieosiągalny:
 *  odczyt skacze co 100 g, więc bramka nigdy by nie puściła dalej i operator
 *  utknąłby na pierwszym składniku. */
export const TOL_SPICE_KG = 0.1

/** Czy wsad wejdzie do TEJ masownicy. Ponad `max` blokujemy — przepełniona
 *  masownica nie miesza równo, a operator zauważa to dopiero po 50 minutach. */
export function fitsMachine(kg: number, machineId: number): boolean {
  const m = maszyna(machineId)
  return m ? kg <= m.max + 1e-9 : false
}

/** Masownice, które wezmą wsad tej wielkości — pusta lista znaczy, że to nie
 *  jest JEDEN wsad i trzeba go rozbić.
 *
 *  Potrzebne przy niestandardowych ilościach z planu biura (507 kg fileta,
 *  440 kg z/s): standardowe kafelki 200/600 mówią „masownica 1 lub 2" / „3"
 *  z nominału, a przy reszcie zlecenia nominału nie ma — jest tylko granica. */
export function maszynyDla(kg: number): number[] {
  return MACHINES.filter(m => kg > 0 && kg <= m.max + 1e-9).map(m => m.id)
}

/** Dopuszczalny odchył dawki wody: pół litra, niezależnie od wielkości dawki.
 *
 *  Pierwotnie było ±3% „bo tyle wynosi dokładność DW-1C" — przy 112 L dawało
 *  to widełki 108,6–115,4 i hala słusznie powiedziała, że to nie jest dawka,
 *  tylko przedział. Woda wpływa na wsad wprost, więc zadane 112 znaczy 112.
 */
export const TOL_WODA_L = 0.5

export function waterWindow(targetL: number): { min: number; max: number } {
  return {
    min: Math.round((targetL - TOL_WODA_L) * 10) / 10,
    max: Math.round((targetL + TOL_WODA_L) * 10) / 10,
  }
}

/** Tożsamość partii przyprawionej, pokazywana operatorowi PRZED startem.
 *
 *  Jeden wsad surowca → partia nosi jego numer (511 zostaje 511). Dwa i więcej
 *  → partia jest mieszana, a numeru JESZCZE NIE MA: licznik PP jest wspólny dla
 *  całego MES, więc PP{n} nadaje backend dopiero przy odbiorze
 *  (`seasoned_batch_no_from_raw`). Panel wypisujący własne „PP3" pokazywałby
 *  numer, który po 50 minutach mógłby wyjść inny — dlatego zwraca pusty numer
 *  i listę partii. Reguła 1:1 z `masownia_service._batch_no_of`. */
export function batchNoFromLots(lotNos: string[]): { no: string; mixed: boolean; lots: string[] } {
  const rozne = [...new Set(lotNos.filter(Boolean))].sort()
  if (rozne.length === 1) return { no: rozne[0], mixed: false, lots: rozne }
  return { no: '', mixed: rozne.length > 1, lots: rozne }
}
