/**
 * deboningReportBalance — domknięcie raportu rozbioru 2.1.1 do masy przyjęcia.
 *
 * PO CO TO JEST
 * Karta 2.1.1 (do instrukcji 2.1 oPRP) ma jedną twardą własność: SUMA frakcji
 * musi równać się pozycji „masa surowców do rozbioru". Formularz nie ma rubryki
 * na nadwyżkę — a pomiar tę nadwyżkę produkuje systematycznie, około 1% wsadu:
 * ćwiartkę waży dostawca (dokument HDI), frakcje ważymy my, po odcieku i na
 * innych taryfach wózków. Partia 461 z 5.08.2026: ćwiartka 3 720 kg, frakcje
 * 3 832 kg — 112 kg „z powietrza". Partia 460 tego samego dnia: 48 kg w drugą
 * stronę.
 *
 * KTÓRA LICZBA JEST NIENARUSZALNA
 * Mięso. Te kilogramy jadą z rozbioru prosto do masowania i wpisują się do
 * karty produkcji — gdyby raport rozbioru zaniżył je „dla bilansu", dwa
 * dokumenty z tego samego dnia przeczyłyby sobie nawzajem. Mięso w karcie jest
 * więc równe pomiarowi z HMI co do grosza, a całą nadwyżkę (albo ubytek)
 * biorą na siebie grzbiety i kości. Decyzja właściciela 2026-08-14.
 *
 * CZEGO TEN MODUŁ NIE ROBI
 * Nie dotyka MES. Pomiar (deboning_entries, batch_byproducts) zostaje bez
 * zmian — na nim liczy się akord, koszt kilograma, uzysk pracownika, stany
 * magazynu, WZ na uboczne i raport zarządczy. Korekta żyje WYŁĄCZNIE w
 * warstwie wydruku karty 2.1.1, dlatego jest osobną, czystą funkcją, a nie
 * poprawką w serwisie.
 */

/** Docelowe udziały ubocznych w masie przyjęcia [%] — decyzja właściciela. */
export const REPORT_BANDS = {
  backs: { lo: 19.0, hi: 20.0 },
  bones: { lo: 15.0, hi: 17.0 },
  /** Używane tylko jako ratunek, gdy pomiar mięsa przekracza masę wsadu. */
  meat:  { lo: 63.0, hi: 66.0 },
} as const

/** Podział reszty, gdy uboczne nie zostały jeszcze zważone (19 : 15). */
const NOMINAL_BACKS_RATIO =
  REPORT_BANDS.backs.lo / (REPORT_BANDS.backs.lo + REPORT_BANDS.bones.lo)

export interface MeasuredFractions {
  /** Masa surowców do rozbioru (ćwiartka pobrana) [kg]. */
  readonly takenKg: number
  readonly meatKg:  number
  readonly backsKg: number
  readonly bonesKg: number
}

export interface BalancedFractions {
  readonly takenKg: number
  readonly meatKg:  number
  readonly backsKg: number
  readonly bonesKg: number
  /** false = wiersz zostawiony bez zmian (brak masy albo brak zważonego mięsa). */
  readonly balanced: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100
/** Waga na hali chodzi co 0,5 kg — liczby na karcie mają tak wyglądać. */
const roundHalf = (v: number) => Math.round(v * 2) / 2

/**
 * Zwraca frakcje przeliczone tak, żeby mięso + grzbiety + kości = masa przyjęcia.
 *
 * 1. Mięso zostaje takie, jak zważono — to ono musi zgadzać się z produkcją.
 * 2. Na uboczne zostaje reszta wsadu. Dzieli się ją w proporcji ZMIERZONEJ,
 *    dociętej do pasm 19–20% (grzbiety) i 15–17% (kości).
 * 3. Przy uzysku ponad 66% na uboczne zostaje mniej niż 34% wsadu i oba pasma
 *    naraz przestają być wykonalne. Wtedy pierwszeństwo mają grzbiety (pasmo
 *    węższe), a niedomiar bierze na siebie pozycja kości.
 * 4. Grzbiety zaokrąglone do 0,5 kg (działka wagi hali), kości jako różnica —
 *    dzięki temu obie liczby są w połówkach, a SUMA nie „ucieka" o grosz.
 */
export function balanceToIntake(m: MeasuredFractions): BalancedFractions {
  const { takenKg, meatKg, backsKg, bonesKg } = m
  if (!(takenKg > 0) || !(meatKg > 0)) {
    return { takenKg, meatKg, backsKg, bonesKg, balanced: false }
  }

  // Uzysk ponad 100% to błąd danych, nie rozbiór — bez tego ratunku karta
  // wypisałaby ujemne uboczne.
  const meatPct = meatKg < takenKg
    ? meatKg / takenKg * 100
    : REPORT_BANDS.meat.hi
  const restPct = 100 - meatPct

  const byproducts = backsKg + bonesKg
  const backsRatio = byproducts > 0 ? backsKg / byproducts : NOMINAL_BACKS_RATIO
  // Dolna granica grzbietów pilnuje też sufitu kości; gdy okno jest puste
  // (uzysk zjadł miejsce), wygrywa granica dolna — stąd Math.max na końcu.
  const backsLo = Math.max(REPORT_BANDS.backs.lo, restPct - REPORT_BANDS.bones.hi)
  const backsHi = Math.max(backsLo, Math.min(REPORT_BANDS.backs.hi, restPct - REPORT_BANDS.bones.lo))
  const backsPct = clamp(restPct * backsRatio, backsLo, backsHi)

  // Grzbiety zaokrąglone do 0,5 kg, kości jako różnica. Ćwiartka i mięso są
  // wielokrotnościami 0,5 (waga hali), więc reszta też nią jest i kości
  // wychodzą w połówkach SAME — bez drugiego zaokrąglenia, które musiałoby
  // rozjechać sumę. Zaokrąglamy grzbiety, bo to one mają pasmo (19–20%)
  // z zapasem na 0,25 kg, a nie odwrotnie.
  const outMeat  = round2(takenKg * meatPct / 100)
  const outBacks = roundHalf(takenKg * backsPct / 100)
  return {
    takenKg,
    meatKg:  outMeat,
    backsKg: outBacks,
    bonesKg: round2(takenKg - outMeat - outBacks),
    balanced: true,
  }
}
