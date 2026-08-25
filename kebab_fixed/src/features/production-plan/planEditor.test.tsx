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

/** Jedno potwierdzone zamówienie: 20 szt po 35 kg, z czego 8 jeszcze zostało. */
const ZAMOWIENIA = [{
  id: 'z1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli', status: 'confirmed',
  lines: [{ id: 'zl1', qty: 20, kgPerUnit: 35, productTypeId: 'pt1', recipeId: 'r1' }],
}]

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
  clientOrdersApi: {
    list: () => ZAMOWIENIA,
    productionProgress: async (_id: string) => ({ lines: [{ lineId: 'zl1', qtyRemaining: 8 }] }),
  },
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

/**
 * Dwa wejścia planu: z ręki (wyżej) i z zamówień. Plan powstaje po połowie,
 * więc oba muszą być wygodne — ale panel zamówień otwiera się NA ŻĄDANIE,
 * bo w większość dni nie ma czego wciągać.
 */
describe('PlanEditor — wciąganie z zamówień', () => {
  const otworzPanel = async () => {
    pokaz()
    fireEvent.click(screen.getByTestId('otworz-zamowienia'))
    return screen.findByTestId('panel-zamowien')
  }

  /** Nic nie jest zaznaczone z góry (25.08.2026) — wciągnięcie pięćdziesięciu
   *  pozycji przez przypadek to plan do ręcznego rozbierania. */
  const wybierzPierwsza = async () => {
    const poz = await screen.findByTestId('pozycja-zl1')
    fireEvent.click(poz)
    return poz
  }

  it('pokazuje RESZTĘ do wyprodukowania, nie ilość z zamówienia', async () => {
    await otworzPanel()
    await waitFor(() =>
      expect(screen.getByTestId('pozycja-zl1').textContent).toContain('8×35'))
  })

  it('wciągnięta pozycja ląduje w planie z partiami od FEFO', async () => {
    await otworzPanel()
    await wybierzPierwsza()
    fireEvent.click(screen.getByTestId('importuj'))
    await waitFor(() => expect(screen.getAllByTestId('plan-line')).toHaveLength(1))
    expect(partieWiersza(0)).toBe('495')
  })

  it('zapis niesie powiązanie z pozycją zamówienia', async () => {
    const { onSave } = pokaz()
    fireEvent.click(screen.getByTestId('otworz-zamowienia'))
    await wybierzPierwsza()
    fireEvent.click(screen.getByTestId('importuj'))
    await waitFor(() => screen.getAllByTestId('plan-line'))
    fireEvent.click(screen.getByRole('button', { name: /Zapisz szkic/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      qty: 8, clientOrderId: 'z1', clientOrderLineId: 'zl1', clientName: 'Bulli',
    })
  })
})

describe('PlanEditor — poprawianie pozycji', () => {
  const wbijIWejdzWEdycje = async () => {
    pokaz()
    wbij('10', '10')
    fireEvent.click(screen.getAllByTitle(/Popraw pozycję/)[0])
    await screen.findByTestId('porzuc-poprawke')
  }

  it('pasek wsadu pokazuje pozycję Z LICZBAMI, nie samą tożsamość', async () => {
    await wbijIWejdzWEdycje()
    expect(pole('Sztuk').value).toBe('10')
    expect(pole('Waga sztuki').value).toBe('10')
  })

  it('poprawka PODMIENIA pozycję, nie dopisuje nowej', async () => {
    await wbijIWejdzWEdycje()
    fireEvent.change(pole('Sztuk'), { target: { value: '25' } })
    fireEvent.keyDown(pole('Sztuk'), { key: 'Enter' })
    fireEvent.keyDown(pole('Waga sztuki'), { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByTestId('plan-line')).toHaveLength(1))
    expect(within(screen.getAllByTestId('plan-line')[0]).getByTestId('plan-ilosc').textContent).toBe('25×10')
  })

  it('„porzuć poprawkę" zostawia pozycję nietkniętą', async () => {
    await wbijIWejdzWEdycje()
    fireEvent.change(pole('Sztuk'), { target: { value: '99' } })
    fireEvent.click(screen.getByTestId('porzuc-poprawke'))
    await waitFor(() => expect(screen.queryByTestId('porzuc-poprawke')).toBeNull())
    expect(within(screen.getAllByTestId('plan-line')[0]).getByTestId('plan-ilosc').textContent).toBe('10×10')
  })
})

/**
 * Ręczny wybór partii — druga połowa zasady, której brakowało w pierwszym
 * wydaniu terminala: FEFO proponowało, ale nie było czym zdecydować inaczej.
 */
describe('PlanEditor — ręczny wybór partii', () => {
  const otworzPicker = async () => {
    pokaz()
    wbij('10', '10')
    fireEvent.click(screen.getByTestId('plan-partie'))
    return screen.findByTestId('picker-zapisz')
  }

  it('kolumna „Partie" otwiera wybór', async () => {
    await otworzPicker()
    expect(screen.getByTestId('picker-partia-b1')).toBeTruthy()
    expect(screen.getByTestId('picker-partia-b2')).toBeTruthy()
  })

  it('picker pokazuje SUROWE wolne kg partii, nie resztkę po alokacji', async () => {
    await otworzPicker()
    // b1 ma 300 kg wolnego; FEFO zjadło z niej 100 na tę pozycję.
    expect(screen.getByTestId('picker-partia-b1').textContent).toContain('300')
  })

  it('mówi wprost, czy zaznaczone partie pokryją pozycję', async () => {
    await otworzPicker()
    expect(screen.getByTestId('picker-podsumowanie').textContent).toContain('starczy')
  })

  it('ręczny wybór nadpisuje propozycję FEFO', async () => {
    await otworzPicker()
    fireEvent.click(within(screen.getByTestId('picker-partia-b1')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByTestId('picker-partia-b2')).getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('picker-zapisz'))
    await waitFor(() => expect(partieWiersza(0)).toBe('496'))
  })

  it('„Zostaw FEFO" oddaje pozycję automatowi, nie zostawia jej bez mięsa', async () => {
    await otworzPicker()
    fireEvent.click(within(screen.getByTestId('picker-partia-b1')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByTestId('picker-partia-b2')).getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('picker-zapisz'))
    await waitFor(() => expect(partieWiersza(0)).toBe('496'))

    fireEvent.click(screen.getByTestId('plan-partie'))
    fireEvent.click(await screen.findByTestId('picker-fefo'))
    await waitFor(() => expect(partieWiersza(0)).toBe('495'))
  })

  it('pozycji rozpoczętej na hali nie da się przepiąć', async () => {
    pokaz({ initialPlan: { planDate: '2026-08-26', lines: [
      { id: 'l1', qty: 10, kgPerUnit: 10, productTypeId: 'pt1', recipeId: 'r1',
        seasonedBatchId: 'b2', qtyDone: 4 },
    ] } })
    expect((screen.getByTestId('plan-partie') as HTMLButtonElement).disabled).toBe(true)
  })
})

/**
 * Płynne przeliczanie: ręczna zmiana partii ma NATYCHMIAST pokazać, gdzie
 * mięso doszło, a skąd zniknęło — bez zapisu i bez odświeżania ekranu.
 */
describe('PlanEditor — przeliczanie po ręcznej zmianie', () => {
  it('panel partii przepina „→ poz." na nową partię', async () => {
    pokaz()
    wbij('10', '10')
    // FEFO wzięło najstarszą (495) — panel to pokazuje.
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1/)).toBeTruthy()
    expect(within(screen.getByTestId('partia-b2')).queryByText(/poz\./)).toBeNull()

    fireEvent.click(screen.getByTestId('plan-partie'))
    fireEvent.click(within(await screen.findByTestId('picker-partia-b1')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByTestId('picker-partia-b2')).getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('picker-zapisz'))

    // Po ręcznej zmianie mięso zeszło z 495 na 496 — widać to od razu.
    await waitFor(() =>
      expect(within(screen.getByTestId('partia-b2')).getByText(/poz\. 1/)).toBeTruthy())
    expect(within(screen.getByTestId('partia-b1')).queryByText(/poz\./)).toBeNull()
  })

  it('wolne kilogramy partii wracają, gdy pozycja z niej zejdzie', async () => {
    pokaz()
    wbij('10', '10')
    expect(screen.getByTestId('partia-b1').textContent).toContain('200')  // 300 − 100

    fireEvent.click(screen.getByTestId('plan-partie'))
    fireEvent.click(within(await screen.findByTestId('picker-partia-b1')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByTestId('picker-partia-b2')).getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('picker-zapisz'))

    await waitFor(() => expect(screen.getByTestId('partia-b1').textContent).toContain('300'))
  })
})
