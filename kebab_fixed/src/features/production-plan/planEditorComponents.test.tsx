// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const components = [
  { materialTypeId: 'thigh', name: 'Udo', pct: 95 },
  { materialTypeId: 'fillet', name: 'Filet', pct: 5 },
]
const types = [{ id: 'mix', name: 'KEBAB MIX 95/5', components }]
const recipes = [{ id: 'r', name: 'KIRMIZI', components: [] }]
let batches: any[] = []
vi.mock('@/hooks/useApi', () => ({ useApi: (fn: () => any) => ({ data: fn() }) }))
vi.mock('@/features/products/hooks', () => ({ useProductTypes: () => ({ productTypes: types }) }))
vi.mock('@/features/ingredients/hooks', () => ({ useRecipes: () => ({ recipes }) }))
vi.mock('@/lib/apiClient', () => ({
  seasonedMeatApi: { list: () => batches, all: () => ({ then: (fn: any) => fn(batches) }) },
  packagingApi: { list: () => [] }, clientsApi: { list: () => [] },
  clientOrdersApi: { list: () => [] }, productionPlansApi: { updateStatus: vi.fn() },
}))
import { PlanEditor } from './PlanEditor'

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
beforeEach(() => {
  batches = [
    { id: 'udo', recipeId: 'r', recipeName: 'KIRMIZI', materialTypeId: 'thigh', materialName: 'Udo',
      batchNo: '711', kgFree: 190, kgAvailable: 190, expiryDate: '2026-11-22' },
    { id: 'filet', recipeId: 'r', recipeName: 'KIRMIZI', materialTypeId: 'fillet', materialName: 'Filet',
      batchNo: '715', kgFree: 10, kgAvailable: 82, kgReserved: 72, expiryDate: '2026-11-22' },
  ]
})
afterEach(cleanup)
function show(initialPlan?: any) {
  const save = vi.fn(async (_lines: any[], _date: string) => 'plan')
  render(<PlanEditor initialPlan={initialPlan} onSave={save} onClose={vi.fn()} />)
  return save
}
function input(label: string, value: string) {
  const el = screen.getByLabelText(label)
  fireEvent.focus(el)
  fireEvent.change(el, { target: { value } })
  fireEvent.keyDown(el, { key: 'Enter' })
}
function add(qty = '10') {
  input('Rodzaj', '95/5'); input('Receptura', 'KIRMIZI')
  input('Sztuk', qty); input('Waga sztuki', '20')
}

it('creates 95/5 with 711/715, shows proportions and saves both selected IDs', async () => {
  const save = show()
  add()
  expect(screen.getByTestId('plan-partie').textContent).toBe('711/715')
  fireEvent.click(screen.getByTestId('plan-partie'))
  expect(screen.getByTestId('picker-components').textContent).toContain('Udo (95%): potrzeba 190 kg')
  expect(screen.getByTestId('picker-components').textContent).toContain('Filet (5%): potrzeba 10 kg')
  expect(screen.getByTestId('picker-partia-filet').textContent).toContain('10 kg')
  expect(screen.getByTestId('picker-podsumowanie').textContent).toContain('711/715: 10 szt.')
  fireEvent.click(screen.getByTestId('picker-zapisz'))
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
  await waitFor(() => expect(save).toHaveBeenCalled())
  expect(save.mock.calls[0][0][0]).toMatchObject({ productTypeId: 'mix', recipeId: 'r',
    qty: 10, kgPerUnit: 20, seasonedBatchIds: ['udo', 'filet'] })
})

it('manual deselection of fillet cannot be covered by excess thigh', () => {
  batches[0].kgFree = batches[0].kgAvailable = 1000
  const save = show()
  add()
  fireEvent.click(screen.getByTestId('plan-partie'))
  fireEvent.click(within(screen.getByTestId('picker-partia-filet')).getByRole('checkbox'))
  expect(screen.getByTestId('picker-podsumowanie').textContent).toContain('w wymaganych proporcjach')
  expect(screen.getByTestId('picker-podsumowanie').textContent).not.toContain('starczy')
  fireEvent.click(screen.getByTestId('picker-zapisz'))
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByText(/niewystarczająca ilość mięsa/i).textContent).toContain('Filet 5%')
})

it('manual 711/715 overrides older FEFO and is saved without substitution', async () => {
  batches.push({ ...batches[1], id: 'old', batchNo: '700', kgFree: 50, expiryDate: '2026-11-20' })
  const save = show()
  add()
  expect(screen.getByTestId('plan-partie').textContent).toBe('711/700')
  fireEvent.click(screen.getByTestId('plan-partie'))
  for (const id of ['old', 'filet']) fireEvent.click(within(screen.getByTestId(`picker-partia-${id}`)).getByRole('checkbox'))
  fireEvent.click(screen.getByTestId('picker-zapisz'))
  expect(screen.getByTestId('plan-partie').textContent).toBe('711/715')
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
  await waitFor(() => expect(save).toHaveBeenCalled())
  expect(new Set(save.mock.calls[0][0][0].seasonedBatchIds)).toEqual(new Set(['udo', 'filet']))
})

it('editing returns only own reservations and preserves both IDs on save', async () => {
  batches[0].kgFree = 0; batches[0].kgReserved = 190
  batches[1].kgFree = 0; batches[1].kgReserved = 82
  const save = show({ id: 'plan', planDate: '2026-11-17', lines: [{ id: 'l', qty: 10, kgPerUnit: 20,
    recipeId: 'r', productTypeId: 'mix', seasonedBatchId: 'udo', seasonedBatchNos: ['711', '715'],
    batchAllocation: { '711/715': { pieces: 10, kg: 200, parts: {
      '711': { batch_id: 'udo', kg: 190 }, '715': { batch_id: 'filet', kg: 10 },
    } } },
  }] })
  expect(screen.getByTestId('plan-partie').textContent).toBe('711/715')
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
  await waitFor(() => expect(save).toHaveBeenCalled())
  expect(save.mock.calls[0][0][0].seasonedBatchIds).toEqual(['udo', 'filet'])
})

it('picker does not offer kilograms already allocated to another line', () => {
  show()
  add('5'); add('5')
  fireEvent.click(screen.getAllByTestId('plan-partie')[1])
  expect(screen.getByTestId('picker-partia-udo').textContent).toContain('95 kg')
  expect(screen.getByTestId('picker-partia-filet').textContent).toContain('5 kg')
})

it('recalculation uses the same proportions', () => {
  show(); add()
  fireEvent.click(screen.getByRole('button', { name: /Przelicz FEFO/ }))
  expect(screen.getByTestId('plan-partie').textContent).toBe('711/715')
})

it('adding another line does not overwrite manual component selection', () => {
  batches[0].kgFree = batches[0].kgAvailable = 380
  batches.push({ ...batches[1], id: 'old', batchNo: '700', kgFree: 50, expiryDate: '2026-11-20' })
  show(); add()
  fireEvent.click(screen.getByTestId('plan-partie'))
  for (const id of ['old', 'filet']) fireEvent.click(within(screen.getByTestId(`picker-partia-${id}`)).getByRole('checkbox'))
  fireEvent.click(screen.getByTestId('picker-zapisz'))
  add()
  expect(screen.getAllByTestId('plan-partie').map(el => el.textContent)).toEqual(['711/715', '711/700'])
})
