/**
 * Kolejność pozycji na dokumencie WZ.
 *
 * Do 30.08.2026 pozycje szły w kolejności dokładania do koszyka, więc na
 * jednym dokumencie UDO i MIX przeplatały się, a gramatury skakały
 * (WZ/76/08/26 dla TRUVY: 50 kg, 15, 15, 15, 15, 25, 25, 22, 20, 25, 20,
 * 40, 30, 15, 25). Magazynier kompletuje towar z takiej listy dwa razy
 * dłużej, bo musi ją sobie w głowie poukładać.
 *
 * Reguła biura: **najpierw UDO, potem MIX, potem reszta**, a w obrębie
 * rodzaju gramatura **od największej**.
 */

/** Rodzaje, które mają iść pierwsze — w tej kolejności. */
export const PIERWSZENSTWO_RODZAJOW = ['UDO', 'MIX']

/** Pozycja na tyle, na ile potrzebuje jej sortowanie. */
export interface PozycjaDoSortu {
  name?: string
  kg_per_unit?: number | null
}

/**
 * Miejsce rodzaju w kolejności; rodzaj spoza listy ląduje na końcu.
 *
 * Dopasowanie po SŁOWIE, nie po fragmencie: „MIX" ma trafiać w „KEBAB MIX
 * 95/5", ale nie w przypadkową nazwę, która ma te trzy litery w środku.
 */
export function rangaRodzaju(name: string | undefined | null): number {
  const slowa = String(name ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  const i = PIERWSZENSTWO_RODZAJOW.findIndex(r => slowa.includes(r))
  return i === -1 ? PIERWSZENSTWO_RODZAJOW.length : i
}

/** Nazwa bez końcowej gramatury — po niej grupujemy w obrębie rangi. */
export function nazwaBezGramatury(name: string | undefined | null): string {
  return String(name ?? '').replace(/\s*\d+(?:[.,]\d+)?\s*kg\s*$/i, '').trim().toUpperCase()
}

/**
 * Pozycje w kolejności na dokument. Nie zmienia wejścia — dokument w bazie
 * zostaje taki, jaki był, sortujemy dopiero przy wydruku. Dzięki temu
 * poprawka działa też dla 76 dokumentów wystawionych wcześniej.
 */
export function sortujPozycjeWz<T extends PozycjaDoSortu>(lines: readonly T[]): T[] {
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ra = rangaRodzaju(a.l.name)
      const rb = rangaRodzaju(b.l.name)
      if (ra !== rb) return ra - rb

      // W obrębie tej samej rangi trzymamy rodzaje razem, alfabetycznie —
      // inaczej dwa różne MIX-y przeplatałyby się po gramaturze.
      const na = nazwaBezGramatury(a.l.name)
      const nb = nazwaBezGramatury(b.l.name)
      if (na !== nb) return na < nb ? -1 : 1

      const ka = Number(a.l.kg_per_unit ?? 0)
      const kb = Number(b.l.kg_per_unit ?? 0)
      if (ka !== kb) return kb - ka

      // Remis rozstrzyga kolejność wejściowa — sort ma być stabilny także
      // tam, gdzie silnik tego nie gwarantuje.
      return a.i - b.i
    })
    .map(x => x.l)
}
