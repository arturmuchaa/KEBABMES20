import type { StockPos } from '../../data/stock'

/** Litery i cyfry, wielkimi — „GOLD-KEBAB” i „Gold Kebab” to ten sam klucz. */
const klucz = (s: string) => s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * Krótka nazwa klienta przy numerze zamówienia — pomijana, gdy numer już ją zawiera
 * („YALCIN/Z/7/10/26 YALCIN” powtarzało to samo słowo w każdym wierszu).
 */
export function klientPrzydzialu(orderNo: string, client?: string): string | undefined {
  const slowo = client?.trim().split(/\s+/)[0]
  if (!slowo) return undefined
  const prefiks = klucz(orderNo.split('/')[0] ?? '')
  const k = klucz(slowo)
  // Skrót klienta w numerze („MEGA/…” dla „MEGADONER”) liczy się od 3 znaków — samo „Z/12/…” to nie nazwa.
  if (prefiks && k && (prefiks.startsWith(k) || (prefiks.length >= 3 && k.startsWith(prefiks)))) return undefined
  return slowo
}

/** Kolumny, które w bieżącym widoku mają choć jedną wartość — puste („—” w każdym wierszu) chowamy. */
export function kolumnyZWartoscia(rows: StockPos[]): { przydatnosc: boolean; plan: boolean } {
  return { przydatnosc: rows.some(p => !!p.bestBefore), plan: rows.some(p => !!p.planNo) }
}
