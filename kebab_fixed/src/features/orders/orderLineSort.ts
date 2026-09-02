/**
 * orderLineSort — jak czyta się zamówienie.
 *
 * Biuro (2026-09-02, zamówienie YALCIN): „edytowałem zamówienie i pomieszały
 * się receptury i wagi". Wiersze nie zmieniły treści — dokument nie miał
 * ŻADNEJ reguły kolejności. Pozycje leżały tak, jak je wpisano, a każda
 * dopisana przy edycji lądowała na samym końcu, więc pozycja pierwszej
 * receptury trafiała za wszystkie pozycje drugiej.
 *
 * Reguła (właściciel, 2026-09-02):
 *   * pozycje jednej receptury stoją RAZEM,
 *   * w grupie wagi sztuki MALEJĄCO,
 *   * grupy w kolejności PIERWSZEGO wpisania — receptura, którą operator
 *     zaczął, zostaje na górze. Dopisanie cięższej pozycji do drugiej grupy
 *     nie przerzuca całej grupy na czoło dokumentu, bo wtedy zamówienie
 *     przebudowywałoby się operatorowi pod rękami.
 *
 * Uzupełnienie (właściciel, 2026-09-02): tuleja NIESTANDARDOWA idzie po
 * standardowych. Standard to 45-65 cm — takie tuleje zakład bierze na co
 * dzień; 70 cm i wyżej (np. METAL 80CM) to zamówienie szczególne i ma stać
 * na końcu swojej receptury, nawet gdy waży najwięcej. Rozmiar decyduje
 * WYŁĄCZNIE o tym podziale: wewnątrz obu grup sortują same kilogramy.
 *
 * Czysty moduł: bez Reacta i bez fetch, żeby ta sama reguła obowiązywała
 * ekran, zapis i wydruk.
 */
import type { LineForm } from './order-form/types'

/** Zakres tulei uznawanych za standardowe (centymetry, granice włącznie). */
export const TULEJA_STD_MIN = 45
export const TULEJA_STD_MAX = 65

/** Rozmiar tulei z jej nazwy: „METAL 80CM" → 80, „Folia stretch" → null.
 *  Rozmiar mieszka w nazwie, bo kartoteka opakowań nie ma pola liczbowego. */
export function rozmiarTulei(nazwa?: string | null): number | null {
  const m = /(\d+)\s*CM/i.exec(nazwa ?? '')
  return m ? Number(m[1]) : null
}

/** Czy tuleja jest standardowa. Brak rozmiaru (folia, karton klapowy, brak
 *  tulei) traktujemy jak NIEstandard — trafia na koniec receptury, zamiast
 *  wmieszać się między zwykłe pozycje. */
export function tulejaStandardowa(nazwa?: string | null): boolean {
  const cm = rozmiarTulei(nazwa)
  return cm !== null && cm >= TULEJA_STD_MIN && cm <= TULEJA_STD_MAX
}

/** Waga sztuki jako liczba — pole jest tekstem i bywa z przecinkiem. */
function kg(l: LineForm): number {
  const v = parseFloat(String(l.kgPerUnit ?? '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

/**
 * Pozycje ułożone tak, jak zamówienie ma się czytać.
 *
 * Nie rusza tablicy wejściowej — stan Reacta ma zostać niemutowany.
 */
export function sortOrderLines<T extends LineForm>(
  lines: T[],
  /** Nazwa tulei po jej identyfikatorze. Bez niej podział na tuleje
   *  standardowe i niestandardowe się nie odbywa — sortują same kilogramy,
   *  czyli zachowanie sprzed tej reguły. */
  nazwaTulei?: (packagingId: string) => string | undefined,
): T[] {
  // Kolejność grup = kolejność, w jakiej receptury pojawiły się pierwszy raz.
  const kolejnoscGrup = new Map<string, number>()
  for (const l of lines) {
    const k = l.recipeId ?? ''
    if (!kolejnoscGrup.has(k)) kolejnoscGrup.set(k, kolejnoscGrup.size)
  }

  // `map` z indeksem, bo Array.prototype.sort jest stabilny dopiero od ES2019
  // i nie ma po co na tym polegać: przy równych wagach kolejność wpisania
  // musi zostać, inaczej dwie pozycje 25 kg zamieniałyby się miejscami przy
  // każdym otwarciu dokumentu.
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ga = kolejnoscGrup.get(a.l.recipeId ?? '') ?? 0
      const gb = kolejnoscGrup.get(b.l.recipeId ?? '') ?? 0
      if (ga !== gb) return ga - gb
      // Tuleja niestandardowa spada na koniec SWOJEJ receptury — nawet
      // gdy waży najwięcej w całym zamówieniu.
      if (nazwaTulei) {
        const sa = tulejaStandardowa(nazwaTulei(a.l.packagingId ?? ''))
        const sb = tulejaStandardowa(nazwaTulei(b.l.packagingId ?? ''))
        if (sa !== sb) return sa ? -1 : 1
      }
      const ka = kg(a.l)
      const kb = kg(b.l)
      if (ka !== kb) return kb - ka
      return a.i - b.i
    })
    .map(x => x.l)
}
