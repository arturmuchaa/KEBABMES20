/**
 * finishedGoodsSearch — wyszukiwanie na magazynie wyrobu gotowego.
 *
 * Biuro (2026-09-02): „wyszukiwarka działa fatalnie, nie pokazuje po nazwie,
 * po skróconej, po kg, po recepturze ani rodzaju". Trzy przyczyny, wszystkie
 * naprawione tutaj:
 *
 *  1. Filtr robił `includes` na CAŁEJ frazie naraz. „kirmizi 30" nie trafiało
 *     w nic, bo żadne pojedyncze pole nie zawiera obu słów. Teraz zapytanie
 *     dzieli się na słowa: KAŻDE musi trafić w JAKIEKOLWIEK pole. Wpisywanie
 *     kolejnych słów zawęża wynik, zamiast go zerować.
 *  2. Ekran pokazuje SKRÓCONĄ nazwę klienta, a filtr szukał w pełnej z KRS —
 *     wpisywałeś to, co widzisz, i nie było trafienia. Szukamy w obu.
 *  3. Kilogramy porównywane tekstem: „2,5" nie trafiało w 2.5, a „3"
 *     znajdowało towar 30 kg. Gramatura dopasowuje się LICZBOWO i dokładnie.
 *
 * Czysty moduł — bez Reacta, żeby dało się to przetestować i żeby ta sama
 * reguła obsłużyła kiedyś inne ekrany magazynowe.
 */

interface PartiaLike {
  batchNo?: string | null
  clientOrderNo?: string | null
}

interface TowarLike {
  productTypeName?: string | null
  recipeName?: string | null
  packagingName?: string | null
  clientName?: string | null
  kgPerUnit?: number | null
  batches?: readonly PartiaLike[]
}

/** Małe litery, bez polskich znaków, przecinek dziesiętny jak kropka.
 *  „ŚCINKI Łóź" → „scinki loz"; „2,5" → „2.5". */
export function normalizuj(v: string | number | null | undefined): string {
  return String(v ?? '')
    .replace(',', '.')
    .normalize('NFD')
    // Znaki diakrytyczne (U+0300–U+036F) po rozłożeniu NFD.
    .replace(/[̀-ͯ]/g, '')
    // „ł" i „Ł" NIE rozkładają się w NFD — trzeba je podmienić osobno.
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .toLowerCase()
    .trim()
}

/** Zapytanie → słowa. Puste zapytanie nie daje tokenów (przepuszcza wszystko). */
export function tokeny(zapytanie: string): string[] {
  return normalizuj(zapytanie).split(/\s+/).filter(Boolean)
}

/** Czy token trafia w gramaturę. Liczbowo i DOKŁADNIE — „3" nie może
 *  znaleźć towaru 30 kg, bo wtedy filtr niczego nie zawęża. */
function trafiaGramature(token: string, kgPerUnit: number | null | undefined): boolean {
  const kg = Number(kgPerUnit ?? 0)
  if (!kg) return false
  const liczba = parseFloat(token.replace(/kg$/, ''))
  return Number.isFinite(liczba) && Math.abs(liczba - kg) < 0.0005
}

/**
 * Czy wiersz magazynu pasuje do zapytania.
 *
 * `skrotKlienta` mapuje pełną nazwę odbiorcy na tę pokazywaną na ekranie —
 * bez niej nie da się znaleźć towaru, wpisując to, co się widzi.
 */
export function dopasujTowar(
  towar: TowarLike,
  zapytanie: string,
  skrotKlienta?: (pelna: string) => string,
): boolean {
  const slowa = tokeny(zapytanie)
  if (!slowa.length) return true

  const pelnaNazwa = towar.clientName || ''
  const pola: string[] = [
    normalizuj(towar.productTypeName),
    normalizuj(towar.recipeName),
    normalizuj(towar.packagingName),
    normalizuj(pelnaNazwa),
    normalizuj(skrotKlienta ? skrotKlienta(pelnaNazwa) : ''),
    ...(towar.batches ?? []).flatMap(b => [
      normalizuj(b.batchNo), normalizuj(b.clientOrderNo),
    ]),
  ].filter(Boolean)

  return slowa.every(t =>
    trafiaGramature(t, towar.kgPerUnit) || pola.some(p => p.includes(t)))
}
