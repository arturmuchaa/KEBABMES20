/**
 * Folia stretch — rozliczenie zużycia dnia do kosztów produkcji.
 *
 * Zużycie liczymy jako POBRANE − ZWRÓCONE, nie z pamięci operatora. Rano
 * schodzi z magazynu np. 40 rolek, w ciągu dnia dochodzi 20, a przy zamykaniu
 * operator oddaje to, czego nie zużył. Zwrot jest ruchem magazynowym w drugą
 * stronę, więc stan folii zgadza się bez ręcznej inwentaryzacji, a koszt dnia
 * opiera się na liczbie, którą ktoś fizycznie policzył na koniec zmiany.
 */

export interface FilmMove {
  at: string
  qty: number
  kind: 'pobranie' | 'zwrot'
}

export interface FilmSummary {
  pobrane: number
  zwrocone: number
  zuzyte: number
}

export function filmSummary(moves: readonly FilmMove[]): FilmSummary {
  let pobrane = 0, zwrocone = 0
  for (const m of moves ?? []) {
    const q = Number(m?.qty ?? 0)
    if (!Number.isFinite(q) || q <= 0) continue
    if (m?.kind === 'pobranie') pobrane += q
    else if (m?.kind === 'zwrot') zwrocone += q
  }
  return { pobrane, zwrocone, zuzyte: Math.max(0, pobrane - zwrocone) }
}

/**
 * Co jest nie tak ze zwrotem — pusta lista znaczy „wolno zapisać".
 * Zwrot większy niż pobranie oznaczałby, że na magazyn wraca folia, której
 * stamtąd nie wzięto: stan urósłby z powietrza, a koszt dnia zszedł poniżej zera.
 */
export function returnIssues(pobrane: number, zwrot: number): string[] {
  const bledy: string[] = []
  if (!Number.isFinite(zwrot)) { bledy.push('Podaj liczbę rolek'); return bledy }
  if (zwrot < 0) bledy.push('Zwrot nie może być ujemny')
  if (!Number.isInteger(zwrot)) bledy.push('Rolki liczymy w całych sztukach')
  if (zwrot > pobrane) bledy.push(`Nie można zwrócić ${zwrot} rolek — pobrano ${pobrane}`)
  return bledy
}
