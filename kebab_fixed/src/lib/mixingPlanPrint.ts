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
  /** Faktycznie zużyte kg. Dla pozycji GOTOWYCH kg_planned=0, a przydzielone
   * mięso zostaje tu — plan historyczny musi pokazać to, co zeszło. */
  kgActual?: number
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

/**
 * Zaokrąglenie dawki składnika na wydruku przepisu W GÓRĘ do 0,05 kg.
 * Operator odmierza na wadze z działką 0,05 — surowe proporcje (np. 1,16/100 kg
 * → na wsad 600 kg = 6,96) są nieodmierzalne, więc podnosimy do najbliższej
 * odmierzalnej wartości: 6,96 → 7,00; 2,32 → 2,35. Zawsze w górę (nigdy mniej
 * przyprawy niż wynika z receptury).
 *
 * Krok 0,05 = 1/20, więc liczymy w krokach 1/20. Epsilon 1e-9 pochłania błąd
 * zmiennoprzecinkowy, żeby wartość już leżąca na siatce (2,35 → 47 kroków) nie
 * przeskoczyła o jeden krok w górę.
 */
export function roundIngredientDose(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0
  const steps = Math.ceil(kg * 20 - 1e-9)
  return steps / 20
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
        // Przydzielone mięso = kg_planned (przed wykonaniem) + kg_actual (po
        // wykonaniu — wtedy planned=0). Suma jest stabilna: plan bieżący pokazuje
        // rezerwację, plan historyczny (gotowy) pokazuje faktyczne zużycie.
        lotKg: (lot.kgPlanned ?? 0) + (lot.kgActual ?? 0),
        materialName: lot.materialName || 'Mięso z/s',
        supplierName: lot.supplierName || '',
      })
    })
  })

  return rows
}
