/**
 * Prezentacja rozrachunków — czyste funkcje, zero Reacta.
 *
 * ZNAK: ujemne = klient jest nam winien. Tak jest w arkuszu biura
 * (`SALDO W € = -15649` to dług YBM GASTRO) i zmiana tej konwencji byłaby
 * źródłem cichych pomyłek — liczba wygląda sensownie w obie strony.
 */
export type StanSalda = 'dlug' | 'zero' | 'nadplata'

const SYMBOL: Record<string, string> = { PLN: 'zł', EUR: '€' }

/** Próg groszowy — zaokrąglenia nie mogą robić z zera długu ani odwrotnie. */
const GROSZ = 0.005

/**
 * `useGrouping: 'always'`, bo polskie dane CLDR NIE grupują liczb
 * czterocyfrowych: domyślnie wychodzi „-1000,00" obok „-15 649,00"
 * i kolumna kwot na wydruku dla klienta przestaje się czytać.
 *
 * Rzutowanie jest świadome: środowisko uruchomieniowe wspiera wariant
 * tekstowy (ES2023), ale typy `Intl` w tym projekcie opisują jeszcze
 * starsze API (`useGrouping: boolean`). Jedno rzutowanie w jednym miejscu
 * zamiast `any` rozsypanego po wywołaniach.
 */
const OPCJE_KWOTY = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions

export function fmtSaldo(kwota: number, waluta: string): string {
  const liczba = new Intl.NumberFormat('pl-PL', OPCJE_KWOTY).format(kwota)
    // Intl wstawia spację NIEROZDZIELAJĄCĄ (U+00A0) i wąską (U+202F).
    // Zamieniamy na zwykłą: inaczej ta sama kwota wygląda inaczej
    // w wyszukiwaniu, w kopiowaniu do Excela i w porównaniach.
    .replace(/[\u00A0\u202F]/g, ' ')
  // Nieznana waluta pokazuje swój kod zamiast znikać — lepiej „10,00 USD"
  // niż kwota bez jednostki.
  return `${liczba} ${SYMBOL[waluta] ?? waluta}`
}

export function stanSalda(saldo: number): StanSalda {
  if (saldo < -GROSZ) return 'dlug'
  if (saldo > GROSZ) return 'nadplata'
  return 'zero'
}

/**
 * Suma zaległości w złotówkach.
 *
 * NADPŁATY POMIJAMY: zaliczka jednego klienta nie zmniejsza długu innego,
 * a zsumowane razem dałyby liczbę, która niczego nie opisuje.
 *
 * Bez kursu pozycje w euro są pomijane zamiast zamieniać całą sumę w NaN —
 * kurs wpisuje biuro i zanim to zrobi, złotówkowa część ma się liczyć.
 */
export function sumaZaleglosci(
  wiersze: { saldo: number; waluta: string }[], kurs: number,
): number {
  return (wiersze ?? [])
    .filter(w => stanSalda(w.saldo) === 'dlug')
    .filter(w => w.waluta !== 'EUR' || kurs > 0)
    .reduce((s, w) => s + (w.waluta === 'EUR' ? w.saldo * kurs : w.saldo), 0)
}
