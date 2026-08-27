/**
 * Stan pozycji zamówienia: co leży na magazynie, co pojechało do klienta,
 * ile jeszcze trzeba zrobić.
 *
 * Reguła właściciela (27.08.2026): **magazyn wyrobu gotowego to świętość**.
 * Pozycja jest pokryta tylko tym, co FIZYCZNIE leży na magazynie, plus tym,
 * co wyjechało do TEGO klienta. Towar sprzedany komuś innemu znika ze stanu
 * i na zamówieniu nie zostawia śladu — klient nadal na niego czeka.
 */
export interface PozycjaWysylki {
  qty: number
  /** Leży na magazynie i jest przypisane tej pozycji. */
  qtyStock?: number
  /** Wyjechało do tego klienta (WZ z zamówienia albo ręczny na jego nazwę). */
  qtyDelivered?: number
  /** qtyStock + qtyDelivered — postęp pozycji. */
  qtyDone?: number
}

const liczba = (v: unknown) => Math.max(0, Number(v ?? 0) || 0)

export const naMagazynie = (l: PozycjaWysylki): number => liczba(l.qtyStock)

export const wydane = (l: PozycjaWysylki): number => liczba(l.qtyDelivered)

export function pokryte(l: PozycjaWysylki): number {
  const suma = liczba(l.qtyStock) + liczba(l.qtyDelivered)
  return suma > 0 ? suma : liczba(l.qtyDone)
}

/** Ile jeszcze trzeba zrobić. */
export function zostaloDoZrobienia(l: PozycjaWysylki): number {
  return Math.max(0, liczba(l.qty) - pokryte(l))
}

/** Pozycja w całości u klienta — nie ma czego kompletować. */
export function wydaneWCalosci(l: PozycjaWysylki): boolean {
  return liczba(l.qty) > 0 && wydane(l) >= liczba(l.qty)
}
