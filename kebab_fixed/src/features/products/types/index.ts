/**
 * features/products/types/index.ts
 *
 * Typy domenowe modułu rodzajów produktów (kebabów) i receptur.
 *
 * Model domenowy:
 *   ProductType — definicja rodzaju kebabu (np. "Kebab MIX 70/30")
 *   ProductMeatComponent — składowa mięsna (% udział surowca z magazynu)
 *   Recipe — receptura: lista składników (przyprawy, woda, mięso) z dawkowaniem
 *   RecipeIngredient — pozycja receptury: składnik + ilość na 100 kg mięsa
 *
 * Źródła surowca mięsnego:
 *   - 'meat_stock'  → mięso z/s z rozbioru (lot z MeatStock)
 *   - 'purchase'    → surowiec z zakupu (FV/WZ) — filet, indyk, etc.
 *
 * Woda jest zawsze dostępna (status: unlimited) — nie wymaga zakupu.
 */

// ─── SKŁADNIK MIĘSNY PRODUKTU ─────────────────────────────────────────────────

export type MeatSourceType = 'meat_stock' | 'purchase'

export interface ProductMeatComponent {
  readonly id:           string
  readonly name:         string          // np. "Mięso z/s", "Filet z kurczaka", "Indyk"
  /** Powiązanie z katalogiem rodzajów surowca (raw_material_types). Kanoniczny
   *  klucz dopasowania partii przyprawionego na produkcji (np. mat-filet-kurczak). */
  readonly materialTypeId?: string
  readonly sourceType:   MeatSourceType
  readonly pct:          number          // 0–100, suma składników = 100
  /** Dla sourceType='meat_stock': powiązanie z lotem mięsa (opcjonalne) */
  readonly meatLotId?:   string
  /** Dla sourceType='purchase': powiązanie z FV/WZ */
  readonly invoiceId?:   string
}

// ─── RODZAJ PRODUKTU (definicja kebabu) ──────────────────────────────────────

export interface ProductType {
  readonly id:          string
  readonly name:        string          // np. "Kebab MIX 70/30"
  readonly description?: string
  readonly components:  ProductMeatComponent[]
  readonly active:      boolean
  readonly createdAt:   string
  readonly updatedAt?:  string
}

export interface CreateProductTypeDto {
  name:         string
  description?: string
  components:   Omit<ProductMeatComponent, 'id'>[]
}

export interface UpdateProductTypeDto {
  name?:        string
  description?: string
  components?:  Omit<ProductMeatComponent, 'id'>[]
  active?:      boolean
}

// Walidacja — suma % musi wynosić dokładnie 100
export interface ComponentValidation {
  ok:      boolean
  sumPct:  number
  message?: string
}

export function validateComponents(components: Omit<ProductMeatComponent, 'id'>[]): ComponentValidation {
  if (components.length === 0) return { ok: false, sumPct: 0, message: 'Dodaj co najmniej jeden składnik' }
  const sumPct = components.reduce((s, c) => s + c.pct, 0)
  const rounded = Math.round(sumPct * 100) / 100
  if (rounded !== 100) {
    return { ok: false, sumPct: rounded, message: `Suma udziałów to ${rounded}% — musi wynosić dokładnie 100%` }
  }
  if (components.some(c => c.pct <= 0)) return { ok: false, sumPct: rounded, message: 'Każdy składnik musi mieć udział > 0%' }
  if (components.some(c => !c.materialTypeId)) return { ok: false, sumPct: rounded, message: 'Każdy składnik musi mieć wybrany rodzaj surowca' }
  return { ok: true, sumPct: rounded }
}
