/**
 * Masowanie w edytorze zamówienia — czysta logika paska „ile mięsa wymieszać”.
 *
 * Liczby daje serwer (`POST /client-orders/preview-requirements`, ten sam podgląd
 * co panel „Szacunek surowca” w starym MES): mięso = masa wyrobu / (1 + dodatki
 * na 100 kg), podział wg składu (70/30), ćwiartka przez wydajność rozbioru.
 * Tu tylko grupowanie po recepturze i zaokrąglenie — jak `mixingByRecipe`:
 * w górę PO zsumowaniu pozycji receptury.
 */
import type { MaterialRequirements } from '@/lib/api'
import type { LineForm } from '@/features/orders/order-form/types'
import { num } from '@/features/orders/order-entry/model'
import { pierwszyBrak } from './model'

export interface PozycjaPodgladu { qty: number; kgPerUnit: number; recipeId: string; productTypeId: string }

/** Do podglądu idą tylko pozycje kompletne — niedokończona nie zmienia liczb w trakcie pisania. */
export const doPodgladu = (lines: LineForm[]): PozycjaPodgladu[] =>
  lines.filter(l => pierwszyBrak(l) === null)
    .map(l => ({ qty: num(l.qty), kgPerUnit: num(l.kgPerUnit), recipeId: l.recipeId, productTypeId: l.productTypeId }))

export interface RecepturaMasowania {
  recipeId: string
  nazwa: string
  wyrobKg: number
  miesoDokladne: number
  /** Zaokrąglone w górę po zsumowaniu pozycji receptury. */
  miesoKg: number
  /** Mięso = cała masa wyrobu: receptura bez dodatków w składzie — prawie na pewno brak składu. */
  bezSkladu: boolean
}

/** `items` muszą być tymi samymi pozycjami (w tej samej kolejności), które poszły do podglądu. */
export function masowaniePoRecepturach(items: PozycjaPodgladu[], wynik: MaterialRequirements, nazwa: (recipeId: string) => string): RecepturaMasowania[] {
  const per = new Map<string, { wyrob: number; mieso: number }>()
  items.forEach((it, i) => {
    const x = per.get(it.recipeId) ?? { wyrob: 0, mieso: 0 }
    x.wyrob += it.qty * it.kgPerUnit
    x.mieso += wynik.lines.filter(r => r.lineIndex === i).reduce((a, r) => a + r.kgMeat, 0)
    per.set(it.recipeId, x)
  })
  return [...per].map(([recipeId, x]) => ({
    recipeId, nazwa: nazwa(recipeId), wyrobKg: x.wyrob, miesoDokladne: x.mieso,
    miesoKg: Math.ceil(Math.round(x.mieso * 1000) / 1000),
    bezSkladu: x.wyrob > 0 && x.mieso >= x.wyrob - 0.001,
  })).sort((a, b) => b.miesoKg - a.miesoKg || a.nazwa.localeCompare(b.nazwa, 'pl'))
}
