/**
 * Podział zamówień na dwie listy: bieżące i zamknięte.
 *
 * Zrealizowane i anulowane mieszały się z tym, nad czym biuro pracuje —
 * przy kilkunastu zamówieniach w miesiącu lista przestaje być czytelna,
 * a zamknięte i tak ogląda się tylko wtedy, gdy ktoś czegoś szuka.
 */
export const STATUSY_ZAMKNIETE = ['done', 'cancelled'] as const

export interface ZeStatusem { status: string }

export const zamkniete = (o: ZeStatusem): boolean =>
  (STATUSY_ZAMKNIETE as readonly string[]).includes(o?.status ?? '')

export function podzielZamowienia<T extends ZeStatusem>(lista: T[]): {
  biezace: T[]
  zamkniete: T[]
} {
  const wszystkie = lista ?? []
  return {
    biezace: wszystkie.filter(o => !zamkniete(o)),
    zamkniete: wszystkie.filter(zamkniete),
  }
}
