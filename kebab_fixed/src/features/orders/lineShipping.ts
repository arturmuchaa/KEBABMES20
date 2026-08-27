/**
 * Stan pozycji zamówienia: co jeszcze trzeba zrobić, co leży na magazynie,
 * a co już wyjechało na WZ.
 *
 * „Zrobione" i „wysłane" to dwie różne rzeczy. Dopóki były jednym, pozycja
 * w całości wydana wyglądała tak samo jak gotowa do wydania i magazynier
 * szukał w chłodni towaru, który wyjechał poprzedniego dnia.
 */
export type StanPozycji = 'wyslane' | 'gotowe' | 'czesciowo' | 'brak'

export interface PozycjaWysylki {
  qty: number
  qtyDone?: number
  qtyShipped?: number
}

const liczba = (v: unknown) => Math.max(0, Number(v ?? 0) || 0)

export function stanPozycji(l: PozycjaWysylki): StanPozycji {
  const qty = liczba(l.qty)
  const zrobione = liczba(l.qtyDone)
  const wyslane = Math.min(zrobione, liczba(l.qtyShipped))
  if (qty > 0 && wyslane >= qty) return 'wyslane'
  if (qty > 0 && zrobione >= qty) return 'gotowe'
  if (zrobione > 0 || wyslane > 0) return 'czesciowo'
  return 'brak'
}

/** Ile sztuk LEŻY u nas — tyle magazynier ma do wzięcia z chłodni. */
export function naMagazynie(l: PozycjaWysylki): number {
  return Math.max(0, liczba(l.qtyDone) - liczba(l.qtyShipped))
}

/** Ile jeszcze trzeba zrobić. Wysłane liczy się jako zrobione — nie robimy tego drugi raz. */
export function zostaloDoZrobienia(l: PozycjaWysylki): number {
  return Math.max(0, liczba(l.qty) - liczba(l.qtyDone))
}

/** Czy pozycja schodzi z listy kompletowania (wszystko już u klienta). */
export function domkniete(l: PozycjaWysylki): boolean {
  return stanPozycji(l) === 'wyslane'
}
