/**
 * Lista tulei do wyboru z hali.
 *
 * Metalowe potrafią skończyć się w połowie dnia i pozycja jedzie dalej na
 * kartonowych. Operator musi móc to przestawić sam — inaczej robi sztuki
 * „na papierze" z tulei, której na magazynie nie ma, i stan rozjeżdża się
 * do końca miesiąca.
 *
 * Pozycji ze stanem 0 NIE ukrywamy: brak tulei to informacja, nie powód, żeby
 * kartoteka zniknęła operatorowi z oczu (tak samo obecna tuleja pozycji —
 * zawsze zostaje na liście, żeby było widać, z czego się schodzi).
 */
export interface PackagingItem {
  id: string
  name: string
  type?: string
  kgAvailable?: number
}

export interface PackagingOption {
  id: string
  name: string
  /** Ile sztuk tulei stoi na magazynie. */
  available: number
  /** Czy starczy na to, co zostało do zrobienia na pozycji. */
  enough: boolean
  /** Tuleja, która stoi na pozycji teraz. */
  current: boolean
}

const liczba = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function packagingOptions(
  lista: PackagingItem[] | null | undefined,
  currentId: string,
  needed: number,
): PackagingOption[] {
  const potrzeba = liczba(needed)
  return (Array.isArray(lista) ? lista : [])
    .filter(p => p && String(p.type || '').toLowerCase() === 'tuleja')
    .map(p => {
      const available = liczba(p.kgAvailable)
      return {
        id: String(p.id || ''),
        name: String(p.name || ''),
        available,
        enough: available >= potrzeba,
        current: String(p.id || '') === currentId,
      }
    })
    .sort((a, b) => {
      // Ze stanem przed pustymi: operator sięga po to, co realnie ma.
      const pusta = Number(a.available === 0) - Number(b.available === 0)
      return pusta !== 0 ? pusta : a.name.localeCompare(b.name, 'pl')
    })
}
