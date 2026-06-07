/**
 * features/ingredients/types/index.ts
 *
 * Typy dla magazynu przypraw i dodatków oraz receptur masowania.
 *
 * Model domenowy:
 *   Ingredient        — składnik (przyprawa, dodatek funkcjonalny, woda)
 *   IngredientStock   — stan magazynowy składnika
 *   IngredientReceipt — przyjęcie do magazynu (FV/WZ)
 *   Recipe            — receptura masowania
 *   RecipeIngredient  — pozycja receptury: składnik + dawka na 100 kg mięsa
 *
 * Woda (kategoria 'water') ma isUnlimited=true — zawsze dostępna, nie rejestrujemy zakupu.
 */

// ─── KATEGORIE SKŁADNIKÓW ─────────────────────────────────────────────────────

export type IngredientCategory =
  | 'spice_mix'       // mieszanka przyprawowa (np. Van Hess, Chiken BKS)
  | 'functional'      // dodatki funkcjonalne (Transglutaminaza, fosforany)
  | 'water'           // woda — unlimited, bez zakupu
  | 'other'           // pozostałe

// ─── SKŁADNIK (DEFINICJA) ─────────────────────────────────────────────────────

export interface Ingredient {
  readonly id:           string
  readonly name:         string          // np. "Van Hess Hell", "Woda"
  readonly category:     IngredientCategory
  readonly unit:         string          // 'kg', 'l', 'szt'
  /** Woda = true → zawsze dostępna, nie odejmujemy stanu */
  readonly isUnlimited:  boolean
  readonly supplierId?:  string
  readonly supplierName?: string
  readonly active:       boolean
  readonly createdAt:    string
}

export interface CreateIngredientDto {
  name:        string
  category:    IngredientCategory
  unit:        string
  isUnlimited: boolean
  supplierId?: string
}

// ─── STAN MAGAZYNOWY ──────────────────────────────────────────────────────────

export interface IngredientStock {
  readonly ingredientId:   string
  readonly ingredientName: string
  readonly unit:           string
  readonly isUnlimited:    boolean
  readonly qtyAvailable:   number
  readonly qtyReserved:    number
  readonly lastReceiptAt?: string
}

// ─── PRZYJĘCIE DO MAGAZYNU ────────────────────────────────────────────────────

export interface IngredientReceipt {
  readonly id:           string
  readonly ingredientId: string
  readonly qty:          number
  readonly unit:         string
  readonly pricePerUnit: number
  readonly invoiceNo?:   string          // FV lub WZ
  readonly receivedDate: string
  readonly expiryDate?:  string
  readonly batchNo?:     string
  readonly supplierId?:  string
  readonly notes?:       string
  readonly createdAt:    string
}

export interface CreateIngredientReceiptDto {
  ingredientId: string
  qty:          number
  pricePerUnit: number
  invoiceNo?:   string
  receivedDate: string
  expiryDate?:  string
  batchNo?:     string
  supplierId?:  string
  notes?:       string
}

// ─── RECEPTURA MASOWANIA ──────────────────────────────────────────────────────

export interface RecipeIngredient {
  readonly id:              string
  readonly ingredientId:    string
  readonly ingredientName:  string
  readonly unit:            string
  readonly qtyPer100kg:     number        // dawka na 100 kg mięsa
  readonly isUnlimited:     boolean
}

export interface Recipe {
  readonly id:            string
  readonly name:          string          // np. "Receptura Standard Van Hess"
  readonly productTypeId?: string         // opcjonalne powiązanie z rodzajem kebabu
  readonly productTypeName?: string       // denormalizowana nazwa rodzaju (z JOINa backendu)
  readonly ingredients:   RecipeIngredient[]
  /** Łączna masa gotowego produktu na 100 kg mięsa (wyliczana) */
  readonly totalOutputPer100kg: number
  readonly shelfLifeDays: number          // dni przydatności do spożycia
  readonly notes?:        string
  readonly active:        boolean
  readonly createdAt:     string
  readonly updatedAt?:    string
}

export interface CreateRecipeDto {
  name:           string
  productTypeId?: string
  ingredients:    Omit<RecipeIngredient, 'id' | 'ingredientName' | 'unit' | 'isUnlimited'>[]
  shelfLifeDays?: number
  notes?:         string
}

export interface UpdateRecipeDto {
  name?:          string
  productTypeId?: string
  ingredients?:   Omit<RecipeIngredient, 'id' | 'ingredientName' | 'unit' | 'isUnlimited'>[]
  shelfLifeDays?: number
  notes?:         string
  active?:        boolean
}

// ─── KALKULATOR RECEPTURY ─────────────────────────────────────────────────────

export interface RecipeCalculation {
  /** Ilość mięsa (kg) — baza kalkulacji */
  meatKg: number
  /** Wymagane ilości składników */
  required: Array<{
    ingredientId:   string
    ingredientName: string
    unit:           string
    qty:            number       // qtyPer100kg * meatKg / 100
    isUnlimited:    boolean
    available:      number       // aktualny stan magazynowy (Infinity jeśli unlimited)
    sufficient:     boolean      // available >= qty
  }>
  /** Łączna masa gotowego produktu (mięso + wszystkie składniki) */
  totalOutputKg: number
  /** Czy wszystkie składniki dostępne */
  feasible:      boolean
}
