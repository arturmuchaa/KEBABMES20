/**
 * finishedGoodsSelection — zaznaczanie pozycji magazynu pod WZ.
 *
 * Magazyn wyrobu gotowego to u tego zakładu ŚWIĘTOŚĆ: obiecanie klientowi
 * towaru, który jest już czyjś, kończy się brakiem na wydaniu. Dlatego ekran
 * rozdziela stan WOLNY od zajętego pod zamówienia, a zaznaczyć da się tylko
 * to, czym naprawdę można dysponować.
 *
 * „Pod zamówienia" = sztuki ostemplowane numerem zamówienia
 * (`clientOrderNo`). Reszta jest wolna — to towar zrobiony „na magazyn".
 *
 * Czysty moduł: liczby wydania nie mogą zależeć od tego, co akurat robi
 * komponent.
 */

interface PartiaLike {
  qtyAvailable?: number | null
  clientOrderNo?: string | null
}

interface TowarLike {
  kgPerUnit?: number | null
  batches?: readonly PartiaLike[]
}

export interface PodzialStanu {
  wolne: number
  podZamowienia: number
  razem: number
}

/** Ile z tego towaru jest wolne, a ile już czyjeś. */
export function podzialStanu(towar: TowarLike): PodzialStanu {
  let wolne = 0
  let podZamowienia = 0
  for (const b of towar.batches ?? []) {
    const szt = Math.max(0, Math.floor(Number(b.qtyAvailable ?? 0)))
    if ((b.clientOrderNo || '').trim()) podZamowienia += szt
    else wolne += szt
  }
  return { wolne, podZamowienia, razem: wolne + podZamowienia }
}

/**
 * Ilość do wydania sprowadzona do sensownej wartości.
 *
 * Całe sztuki, nigdy ujemne, nigdy ponad wolny stan — pole ilości ma
 * fizycznie nie pozwolić obiecać więcej, niż leży na magazynie.
 */
export function ograniczIlosc(wpisana: number, wolne: number): number {
  const n = Number(wpisana)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n), Math.max(0, Math.floor(wolne)))
}

export interface PozycjaZaznaczona {
  towar: TowarLike
  ilosc: number
}

export interface Podsumowanie {
  pozycji: number
  sztuk: number
  kg: number
}

/** Pasek u dołu ekranu: ile pozycji, sztuk i kilogramów pójdzie na WZ.
 *  Pozycja z ilością zero się nie liczy — zaznaczona, ale pusta. */
export function podsumowanieZaznaczenia(
  wybrane: readonly PozycjaZaznaczona[],
): Podsumowanie {
  let pozycji = 0
  let sztuk = 0
  let kg = 0
  for (const w of wybrane) {
    const szt = Math.max(0, Math.floor(Number(w.ilosc ?? 0)))
    if (szt <= 0) continue
    pozycji += 1
    sztuk += szt
    kg += szt * Number(w.towar.kgPerUnit ?? 0)
  }
  return { pozycji, sztuk, kg: Math.round(kg * 1000) / 1000 }
}

export interface PrzydzialPartii {
  id: string
  qty: number
}

/**
 * Rozpisuje zaznaczoną ilość na konkretne partie — FEFO, najkrótszy termin
 * pierwszy. Okno WZ przyjmuje POZYCJE MAGAZYNOWE, nie zbiorczy towar, więc
 * ktoś musi zdecydować, z której partii schodzi wydanie. Robi to magazyn,
 * a nie człowiek w oknie WZ: inaczej biuro co wydanie wybierałoby partie
 * ręcznie i prędzej czy później wydało świeższą przed starszą.
 *
 * Partie ZAJĘTE pod zamówienia są pomijane — to nie jest towar do wzięcia
 * (chyba że wywołujący poda tryb 'wszystkie').
 * Brak terminu ważności ląduje na KOŃCU: niekompletny wiersz nie może
 * udawać najpilniejszego i wywracać całej kolejności.
 */
/** Data, po której układamy kolejność: termin ważności, a gdy go brak —
 *  data produkcji. Magazyn wyrobu gotowego niesie `producedDate`, więc bez
 *  tego zapasu WSZYSTKIE partie wpadały do worka „bez terminu" i FEFO
 *  ustawiało je w kolejności przypadkowej. */
export function dataFefo(b: { expiryDate?: string | null; producedDate?: string | null }): string {
  return (b.expiryDate || '').trim() || (b.producedDate || '').trim()
}

export function rozpiszNaPartie(
  towar: {
    batches?: readonly (PartiaLike & {
      id?: string; expiryDate?: string | null; producedDate?: string | null
    })[]
  },
  ilosc: number,
  // 'wolne' (domyślnie, jak dotąd): partie ostemplowane zamówieniem są
  // pomijane. 'wszystkie' (decyzja właściciela, 09.2026): zamówienie
  // rezerwuje towar, ale go nie blokuje — da się go sprzedać komuś innemu,
  // więc magazyn rozpisuje z całego stanu. Domyślna gałąź NIE zmienia
  // dotychczasowego zachowania ani istniejących testów.
  tryb: 'wolne' | 'wszystkie' = 'wolne',
): PrzydzialPartii[] {
  let zostalo = Math.max(0, Math.floor(Number(ilosc) || 0))
  if (!zostalo) return []

  const wolne = (towar.batches ?? [])
    .filter(b => tryb === 'wszystkie' || !(b.clientOrderNo || '').trim())
    .filter(b => Math.floor(Number(b.qtyAvailable ?? 0)) > 0)
    .slice()
    .sort((a, b) => {
      const ta = dataFefo(a)
      const tb = dataFefo(b)
      if (!ta && !tb) return 0
      if (!ta) return 1          // bez terminu — na koniec
      if (!tb) return -1
      return ta.localeCompare(tb)
    })

  const out: PrzydzialPartii[] = []
  for (const b of wolne) {
    if (zostalo <= 0) break
    const dostepne = Math.floor(Number(b.qtyAvailable ?? 0))
    const bierz = Math.min(dostepne, zostalo)
    if (bierz > 0 && b.id) {
      out.push({ id: b.id, qty: bierz })
      zostalo -= bierz
    }
  }
  return out
}

/** Przydział FEFO → mapa partia→sztuki, gotowa do ręcznej korekty.
 *  Zaznaczenie trzymamy PER PARTIA, nie per towar: automat tylko wypełnia
 *  pierwszą propozycję, a magazynier bywa mądrzejszy od FEFO (np. paleta
 *  ze świeższą partią stoi z przodu chłodni i wyjedzie bez przekładania). */
export function przydzialNaMape(przydzial: readonly PrzydzialPartii[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of przydzial) out[p.id] = p.qty
  return out
}

/** Ile sztuk łącznie schodzi z tego towaru po ewentualnych poprawkach. */
export function sumaPrzydzialu(mapa: Record<string, number>): number {
  let suma = 0
  for (const v of Object.values(mapa ?? {})) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    suma += n
  }
  return suma
}
