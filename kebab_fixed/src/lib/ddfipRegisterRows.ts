/**
 * ddfipRegisterRows — dane MES → wiersze karty 1.3.1 (przyjęcie DDFiP).
 *
 * Karta 1.3.1 różni się od 1.1.1 jedną istotną rzeczą: WYPEŁNIA SIĘ CAŁA.
 * Przy mięsie kolumny oceny powstają przy aucie (temperatura z sondy, ocena
 * wizualna komory) i MES nie ma ich skąd wziąć, więc zostają puste do
 * wpisania długopisem. Przy artykułach pomocniczych nie ma żadnego pomiaru —
 * wszystkie oceny wpisuje biuro w formularzu przyjęcia, więc wydruk jest
 * kompletny i służy do podpięcia do księgi, a nie do wypełniania.
 *
 * Kolumny a-k wg nagłówka karty:
 *   a numer · b dostawca · c asortyment · d data · e faktura/atest
 *   f ocena wizualna · g zgodność + termin · h uwagi · i ocena dostawy
 *   j wykonał · k sprawdził
 *
 * Zero importów z React/UI — moduł ma się dać przetestować w vitest.
 */
import type { IngredientReception } from '@/lib/api'
import { plDate, shortSupplier } from '@/lib/receptionRegisterRows'

/** „bz" w bazie, „b/z" na papierze — tak zapisuje to instrukcja 1.3. */
function ocena(value: string): string {
  return value === 'N' ? 'N' : 'b/z'
}

export function ddfipRows(docs: IngredientReception[], cols: number): string[][] {
  return [...docs]
    .sort((a, b) =>
      a.receivedDate.localeCompare(b.receivedDate) ||
      a.receptionNo.localeCompare(b.receptionNo, 'pl', { numeric: true }))
    .map(d => {
      const row = [
        d.receptionNo,
        shortSupplier(d.supplierName),
        d.assortment,
        plDate(d.receivedDate),
        d.documentNo,
        ocena(d.visualCheck),
        ocena(d.complianceCheck),
        d.notes,
        d.decision === 'N' ? 'N' : 'K',
        d.doneBy,
        d.checkedBy,
      ]
      return [...row, ...Array(Math.max(0, cols - row.length)).fill('')]
    })
}
