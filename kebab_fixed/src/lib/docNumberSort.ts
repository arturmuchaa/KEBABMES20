/**
 * docNumberSort — porównanie numerów dokumentów `NN/MM/RR`.
 *
 * Biuro (2026-09-02): „dokumenty HDI mam wszystko wymieszane, najnowsze są
 * w środku". Przyczyna: lista sortowała numer jako TEKST, a numer wygląda
 * `7/09/26`. Porównanie znak po znaku stawia „9/08/26" (sierpień) NAD
 * „7/09/26" (wrzesień), bo znak „9" jest większy od „7", a „22/08/26"
 * spycha pod oba, bo „2" < „7". Numery trzeba czytać jako liczby.
 *
 * Dotyczy tak samo HDI (`7/09/26`) i WZ (`WZ/14/09/26`, `ANUL WZ/9/09/26`) —
 * ten sam kształt numeru, ta sama pułapka.
 */

/** (rok, miesiąc, numer) — nierozpoznany numer dostaje -1 i ląduje na końcu. */
export function docNumberKey(numer: string | null | undefined): [number, number, number] {
  // Bierzemy TRZY OSTATNIE grupy cyfr rozdzielone ukośnikami: prefiks
  // („WZ", „ANUL WZ") jest nieistotny i różni się między dokumentami.
  const m = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(numer ?? '').trim())
  if (!m) return [-1, -1, -1]
  return [Number(m[3]), Number(m[2]), Number(m[1])]
}

/** Komparator „najnowszy pierwszy" — gotowy do `Array.prototype.sort`. */
export function compareDocNumbers(a: string, b: string): number {
  const ka = docNumberKey(a)
  const kb = docNumberKey(b)
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return kb[i] - ka[i]
  }
  return 0
}

/** Wartość liczbowa do sortowania rosnącego w tabelach (DataTable sortuje
 *  po `sortValue`, więc numer musi dać się porównać jak liczba).
 *  Rok*10000 + miesiąc*100 + numer — dla numerów do 99 w miesiącu. */
export function docNumberSortValue(numer: string | null | undefined): number {
  const [r, m, n] = docNumberKey(numer)
  if (r < 0) return -1
  return r * 1_000_000 + m * 10_000 + n
}
