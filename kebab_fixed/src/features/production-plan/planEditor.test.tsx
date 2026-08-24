// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'

/**
 * Terminal planu produkcji — czy kawałki naprawdę się spinają.
 *
 * Logika ma testy jednostkowe; tutaj sprawdzamy to, co czuje planista:
 * wbita pozycja od razu ma partie, druga nie podbiera mięsa pierwszej,
 * a przeliczenie od nowa nie rusza tego, co hala już produkuje.
 */
const PARTIE = [
  { id: 'b1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '495',
    productionDay: '2026-08-22', expiryDate: '2026-09-01', kgFree: 300, kgAvailable: 300 },
  { id: 'b2', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '496',
    productionDay: '2026-08-22', expiryDate: '2026-09-05', kgFree: 900, kgAvailable: 900 },
]

const { updateStatus, thenable } = vi.hoisted(() => ({
  updateStatus: vi.fn(async () => ({})),
  // `all()` jest w kodzie łańcuchowane przez .then() (edycja planu filtruje
  // partie zużyte do zera). Synchroniczny „thenable" pozwala trzymać test
  // bez asynchroniczności wymuszonej samym kształtem wywołania.
  thenable: (v: any) => ({ then: (f: (x: any) => any) => f(v) }),
}))

vi.mock('@/hooks/useApi', () => ({
  useApi: (fn: () => any) => ({ data: fn(), loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('@/lib/apiClient', () => ({
  seasonedMeatApi: { list: () => PARTIE, all: () => thenable(PARTIE) },
  packagingApi:    { list: () => [{ id: 'tul65', name: 'Tuleja 65 cm' }] },
  clientsApi:      { list: () => [{ id: 'c1', name: 'Bulli', active: true }] },
  productionPlansApi: { updateStatus },
}))
vi.mock('@/features/products/hooks', () => ({
  useProductTypes: () => ({ productTypes: [{ id: 'pt1', name: 'Kebab drobiowy' }] }),
}))
vi.mock('@/features/ingredients/hooks', () => ({
  useRecipes: () => ({ recipes: [{ id: 'r1', name: 'WROCŁAW', productTypeId: 'pt1' }] }),
}))

import { PlanEditor } from './PlanEditor'

function pokaz(over: Partial<React.ComponentProps<typeof PlanEditor>> = {}) {
  const onSave = vi.fn(async () => 'plan1')
  render(<PlanEditor onSave={over.onSave ?? onSave} onClose={over.onClose ?? vi.fn()}
    initialPlan={over.initialPlan} existingPlans={over.existingPlans ?? []}
    onOpenExisting={over.onOpenExisting} />)
  return { onSave: (over.onSave ?? onSave) as ReturnType<typeof vi.fn> }
}

const pole = (n: string) => screen.getByLabelText(n) as HTMLInputElement
function wybierz(n: string, frag: string) {
  const el = pole(n); fireEvent.focus(el)
  fireEvent.change(el, { target: { value: frag } }); fireEvent.keyDown(el, { key: 'Enter' })
}
function wpisz(n: string, v: string) {
  const el = pole(n)
  fireEvent.change(el, { target: { value: v } }); fireEvent.keyDown(el, { key: 'Enter' })
}
/** Wbij pozycję: 10 sztuk po `kg` kg receptury WROCŁAW. */
function wbij(qty: string, kg: string) {
  wybierz('Rodzaj', 'drobiowy')
  wybierz('Receptura', 'WROC')
  wpisz('Sztuk', qty)
  wpisz('Waga sztuki', kg)
}
const partieWiersza = (i: number) =>
  within(screen.getAllByTestId('plan-line')[i]).getByTestId('plan-partie').textContent

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('PlanEditor', () => {
  it('wbita pozycja od razu dostaje partie — planista nie klika po nie osobno', () => {
    pokaz()
    wbij('10', '10')
    expect(partieWiersza(0)).toBe('495')
  })

  it('druga pozycja NIE podbiera mięsa pierwszej', () => {
    pokaz()
    wbij('30', '10')   // 300 kg = cała partia 495
    wbij('30', '10')
    expect(partieWiersza(0)).toBe('495')
    expect(partieWiersza(1)).toBe('496')
  })

  it('panel partii pokazuje, która partia poszła na którą pozycję', () => {
    pokaz()
    wbij('10', '10')
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1/)).toBeTruthy()
  })

  it('panel partii schodzi z wolnymi kilogramami przy wpisywaniu', () => {
    pokaz()
    wbij('10', '10')
    expect(screen.getByTestId('partia-b1').textContent).toContain('200')
  })

  it('ostrzega, że na ten dzień jest już plan, i prowadzi do niego', () => {
    const onOpenExisting = vi.fn()
    pokaz({ existingPlans: [{ id: 'p9', planNo: 'PP/9', planDate: new Date().toISOString().slice(0, 10), status: 'draft' }], onOpenExisting })
    fireEvent.click(screen.getByRole('button', { name: /Otwórz tamten plan/ }))
    expect(onOpenExisting).toHaveBeenCalledWith('p9')
  })

  it('„Przelicz FEFO od nowa" nie rusza pozycji, którą hala już produkuje', () => {
    pokaz({ initialPlan: { planDate: '2026-08-26', lines: [
      { id: 'l1', qty: 10, kgPerUnit: 10, productTypeId: 'pt1', recipeId: 'r1',
        seasonedBatchId: 'b2', qtyDone: 4 },
    ] } })
    expect(partieWiersza(0)).toBe('496')
    fireEvent.click(screen.getByRole('button', { name: /Przelicz FEFO/ }))
    expect(partieWiersza(0)).toBe('496')
  })

  it('zapis wysyła pozycje z przydzielonymi partiami', async () => {
    const { onSave } = pokaz()
    wbij('10', '10')
    fireEvent.click(screen.getByRole('button', { name: /Zapisz szkic/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      qty: 10, kgPerUnit: 10, recipeId: 'r1', seasonedBatchIds: ['b1'],
    })
  })

  it('nie da się wysłać do produkcji planu bez pokrycia w mięsie', async () => {
    pokaz()
    wbij('200', '10')  // 2000 kg przy 1200 kg w puli
    fireEvent.click(screen.getByRole('button', { name: /Wyślij do produkcji/ }))
    expect(await screen.findByText(/niewystarczająca ilość mięsa/i)).toBeTruthy()
  })

  it('pusty plan nie da się zapisać', () => {
    pokaz()
    fireEvent.click(screen.getByRole('button', { name: /Zapisz szkic/ }))
    expect(screen.getByText(/Dodaj przynajmniej jedną pozycję/)).toBeTruthy()
  })
})
