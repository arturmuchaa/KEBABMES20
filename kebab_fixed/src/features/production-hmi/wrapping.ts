/**
 * Foliowanie — podział kilogramów dnia między foliowczyków.
 *
 * Przy linii stoi ~10 osób układających i 2 foliowczyków. Ich pracy nie widać
 * w liczniku sztuk (foliują to, co zrobiła cała linia), więc kilogramy wpisuje
 * się wprost — najczęściej po równo, czasem ręcznie, gdy ktoś kończy wcześniej.
 *
 * Lustro `production_wrapping_service.split_evenly` na backendzie: obie strony
 * muszą dawać tę samą liczbę, bo hala widzi podział przed zapisem.
 */

export interface WrapperShare {
  workerId: string
  workerName: string
  kg: number
}

/**
 * Podział po równo. Reszta z zaokrąglenia idzie do PIERWSZEJ osoby, żeby suma
 * części zgadzała się co do kilograma z całością — inaczej 1000 kg na trzech
 * daje 999,99 i biuro szuka brakującego kilograma.
 */
export function splitEvenly(kgTotal: number, ileOsob: number): number[] {
  if (ileOsob <= 0) return []
  const total = Math.round((Number(kgTotal) || 0) * 100) / 100
  const czesc = Math.round((total / ileOsob) * 100) / 100
  const czesci = Array(ileOsob).fill(czesc)
  czesci[0] = Math.round((total - czesc * (ileOsob - 1)) * 100) / 100
  return czesci
}

/** Co jest nie tak z wpisem — pusta lista znaczy „wolno zapisać". */
export function wrappingIssues(shares: readonly WrapperShare[], kgDnia: number): string[] {
  const bledy: string[] = []
  const zKg = shares.filter(s => s.kg > 0)
  if (!zKg.length) {
    bledy.push('Wpisz kilogramy przynajmniej jednej osobie')
    return bledy
  }
  if (shares.some(s => !Number.isFinite(s.kg) || s.kg < 0)) {
    bledy.push('Kilogramy nie mogą być ujemne')
  }
  const suma = Math.round(zKg.reduce((s, w) => s + w.kg, 0) * 100) / 100
  // Ostrzeżenie, nie blokada: foliowczyk potrafi dofoliować wczorajszą resztę,
  // a dzień bywa zapisywany przed ostatnią pozycją.
  if (kgDnia > 0 && suma > kgDnia * 1.5) {
    bledy.push(`Suma ${suma} kg to znacznie więcej niż ${kgDnia} kg zrobione dziś — sprawdź wpis`)
  }
  return bledy
}

/** Suma zafoliowanych kilogramów (do kafla na pasku). */
export function wrappedTotal(shares: readonly { kg: number }[]): number {
  return Math.round(shares.reduce((s, w) => s + (Number(w.kg) || 0), 0) * 100) / 100
}
