/**
 * wzRezerwacje — ostrzeżenie przed wydaniem cudzego, zarezerwowanego towaru.
 *
 * Backend robi to od sierpnia po cichu: `zdejmij_stempel_obcej_sprzedazy`
 * zdejmuje przypisanie do zamówienia, gdy wyrób jedzie do INNEGO nabywcy niż
 * właściciel zamówienia (incydent TRUVA 26.08.2026 — 30 szt. pojechało do
 * obcej firmy i weszłoby jej na HDI). Sprzedaż jest dozwolona, ale biuro
 * dowiadywało się o skutkach dopiero wtedy, gdy zamówienie nagle pokazało
 * brak.
 *
 * Ten moduł liczy, o czym trzeba zapytać PRZED wystawieniem: ile sztuk i pod
 * jakie zamówienia. Świadomie NIE ostrzegamy przy wydaniu właścicielowi
 * zamówienia — to zwykła realizacja, a pytanie przy każdej wysyłce uczy
 * klikać „tak" bez czytania.
 */

interface PozycjaWz {
  stockType?: string
  qtyStr?: string
  clientOrderNo?: string | null
  clientName?: string | null
}

export interface Rezerwacja {
  orderNo: string
  qty: number
  clientName: string
}

const rowne = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Zarezerwowane pozycje, które w tym dokumencie jadą do kogoś innego.
 *
 * `nabywca` to nazwa wybranego odbiorcy WZ. Bez niej nie ma z czym porównać,
 * więc nie ostrzegamy — dokument bez odbiorcy i tak się nie zapisze.
 */
export function rezerwacjeObcegoKlienta(
  pozycje: readonly PozycjaWz[],
  nabywca: string,
): Rezerwacja[] {
  if (!(nabywca || '').trim()) return []

  const wg = new Map<string, Rezerwacja>()
  for (const p of pozycje) {
    if ((p.stockType || '') !== 'fg') continue
    const nrZamowienia = (p.clientOrderNo || '').trim()
    if (!nrZamowienia) continue
    const wlasciciel = (p.clientName || '').trim()
    // Wydanie właścicielowi zamówienia to realizacja, nie odebranie towaru.
    if (wlasciciel && rowne(wlasciciel, nabywca)) continue
    const szt = Math.max(0, Math.floor(Number(p.qtyStr ?? 0) || 0))
    if (szt <= 0) continue
    const juz = wg.get(nrZamowienia)
    if (juz) juz.qty += szt
    else wg.set(nrZamowienia, { orderNo: nrZamowienia, qty: szt, clientName: wlasciciel })
  }
  return [...wg.values()].sort((a, b) => b.qty - a.qty)
}
