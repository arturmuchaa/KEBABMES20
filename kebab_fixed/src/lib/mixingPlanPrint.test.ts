import { describe, it, expect } from 'vitest'
import { buildLotRows, roundIngredientDose } from './mixingPlanPrint'

describe('roundIngredientDose — dawka składnika w górę do 0,05 kg', () => {
  it('przypadki z hali: 6,96 → 7,00 (wsad 600), 2,32 → 2,35 (wsad 200)', () => {
    expect(roundIngredientDose(6.96)).toBeCloseTo(7.0, 10)
    expect(roundIngredientDose(2.32)).toBeCloseTo(2.35, 10)
  })

  it('zawsze w górę, nie do najbliższego (2,31 → 2,35, nie 2,30)', () => {
    expect(roundIngredientDose(2.31)).toBeCloseTo(2.35, 10)
    expect(roundIngredientDose(2.34)).toBeCloseTo(2.35, 10)
  })

  it('wartość już na siatce 0,05 zostaje bez zmian', () => {
    expect(roundIngredientDose(2.35)).toBeCloseTo(2.35, 10)
    expect(roundIngredientDose(2.3)).toBeCloseTo(2.3, 10)
    expect(roundIngredientDose(7.0)).toBeCloseTo(7.0, 10)
  })

  it('zero / wartości niepoprawne → 0', () => {
    expect(roundIngredientDose(0)).toBe(0)
    expect(roundIngredientDose(-1)).toBe(0)
    expect(roundIngredientDose(NaN)).toBe(0)
  })
})

describe('buildLotRows — spłaszczenie planu masowania do wierszy partii', () => {
  it('pozycja z jedną partią → jeden wiersz, rowSpan=1, isFirstRow=true', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'Klasyczna', meatKg: 100, status: 'planned',
        meatLots: [{ meatLotNo: 'LOT-1', materialName: 'Udo', supplierName: 'Dostawca A', kgPlanned: 100 }] },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      isFirstRow: true, rowSpan: 1, zebra: false, lp: 1,
      lotNo: 'LOT-1', lotKg: 100, materialName: 'Udo', supplierName: 'Dostawca A',
    })
  })

  it('pozycja z trzema partiami → trzy wiersze, wspólny rowSpan=3, tylko pierwszy isFirstRow', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'Klasyczna', meatKg: 300, status: 'planned',
        meatLots: [
          { meatLotNo: 'LOT-1', kgPlanned: 100 },
          { meatLotNo: 'LOT-2', kgPlanned: 100 },
          { meatLotNo: 'LOT-3', kgPlanned: 100 },
        ] },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.isFirstRow)).toEqual([true, false, false])
    expect(rows.every(r => r.rowSpan === 3)).toBe(true)
    expect(rows.map(r => r.lotNo)).toEqual(['LOT-1', 'LOT-2', 'LOT-3'])
  })

  it('pozycja bez partii → jeden wiersz z myślnikami, lotKg=null', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'Klasyczna', meatKg: 50, status: 'planned', meatLots: [] },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lotNo: '—', lotKg: null, rowSpan: 1, isFirstRow: true })
  })

  it('zebra alternuje per pozycja, nie per wiersz partii', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'A', meatKg: 200, status: 'planned',
        meatLots: [{ meatLotNo: 'L1', kgPlanned: 100 }, { meatLotNo: 'L2', kgPlanned: 100 }] },
      { id: 'p2', recipeName: 'B', meatKg: 50, status: 'planned',
        meatLots: [{ meatLotNo: 'L3', kgPlanned: 50 }] },
      { id: 'p3', recipeName: 'C', meatKg: 50, status: 'planned',
        meatLots: [{ meatLotNo: 'L4', kgPlanned: 50 }] },
    ])
    expect(rows.filter(r => r.positionId === 'p1').every(r => r.zebra === false)).toBe(true)
    expect(rows.filter(r => r.positionId === 'p2').every(r => r.zebra === true)).toBe(true)
    expect(rows.filter(r => r.positionId === 'p3').every(r => r.zebra === false)).toBe(true)
  })

  it('lp numeruje pozycje od 1, wspólne dla wszystkich wierszy tej pozycji', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'A', meatKg: 100, status: 'planned',
        meatLots: [{ meatLotNo: 'L1', kgPlanned: 50 }, { meatLotNo: 'L2', kgPlanned: 50 }] },
      { id: 'p2', recipeName: 'B', meatKg: 50, status: 'planned',
        meatLots: [{ meatLotNo: 'L3', kgPlanned: 50 }] },
    ])
    expect(rows.filter(r => r.positionId === 'p1').every(r => r.lp === 1)).toBe(true)
    expect(rows.filter(r => r.positionId === 'p2').every(r => r.lp === 2)).toBe(true)
  })

  it('brakujące pola partii → fallback jak w dotychczasowym wydruku (lotNo „?", materialName „Mięso z/s")', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'A', meatKg: 50, status: 'planned', meatLots: [{ kgPlanned: 50 }] },
    ])
    expect(rows[0].lotNo).toBe('?')
    expect(rows[0].materialName).toBe('Mięso z/s')
    expect(rows[0].supplierName).toBe('')
  })
})
