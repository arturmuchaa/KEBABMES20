/**
 * Wspólne typy i helpery dla edytora pozycji zamówienia.
 * Używane przez OrderForm (ClientOrdersPage) i 3 warianty wprowadzania pozycji.
 */
import type { Dispatch, SetStateAction } from 'react'

export interface LineForm {
  qty: string
  kgPerUnit: string
  productTypeId: string
  recipeId: string
  packagingId: string
  notes: string
}

export const emptyLine = (): LineForm => ({
  qty: '', kgPerUnit: '', productTypeId: '', recipeId: '', packagingId: '', notes: '',
})

export interface ProductTypeLite { id: string; name: string }
export interface RecipeLite { id: string; name: string; productTypeId?: string; productTypeName?: string }
export interface PackagingLite { id: string; name: string; kgAvailable?: number; unit?: string }

export interface LinesEditorProps {
  lines: LineForm[]
  setLine: (i: number, k: keyof LineForm, v: string) => void
  setLines: Dispatch<SetStateAction<LineForm[]>>
  addLine: () => void
  removeLine: (i: number) => void
  productTypes: ProductTypeLite[]
  recipes: RecipeLite[]
  packaging: PackagingLite[]
}

/** kg pozycji = ilość × kg/szt. */
export const lineKg = (l: LineForm): number =>
  (parseFloat(l.qty) || 0) * (parseFloat(l.kgPerUnit) || 0)

/** Receptury pasujące do wybranego rodzaju produktu (lub wszystkie, gdy brak wyboru). */
export const filterRecipesFor = (recipes: RecipeLite[], line: LineForm): RecipeLite[] =>
  recipes.filter(r => !line.productTypeId || !r.productTypeId || r.productTypeId === line.productTypeId)

/** Czy pozycja jest kompletna (gotowa do zapisu). */
export const isLineComplete = (l: LineForm): boolean =>
  !!l.productTypeId && !!l.recipeId && (parseFloat(l.qty) > 0) && (parseFloat(l.kgPerUnit) > 0)
