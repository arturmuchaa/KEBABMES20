/**
 * Czysta logika protokołu weryfikacji podpisów.
 *
 * Po co osobny moduł: to jest treść dowodowa pokazywana kontroli
 * weterynaryjnej. Zdania, które z niej wynikają („podpis ważny", „podpis
 * dotyczy wcześniejszej wersji zapisu"), muszą dać się przetestować bez
 * renderowania ekranu — i nie mogą zależeć od tego, co akurat robi
 * komponent.
 */
import type { Weryfikacja, WeryfikacjaPodpis } from '@/lib/api'

export type StanPodpisu = 'wazny' | 'uniewazniony' | 'rozjechany'

/**
 * Stan pojedynczego podpisu.
 *
 * `rozjechany` to sytuacja teoretycznie niemożliwa: podpis wciąż aktywny,
 * ale odcisk treści już się nie zgadza. Gdyby kiedyś wystąpił, znaczyłby
 * awarię unieważniania — i protokół MUSI to pokazać, a nie zamilczeć.
 */
export function stanPodpisu(p: WeryfikacjaPodpis): StanPodpisu {
  if (!p.active) return 'uniewazniony'
  return p.zgodny ? 'wazny' : 'rozjechany'
}

export function opisStanu(stan: StanPodpisu): string {
  if (stan === 'wazny') return 'Ważny — dotyczy aktualnej treści zapisu'
  if (stan === 'uniewazniony')
    return 'Unieważniony — dane zmieniono po podpisaniu; podpis dotyczy wcześniejszej wersji'
  return 'Wymaga wyjaśnienia — podpis aktywny, ale odcisk treści się nie zgadza'
}

export function etykietaRoli(rola: string): string {
  if (rola === 'wykonal') return 'Wykonał (kol. l)'
  if (rola === 'sprawdzil') return 'Sprawdził (kol. m)'
  return rola
}

/** Data i godzina Z SEKUNDAMI — przy sporze liczy się minuta, nie dzień. */
export function chwila(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pl-PL')
}

/** Jednozdaniowa konkluzja protokołu — to, co kontroler przeczyta najpierw. */
export function konkluzja(v: Weryfikacja | null): string {
  if (!v) return ''
  const wazne = v.signatures.filter(p => stanPodpisu(p) === 'wazny')
  const role = new Set(wazne.map(p => p.role))
  if (role.has('wykonal') && role.has('sprawdzil'))
    return 'Dokument podpisany w obu kolumnach; podpisy zgodne z aktualną treścią zapisu.'
  if (wazne.length)
    return 'Dokument podpisany częściowo — jedna z kolumn nie ma ważnego podpisu.'
  if (v.signatures.length)
    return 'Brak ważnych podpisów — wszystkie zostały unieważnione zmianą danych po podpisaniu.'
  return 'Dokument nie został jeszcze podpisany.'
}
