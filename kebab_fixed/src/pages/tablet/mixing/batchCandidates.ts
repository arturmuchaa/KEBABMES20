/**
 * Czysta logika doboru zastępczej partii mięsa dla masowania.
 * Źródło: meatStockApi.list() → MeatStock[] (camelCase po mapMeatStock).
 * Reguły (spec C): tylko AVAILABLE z wolnymi kg, zgodny materiał (gdy znany),
 * sort FEFO (najkrótszy termin pierwszy).
 */

export interface BatchCandidate {
  meatStockId:    string   // meat_stock.id — trafia do lotAllocations.meatLotId
  lotNo:          string
  rawBatchNo:     string
  materialTypeId: string
  materialName:   string
  kgFree:         number   // wolne kg (kgAvailable z mapMeatStock = kg_free, już netto)
  expiryDate:     string
  expiryStatus:   string   // 'OK' | 'SOON' | 'EXPIRED' | ...
}

/** Surowy element ze stanu mięsa (po mapMeatStock w api.ts). */
export interface RawMeatStock {
  id?: string
  lotNo?: string
  rawBatchNo?: string
  materialTypeId?: string
  materialName?: string
  kgAvailable?: number | string
  kgReserved?: number | string
  expiryDate?: string
  expiryStatus?: string
  status?: string
}

/**
 * Buduje listę kandydatów (FEFO) z surowego stanu mięsa.
 * @param requiredMaterialTypeId - gdy podany, zawęża do tego samego materiału.
 * @param excludeStockIds - partie do pominięcia (już użyte w innych wierszach).
 */
export function buildBatchCandidates(
  rawStock: RawMeatStock[],
  requiredMaterialTypeId?: string | null,
  excludeStockIds: string[] = [],
): BatchCandidate[] {
  const exclude = new Set(excludeStockIds)
  return (rawStock ?? [])
    .filter(m => (m.status ?? 'AVAILABLE') !== 'DEPLETED')
    .map(m => ({
      meatStockId:    String(m.id ?? ''),
      lotNo:          m.lotNo ?? '',
      rawBatchNo:     m.rawBatchNo ?? '',
      materialTypeId: m.materialTypeId ?? '',
      materialName:   m.materialName ?? '',
      kgFree:         Math.max(0, Number(m.kgAvailable ?? 0)),
      expiryDate:     m.expiryDate ?? '',
      expiryStatus:   m.expiryStatus ?? 'OK',
    }))
    .filter(c => c.meatStockId && c.kgFree > 0.01 && !exclude.has(c.meatStockId))
    .filter(c => !requiredMaterialTypeId || c.materialTypeId === requiredMaterialTypeId)
    .sort((a, b) => (a.expiryDate > b.expiryDate ? 1 : a.expiryDate < b.expiryDate ? -1 : 0))
}
