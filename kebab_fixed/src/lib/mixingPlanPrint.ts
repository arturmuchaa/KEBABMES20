/**
 * mixingPlanPrint.ts — czyste przekształcenie planu masowania (pozycje + partie mięsa)
 * do listy wierszy tabeli "Kolejka masowania" na wydruku dla operatora
 * (src/pages/office/MixingPlanPrintPage.tsx). Wydzielone, żeby dało się to
 * testować bez renderowania React.
 */

export interface MeatLotInput {
  meatLotNo?: string
  materialName?: string
  supplierName?: string
  kgPlanned?: number
}

export interface PlanPositionInput {
  id: string
  recipeName?: string
  meatKg?: number
  status?: string
  meatLots?: MeatLotInput[]
}

export interface LotRow {
  positionId: string
  rowKey: string
  isFirstRow: boolean
  rowSpan: number
  zebra: boolean
  lp: number
  recipeName: string
  meatKg: number
  status: string
  lotNo: string
  lotKg: number | null
  materialName: string
  supplierName: string
}

export function buildLotRows(plan: PlanPositionInput[]): LotRow[] {
  const rows: LotRow[] = []

  plan.forEach((position, positionIndex) => {
    const lots = position.meatLots ?? []
    const rowSpan = lots.length > 0 ? lots.length : 1
    const zebra = positionIndex % 2 === 1
    const lp = positionIndex + 1
    const recipeName = position.recipeName || '—'
    const meatKg = position.meatKg || 0
    const status = position.status || ''

    if (lots.length === 0) {
      rows.push({
        positionId: position.id, rowKey: `${position.id}-0`,
        isFirstRow: true, rowSpan, zebra, lp, recipeName, meatKg, status,
        lotNo: '—', lotKg: null, materialName: '', supplierName: '',
      })
      return
    }

    lots.forEach((lot, lotIndex) => {
      rows.push({
        positionId: position.id, rowKey: `${position.id}-${lotIndex}`,
        isFirstRow: lotIndex === 0, rowSpan, zebra, lp, recipeName, meatKg, status,
        lotNo: lot.meatLotNo || '?',
        lotKg: lot.kgPlanned ?? 0,
        materialName: lot.materialName || 'Mięso z/s',
        supplierName: lot.supplierName || '',
      })
    })
  })

  return rows
}
