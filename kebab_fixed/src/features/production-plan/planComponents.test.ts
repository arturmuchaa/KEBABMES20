import { describe, expect, it } from 'vitest'
import { lineComponents } from './planComponents'
import { allocatePlanMeat } from './planMeatAllocation'
import { addLineWithFefo, recalcAll, planLinesFromPlan } from './planDraftMath'
import { emptyPlanLine } from './planLineModel'
import { planShortfalls } from './planShortfalls'

const components = [
  { materialTypeId: 'thigh', name: 'Udo', pct: 95 },
  { materialTypeId: 'fillet', name: 'Filet', pct: 5 },
]
const catalog = { productTypes: [{ id: 'mix', components }], recipes: [{ id: 'r', name: 'KIRMIZI' }] }
const batches = [
  { id: 'udo', recipeId: 'r', batchNo: '711', materialTypeId: 'thigh', kgFree: 190, expiryDate: '2026-11-22' },
  { id: 'filet', recipeId: 'r', batchNo: '715', materialTypeId: 'fillet', kgFree: 10, expiryDate: '2026-11-22' },
]
const line = () => ({ ...emptyPlanLine(), recipeId: 'r', productTypeId: 'mix', qty: '10', kgPerUnit: '20',
  seasonedBatchIds: ['udo', 'filet'], seasonedBatchId: 'udo' })

describe('95/5 component allocation', () => {
  it('uses product composition ahead of recipe, with legacy recipe fallback', () => {
    expect(lineComponents(line(), { ...catalog, recipes: [{ id: 'r', components: [{ materialTypeId: 'x', pct: 100 }] }] })
      .map(c => c.pct)).toEqual([95, 5])
    expect(lineComponents({ recipeId: 'r' }, { recipes: [{ id: 'r', components }] }).map(c => c.pct)).toEqual([95, 5])
    expect(lineComponents({ recipeId: 'r' }, catalog)).toEqual([])
  })

  it('190 kg thigh + 10 kg fillet yield ten 20 kg pieces numbered 711/715', () => {
    const result = allocatePlanMeat([line()], batches, catalog)
    expect(result.lines[0]).toMatchObject({ pieces: 10, missingPieces: 0, ok: true })
    expect(result.lines[0].joined).toEqual([{ label: '711/715', pieces: 10, parts: [
      { batchId: 'udo', batchNo: '711', kg: 190 },
      { batchId: 'filet', batchNo: '715', kg: 10 },
    ] }])
    expect(result.usedByBatch).toEqual({ udo: 190, filet: 10 })
  })

  it('does not substitute excess thigh or an unselected batch for missing fillet', () => {
    const selected = { ...line(), seasonedBatchIds: ['udo'] }
    const result = allocatePlanMeat([selected], batches.map(b => ({ ...b, kgFree: 1000 })), catalog)
    expect(result.lines[0]).toMatchObject({ pieces: 0, ok: false, missingKg: 200 })
    expect(result.usedByBatch).toEqual({})
    expect(planShortfalls([selected], batches, catalog.recipes, result, false, catalog)[0]).toContain('Filet 5%')
  })

  it('wrong recipe and material cannot contribute', () => {
    const result = allocatePlanMeat([line()], batches.map(b => b.id === 'filet'
      ? { ...b, recipeId: 'other' } : b), catalog)
    expect(result.lines[0].pieces).toBe(0)
  })

  it('allocates from a single shared pool across component and ordinary lines', () => {
    const result = allocatePlanMeat([line(), { ...line(), productTypeId: '', qty: '1' }], batches, catalog)
    expect(result.lines.map(l => l.pieces)).toEqual([10, 0])
    expect(result.usedByBatch).toEqual({ udo: 190, filet: 10 })
  })

  it('does not combine sub-component remnants from different batches into a piece', () => {
    const result = allocatePlanMeat([{ ...line(), qty: '1', seasonedBatchIds: ['udo', 'udo2', 'filet'] }], [
      { ...batches[0], kgFree: 10 }, { ...batches[0], id: 'udo2', batchNo: '712', kgFree: 10 }, batches[1],
    ], catalog)
    expect(result.lines[0].pieces).toBe(0)
    expect(result.usedByBatch).toEqual({})
  })

  it('FEFO picks both components, even when fillet is smaller than one whole product', () => {
    const added = addLineWithFefo([], { ...line(), seasonedBatchIds: [], seasonedBatchId: '' }, batches, catalog)
    expect(added[0].seasonedBatchIds).toEqual(['udo', 'filet'])
    expect(recalcAll(added, batches, catalog)[0].seasonedBatchIds).toEqual(['udo', 'filet'])
    const second = addLineWithFefo(added, { ...line(), seasonedBatchIds: [], seasonedBatchId: '' }, batches, catalog)
    expect(second[1].seasonedBatchIds).toEqual([])
  })

  it('reads both components back from a saved allocation', () => {
    const [loaded] = planLinesFromPlan({ lines: [{ ...line(), batchAllocation: {
      '711/715': { pieces: 10, kg: 200, parts: {
        '711': { batch_id: 'udo', kg: 190 }, '715': { batch_id: 'filet', kg: 10 },
      } },
    } }] })
    expect(loaded.seasonedBatchIds).toEqual(['udo', 'filet'])
    expect(allocatePlanMeat([loaded], batches, catalog).lines[0].ok).toBe(true)
  })

  it('frozen lines neither consume the pool again nor block editing', () => {
    const frozen = { ...line(), qtyDone: 1 }
    const result = allocatePlanMeat([frozen, line()], batches, catalog)
    expect(result.usedByBatch).toEqual({ udo: 190, filet: 10 })
    expect(planShortfalls([frozen, line()], batches, catalog.recipes, result, true, catalog)).toEqual([])
  })

  it('uses numeric FEFO for equal expiry dates, independently of selected order', () => {
    const result = allocatePlanMeat([{ ...line(), seasonedBatchIds: ['udo', 'f100', 'f99'] }], [
      batches[0], { ...batches[1], id: 'f100', batchNo: '100' },
      { ...batches[1], id: 'f99', batchNo: '99' },
    ], catalog)
    expect(result.lines[0].joined[0].label).toBe('711/99')
  })
})
