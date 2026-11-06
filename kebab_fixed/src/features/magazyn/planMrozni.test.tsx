// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PlanMrozniDane } from '@/lib/api'
import { PlanMrozni } from './PlanMrozni'
import { clientLabel, findFreezerCartons, freezerTileLines, freezerTileSummary, freezerTube, tubeLabel } from './mrozniaContents'
import { kolorZaladunku } from './koloryZaladunku'

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), block: vi.fn(), unblock: vi.fn(), swap: vi.fn() }))
// No clientsApi on purpose: the HMI operator cannot read the client catalogue (403);
// the short trade name arrives with the plan (clientShortName).
vi.mock('@/lib/api', () => ({
  magazynApi: { mrozniaPlan: api.read, mrozniaLokalizacja: api.save,
  mrozniaZajete: api.block, mrozniaZwolnij: api.unblock, mrozniaZamiana: api.swap } }))
const empty = { kind: 'stock' as const, id: 'c1', code: 'SCARTON|c1', cartonNo: '000001', clientName: 'YALCIN', orderNo: '', location: null,
  lines: [{ qty: 12, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO', packagingName: 'METAL 80' }] }
let plan: PlanMrozniDane
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
beforeEach(() => {
  vi.resetAllMocks()
  plan = { columns: [...'ABCDEFGHI'], rows: 7, cartons: [empty, { ...empty, id: 'c2', cartonNo: '000002',
    location: { slot: 'B1', rotation: 90, revision: 'v1' } }] }
  api.read.mockImplementation(async () => plan)
  api.save.mockResolvedValue({ slot: 'A1', rotation: 0, revision: 'v2' })
})
afterEach(cleanup)

describe('okno mroźni z czytelnymi stałymi kafelkami', () => {
  it('pięć zamówień jednego auta ma odrębne kolory, również przy tym samym kliencie; legenda filtruje po ID', async () => {
    const orders = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, clientName: 'YALCIN', orderNo: `Z/${i + 1}`,
      pallets: [], color: kolorZaladunku(i) }))
    plan.cartons = orders.flatMap((o, i) => [0, 1].map(j => ({ ...empty, id: `c${i}-${j}`, kind: j ? 'stock' as const : 'order' as const,
      cartonNo: String(100 + 2 * i + j), orderId: o.id, orderNo: o.orderNo,
      location: i === 4 && j === 1 ? null : { slot: `${'ABCDE'[i]}${j + 1}`, rotation: 90 as const, revision: 'v1' } })))
    plan.cartons.push({ ...plan.cartons[0], id: 'foreign', cartonNo: '999', orderId: 'not-on-truck', location: { slot: 'I7', rotation: 0, revision: 'v1' } })
    const props = { onZamknij: vi.fn(), zaladunek: { vehicleName: 'SOLÓWKA', orders, online: true } }
    const { rerender } = render(<PlanMrozni {...props} />)
    // The legend is part of the loading view: no extra tap to see the colours.
    const floor = within(await screen.findByRole('group', { name: 'Stałe miejsca mroźni' }))
    for (let i = 0; i < 5; i++) {
      expect(floor.getByRole('button', { name: new RegExp(`Karton ${100 + 2 * i} ·`) }).dataset.loadingColor).toBe(String(i))
    }
    expect(floor.getByRole('button', { name: /Karton 999 ·/ }).dataset.loadingColor).toBeUndefined()
    expect(screen.getByRole('button', { name: /YALCIN.*Z\/5 ·/ }).textContent).toContain('W mroźni: 2 · bez położenia: 1')
    click(/YALCIN.*Z\/5 ·/)
    expect(floor.getByRole('button', { name: /Karton 108 ·/ }).dataset.dimmed).toBeUndefined()
    expect(floor.getByRole('button', { name: /Karton 100 ·/ }).dataset.dimmed).toBe('true')
    click('Bez miejsca (1)')
    expect(screen.getByRole('complementary', { name: 'Kartony bez miejsca' }).textContent).toContain('109')
    // Another station removes the filtered order: clear the effective filter and its colours.
    rerender(<PlanMrozni {...props} zaladunek={{ ...props.zaladunek, orders: orders.slice(0, 4) }} />)
    expect(floor.getByRole('button', { name: /Karton 100 ·/ }).dataset.dimmed).toBeUndefined()
    expect(floor.getByRole('button', { name: /Karton 108 ·/ }).dataset.loadingColor).toBeUndefined()
    expect(floor.getByRole('button', { name: /Karton 102 ·/ }).dataset.loadingColor).toBe('1')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('zamiana dwóch kartonów pokazuje obie orientacje i wysyła jeden zapis obu wersji', async () => {
    plan.cartons.push({ ...empty, id: 'c3', kind: 'order', cartonNo: '000003',
      location: { slot: 'D2', rotation: 0, revision: 'v2' } })
    let done!: () => void
    api.swap.mockImplementation(() => new Promise<void>(resolve => { done = resolve }))
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Karton 000002 ·/ }))
    click('Zamień miejscami')
    expect((screen.getByRole('button', { name: 'Zapisz zamianę' }) as HTMLButtonElement).disabled).toBe(true)
    click(/Karton 000003 ·/)
    const preview = screen.getByRole('region', { name: 'Podgląd zamiany' })
    expect(preview.textContent).toContain('000002 · YALCIN → Miejsce D2 · dłuższym bokiem od drzwi')
    expect(preview.textContent).toContain('000003 · YALCIN → Miejsce B1 · krótszym bokiem od drzwi')
    // The whole plan stays in view: no detail panel covers it during a swap.
    expect(screen.queryByRole('complementary')).toBeNull()
    click('Zapisz zamianę')
    expect(api.swap).toHaveBeenCalledTimes(1)
    expect(api.swap).toHaveBeenCalledWith({
      first: { kind: 'stock', container_id: 'c2', expected_revision: 'v1' },
      second: { kind: 'order', container_id: 'c3', expected_revision: 'v2' },
    })
    expect((screen.getByRole('button', { name: 'Zapisuję…' }) as HTMLButtonElement).disabled).toBe(true)
    done()
    await screen.findByText('Zamieniono miejscami kartony 000002 i 000003.')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('anulowanie zamiany i konflikt serwera nie wykonują pojedynczych przeniesień ani ponowień', async () => {
    plan.cartons.push({ ...empty, id: 'c3', cartonNo: '000003', location: { slot: 'C1', rotation: 90, revision: 'v2' } })
    api.swap.mockRejectedValue(new Error('Położenie jednego z kartonów zmieniło się'))
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Karton 000002 ·/ }))
    click('Zamień miejscami'); click(/Karton 000003 ·/); click('Anuluj zamianę')
    expect(api.swap).not.toHaveBeenCalled()
    click(/Karton 000003 ·/); click('Zamień miejscami'); click(/Karton 000002 ·/); click('Zapisz zamianę')
    await screen.findByText('Położenie jednego z kartonów zmieniło się')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Zapisz zamianę' })).toBeNull())
    expect(api.swap).toHaveBeenCalledTimes(1)
    expect(api.save).not.toHaveBeenCalled()
  })

  it('kafelek: skrót klienta, wszystkie receptury, pełne nazwy niestandardowych tulei; panel: pełny skład', async () => {
    plan.cartons[1] = { ...plan.cartons[1], clientName: 'YALCIN SPÓŁKA Z O.O.', clientShortName: 'YALCIN' }
    plan.cartons[1].lines = [
      { qty: 12, kgPerUnit: 15, recipeName: 'BEYAZ', productTypeName: 'UDO', packagingName: 'METAL 65CM' },
      { qty: 6, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'INDYK', packagingName: 'METAL 80', source: 'plan' },
      { qty: 2, kgPerUnit: 25, recipeName: 'YAPRAK', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100CM' },
    ]
    render(<PlanMrozni onZamknij={vi.fn()} />)
    const tile = within(await screen.findByRole('button', { name: /B1 · Karton/ }))
    expect(await tile.findByText('YALCIN')).toBeTruthy()
    // One row per item as the hall says it; the tube only when not standard (small font).
    const rows = [...document.querySelectorAll('[data-slot="B1"] .mroznia-tile-line')].map(e => e.textContent)
    expect(rows).toEqual(['12×15kg BEYAZ', '6×15kg KIRMIZI METAL 80cm', '2×25kg YAPRAK PAPIER 100cm'])
    expect(tile.getByText('METAL 80cm')).toBeTruthy()
    expect(tile.getByText('2')).toBeTruthy()   // carton number (small)
    expect(tile.getByText('PAPIER 100cm')).toBeTruthy()
    expect(tile.queryByText(/65/)).toBeNull()
    expect(tile.queryByText(/niestandard/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /B1 · Karton/ }))
    const card = within(screen.getByRole('complementary', { name: 'Szczegóły kartonu 000002' }))
    expect(card.getByText('YALCIN')).toBeTruthy()
    expect(card.getByText('YALCIN SPÓŁKA Z O.O.')).toBeTruthy()
    expect(card.getByText('12 szt × 15 kg · BEYAZ')).toBeTruthy()
    expect(card.getByText('6 szt × 15 kg · KIRMIZI')).toBeTruthy()
    expect(card.getByText('2 szt × 25 kg · YAPRAK')).toBeTruthy()
    expect(card.getByText('tuleja: METAL 80cm')).toBeTruthy()
    expect(card.getByText('tuleja: PAPIER 100cm')).toBeTruthy()
    expect(card.getByText('tuleja: METAL 65cm')).toBeTruthy()
    expect(card.getByText('ROZPIS — bez skanów sztuk')).toBeTruthy()
    expect(card.queryByText(/niestandard/i)).toBeNull()
    click('Zamknij szczegóły')
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('wyszukanie numeru wyróżnia tylko właściwy karton; czyszczenie i brak wyników wyłączają pulsowanie', async () => {
    plan.cartons.push({ ...plan.cartons[1], id: 'c3', cartonNo: '000020', location: { slot: 'C1', rotation: 90, revision: 'v1' } })
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Szukaj kartonu/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2' } })
    click('Gotowe')
    const target = screen.getByRole('button', { name: /Karton 000002 ·/ })
    const other = screen.getByRole('button', { name: /Karton 000020 ·/ })
    expect(target.dataset.highlighted).toBe('true')
    expect(other.dataset.highlighted).toBe('false')
    expect(screen.getByRole('status').textContent).toBe('Znaleziono: 1')
    // A single hit opens its details straight away.
    expect(screen.getByRole('complementary', { name: 'Szczegóły kartonu 000002' })).toBeTruthy()
    click('Wyczyść filtr')
    expect(target.dataset.highlighted).toBe('false')
    expect(screen.queryByRole('complementary')).toBeNull()
    click(/Szukaj kartonu/)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'BRAK-KARTONU' } })
    click('Gotowe')
    expect(screen.getByText(/Nie znaleziono kartonów/)).toBeTruthy()
    expect(target.dataset.highlighted).toBe('false')
    expect(other.dataset.highlighted).toBe('false')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('gotowe kafelki zachowują adresy; zapis wybiera wolne miejsce i orientację bez przesuwania sąsiada', async () => {
    render(<PlanMrozni cel={empty} onZamknij={vi.fn()} />)
    const floor = within(await screen.findByRole('group', { name: 'Stałe miejsca mroźni' }))
    expect(floor.getAllByRole('button')).toHaveLength(63)
    expect(floor.getAllByRole('button')[0].dataset.slot).toBe('A7')
    expect(floor.getAllByRole('button')[62].dataset.slot).toBe('I1')
    expect((floor.getByRole('button', { name: /B1 · Karton/ }) as HTMLButtonElement).disabled).toBe(true)
    click('A1 · wolne')
    click('Obróć o 90°')
    expect(screen.getByText('Krótszym bokiem od drzwi')).toBeTruthy()
    expect(floor.getByRole('button', { name: /B1 · Karton/ }).dataset.slot).toBe('B1')
    expect(floor.getByRole('button', { name: 'A1 · wolne' }).getAttribute('aria-pressed')).toBe('true')
    click('Zapisz miejsce')
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ kind: 'stock', container_id: 'c1', slot: 'A1', rotation: 90, expected_revision: null }))
  })

  it('pozostałość po wycofanej mapie 1.0.23 (X…Y…) jest „bez miejsca” i nie podsuwa niezapisywalnego adresu', async () => {
    const legacy = { ...empty, id: 'c9', cartonNo: '000009', location: { slot: 'X160Y360', rotation: 90 as const, revision: 'old' } }
    plan.cartons = [legacy]
    render(<PlanMrozni cel={legacy} onZamknij={vi.fn()} />)
    const floor = within(await screen.findByRole('group', { name: 'Stałe miejsca mroźni' }))
    expect(floor.queryByRole('button', { name: /Karton 000009/ })).toBeNull()
    expect(await screen.findByText(/Wybrane miejsce: dotknij wolnego kafelka/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Zapisz miejsce' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Zamień miejscami' })).toBeNull()
    click('C4 · wolne')
    click('Zapisz miejsce')
    // The stale coordinate row is replaced by a fixed place, using its revision.
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ kind: 'stock', container_id: 'c9', slot: 'C4', rotation: 90, expected_revision: 'old' }))
  })

  it('towar bez skanowania: klawiatura dotykowa, polskie znaki, położenie i zapis', async () => {
    api.block.mockImplementation(async b => {
      const mark = { ...b, revision: 'manual1', operator: 'Jan', updatedAt: '' }
      plan = { ...plan, blocked: [mark] }; return mark
    })
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'A1 · wolne' }))
    click(/Wpisz produkt/)
    const keyboard = screen.getByRole('dialog', { name: /Klawiatura/ })
    for (const name of ['ł', 'ó', 'j']) {
      fireEvent.click(within(keyboard).getByRole('button', { name }))
    }
    expect((within(keyboard).getByRole('textbox') as HTMLInputElement).value).toBe('łój')
    click('Gotowe')
    click('Zapisz towar')
    await screen.findByRole('button', { name: 'A1 · zajęte · łój' })
    expect(api.block).toHaveBeenCalledWith({ slot: 'A1', description: 'łój', expected_revision: null })
    expect(api.save).not.toHaveBeenCalled()
    click('A1 · zajęte · łój')
    click('Zwolnij miejsce')
    expect(api.unblock).not.toHaveBeenCalled()
    click('Tak, zwolnij miejsce')
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith({ slot: api.block.mock.calls[0][0].slot, expected_revision: 'manual1' }))
  })

  it('wyszukiwanie dotykiem i przeniesienie zachowują wersję lokalizacji', async () => {
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Szukaj kartonu/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '000002' } })
    click('Gotowe')
    click(/Karton 000002 ·/)
    expect(screen.getByText(/12 szt × 15 kg · KIRMIZI/)).toBeTruthy()
    click('Przenieś / obróć')
    click('A1 · wolne')
    click('Zapisz miejsce')
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ container_id: 'c2', slot: 'A1', expected_revision: 'v1' })))
  })

  it('konflikt nie zamyka mapy i wymaga świadomego ponownego wyboru', async () => {
    api.save.mockRejectedValue(new Error('Położenie zajęte na innym stanowisku'))
    const close = vi.fn()
    render(<PlanMrozni cel={empty} onZamknij={close} />)
    fireEvent.click(await screen.findByRole('button', { name: 'A1 · wolne' }))
    click('Zapisz miejsce')
    await screen.findByText('Położenie zajęte na innym stanowisku')
    expect(close).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Zapisz miejsce' })).toBeNull()
    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it('brak sieci nie pokazuje pustej mroźni ani nie pozwala zapisywać', async () => {
    api.read.mockRejectedValue(new Error('offline'))
    render(<PlanMrozni cel={empty} onZamknij={vi.fn()} />)
    await screen.findByText(/Brak aktualnego planu/)
    expect(screen.queryByLabelText('Stałe miejsca mroźni')).toBeNull()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('dotychczasowe miejsca są od razu widoczne bez przepisywania lub zapisywania planu', async () => {
    plan.cartons[1].location = { slot: 'B2', rotation: 90, revision: 'old' }
    render(<PlanMrozni onZamknij={vi.fn()} />)
    await screen.findByRole('button', { name: 'B2 · Karton 000002 · YALCIN' })
    expect(screen.getByRole('group', { name: 'Stałe miejsca mroźni' }).querySelectorAll('button')).toHaveLength(63)
    expect(screen.queryByText(/do potwierdzenia/)).toBeNull()
    click('Zamknij mapę')
    expect(api.save).not.toHaveBeenCalled()
  })
})

it('skrót mieszanego kartonu nie przypisuje pierwszej receptury lub tulei do całości, a wyszukiwanie obejmuje cały skład', () => {
  const lines = [
    { qty: 12, kgPerUnit: 15, recipeName: 'BEYAZ', productTypeName: 'UDO', packagingName: 'METAL 65CM' },
    { qty: 6, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100' },
  ]
  expect(freezerTileSummary(lines)).toEqual({ recipe: 'BEYAZ / KIRMIZI', quantity: '18 szt · 2 poz.', tubes: [100], tubeLabels: ['PAPIER 100cm'] })
  expect(findFreezerCartons([{ ...empty, lines }], 'wolowina 100')).toHaveLength(1)
  expect(findFreezerCartons([{ ...empty, clientName: 'Pełna nazwa prawna', clientShortName: 'YALCIN' }], 'YALCIN')).toHaveLength(1)
  expect(tubeLabel('METAL 80')).toBe('METAL 80cm')
  expect(tubeLabel(' PAPIER 100 CM ')).toBe('PAPIER 100cm')
  expect(tubeLabel('METAL 80cm')).toBe('METAL 80cm')
  expect(tubeLabel('80cm METAL')).toBe('80cm METAL')
  expect(clientLabel({ clientName: 'YBM Gastro GmbH', clientShortName: 'YALCIN' })).toBe('YALCIN')
  expect(clientLabel({ clientName: 'YBM Gastro GmbH', clientShortName: '' })).toBe('YBM Gastro GmbH')
  expect(clientLabel({ clientName: '' })).toBe('MAGAZYN')
  expect(freezerTube('METAL 65')).toEqual({ cm: 65, nonstandard: false })
  expect(freezerTube('Folia stretch')).toEqual({ cm: null, nonstandard: false })
})


it('tile rows: equal items add up, standard tubes stay silent, odd tubes keep their full name', () => {
  expect(freezerTileLines([
    { qty: 10, kgPerUnit: 30, recipeName: 'KIRMIZI', productTypeName: 'INDYK', packagingName: 'METAL 80' },
    { qty: 10, kgPerUnit: 35, recipeName: 'KIRMIZI', productTypeName: 'INDYK', packagingName: 'METAL 80CM' },
    { qty: 5, kgPerUnit: 40, recipeName: 'KIRMIZI', productTypeName: 'INDYK', packagingName: 'METAL 65CM' },
    { qty: 15, kgPerUnit: 40, recipeName: 'KIRMIZI', productTypeName: 'INDYK', packagingName: 'METAL 65CM' },
  ]).map(l => [l.text, l.tube])).toEqual([
    ['10×30kg KIRMIZI', 'METAL 80cm'], ['10×35kg KIRMIZI', 'METAL 80cm'], ['20×40kg KIRMIZI', null],
  ])
})
