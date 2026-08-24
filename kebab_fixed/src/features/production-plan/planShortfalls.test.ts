/**
 * Strażnik braków mięsa — to on nie pozwala zapisać planu bez pokrycia.
 *
 * Powód istnienia: plan zapisany z niedoborem dostaje numer PP-… i częściowo
 * rezerwuje magazyn, a hala i tak nie ma z czego produkować. Lustro
 * backendowego `_check_plan_shortfalls`, liczone PRZED wysłaniem.
 */
import { describe, it, expect } from 'vitest'
import { planShortfalls } from './planShortfalls'
import { emptyPlanLine, type PlanLine } from './planLineModel'
import { allocatePlanMeat } from './planMeatAllocation'

const linia = (over: Partial<PlanLine> = {}): PlanLine => ({ ...emptyPlanLine(), ...over })

const RECEPTURY = [
  { id: 'r1', name: 'WROCŁAW' },
  // Kebab komponentowy 70/30 — partie dobiera backend per komponent.
  { id: 'r7', name: '70/30', components: [
    { materialTypeId: 'm-udo', materialName: 'Udo', pct: 70 },
    { materialTypeId: 'm-filet', materialName: 'Filet', pct: 30 },
  ] },
]

const PARTIE = [
  { id: 'b1', recipeId: 'r1', batchNo: '495', kgFree: 300, materialTypeId: 'm-udo' },
  { id: 'b2', recipeId: 'r1', batchNo: '496', kgFree: 100, materialTypeId: 'm-filet' },
]

const braki = (lines: PlanLine[], toProduction = false) =>
  planShortfalls(lines, PARTIE as any, RECEPTURY, allocatePlanMeat(lines, PARTIE as any), toProduction)

describe('planShortfalls', () => {
  it('plan z pokryciem nie zgłasza nic', () => {
    expect(braki([linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10',
      seasonedBatchIds: ['b1'], seasonedBatchId: 'b1' })])).toEqual([])
  })

  it('z zaznaczonych partii nie wychodzi tyle sztuk — mówi ile brakuje', () => {
    const out = braki([linia({ recipeId: 'r1', qty: '50', kgPerUnit: '10',
      seasonedBatchIds: ['b1'], seasonedBatchId: 'b1' })])
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('WROCŁAW')
    expect(out[0]).toContain('20')
  })

  it('szkic bez przydzielonych partii wolno zapisać', () => {
    expect(braki([linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10' })], false)).toEqual([])
  })

  it('ale do produkcji bez partii już NIE', () => {
    const out = braki([linia({ recipeId: 'r1', qty: '10', kgPerUnit: '10' })], true)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('brak przydzielonych partii')
  })

  it('recepturę komponentową sprawdza per komponent, nie po partiach', () => {
    // 70/30 z 200 kg: udo potrzebuje 140 (jest 300 — OK), filet 60 (jest 100 — OK)
    expect(braki([linia({ recipeId: 'r7', qty: '20', kgPerUnit: '10' })])).toEqual([])
  })

  it('brak komponentu nazywa surowiec i procent', () => {
    // 70/30 z 1000 kg: filet potrzebuje 300, a jest 100.
    const out = braki([linia({ recipeId: 'r7', qty: '100', kgPerUnit: '10' })])
    expect(out.some(s => s.includes('Filet') && s.includes('30%'))).toBe(true)
  })

  it('pozycja bez receptury albo bez kilogramów nie jest oceniana', () => {
    expect(braki([linia({ recipeId: '', qty: '10', kgPerUnit: '10' }),
                  linia({ recipeId: 'r1', qty: '0', kgPerUnit: '10' })], true)).toEqual([])
  })
})
