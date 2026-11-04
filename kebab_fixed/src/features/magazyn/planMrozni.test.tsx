// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PlanMrozniDane } from '@/lib/api'
import { PlanMrozni } from './PlanMrozni'
import { ROOM, firstFree, placementProblem, type Footprint } from './mrozniaGeometry'
import { findFreezerCartons, freezerTileSummary, freezerTube } from './mrozniaContents'
import { kolorZaladunku } from './koloryZaladunku'

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), block: vi.fn(), unblock: vi.fn(), swap: vi.fn() }))
vi.mock('@/lib/api', () => ({ magazynApi: { mrozniaPlan: api.read, mrozniaLokalizacja: api.save,
  mrozniaZajete: api.block, mrozniaZwolnij: api.unblock, mrozniaZamiana: api.swap } }))
const empty = { kind: 'stock' as const, id: 'c1', code: 'SCARTON|c1', cartonNo: '000001', clientName: 'YALCIN', orderNo: '', location: null,
  lines: [{ qty: 12, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO', packagingName: 'METAL 80' }] }
let plan: PlanMrozniDane
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
beforeEach(() => {
  vi.resetAllMocks()
  plan = { columns: [...'ABCDEFGHI'], rows: 7, room: ROOM, cartons: [empty, { ...empty, id: 'c2', cartonNo: '000002',
    location: { slot: 'X80Y0', xCm: 80, yCm: 0, rotation: 90, revision: 'v1' } }] }
  api.read.mockImplementation(async () => plan)
  api.save.mockResolvedValue({ slot: 'X0Y0', xCm: 0, yCm: 0, rotation: 90, revision: 'v2' })
})
afterEach(cleanup)

describe('plan mroźni w rzeczywistych wymiarach', () => {
  it('pięć zamówień jednego auta ma odrębne kolory, również przy tym samym kliencie; legenda filtruje po ID', async () => {
    const orders = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, clientName: 'YALCIN', orderNo: `Z/${i + 1}`,
      pallets: [], color: kolorZaladunku(i) }))
    plan.cartons = orders.flatMap((o, i) => [0, 1].map(j => ({ ...empty, id: `c${i}-${j}`, kind: j ? 'stock' as const : 'order' as const,
      cartonNo: String(100 + 2 * i + j), orderId: o.id, orderNo: o.orderNo,
      location: i === 4 && j === 1 ? null : { slot: `X${i * 80}Y${j * 120}`, xCm: i * 80, yCm: j * 120, rotation: 90 as const, revision: 'v1' } })))
    plan.cartons.push({ ...plan.cartons[0], id: 'foreign', cartonNo: '999', orderId: 'not-on-truck' })
    const props = { onZamknij: vi.fn(), zaladunek: { vehicleName: 'SOLÓWKA', orders, online: true } }
    const { rerender } = render(<PlanMrozni {...props} />)
    await screen.findByRole('region', { name: 'Kolory zamówień do załadunku' })
    const floor = within(screen.getByRole('group', { name: 'Podłoga mroźni' }))
    for (let i = 0; i < 5; i++) {
      expect(floor.getByRole('button', { name: new RegExp(`Karton ${100 + 2 * i} ·`) }).dataset.loadingColor).toBe(String(i))
    }
    expect(floor.getByRole('button', { name: /Karton 999 ·/ }).dataset.loadingColor).toBeUndefined()
    expect(screen.getByRole('region', { name: 'Zawartość kartonu 109' }).textContent).toContain('K5')
    click(/K5.*YALCIN.*Z\/5/)
    expect(screen.getAllByTestId('karton-zawartosc')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /K5.*YALCIN.*Z\/5/ }).textContent).toContain('W mroźni: 2 · bez położenia: 1')
    // Another station removes the filtered order: clear the effective filter and its colours.
    rerender(<PlanMrozni {...props} zaladunek={{ ...props.zaladunek, orders: orders.slice(0, 4) }} />)
    expect(screen.getAllByTestId('karton-zawartosc')).toHaveLength(11)
    expect(floor.getByRole('button', { name: /Karton 108 ·/ }).dataset.loadingColor).toBeUndefined()
    expect(floor.getByRole('button', { name: /Karton 102 ·/ }).dataset.loadingColor).toBe('1')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('zamiana dwóch kartonów pokazuje obie orientacje i wysyła jeden zapis obu wersji', async () => {
    plan.cartons.push({ ...empty, id: 'c3', kind: 'order', cartonNo: '000003',
      location: { slot: 'X240Y160', xCm: 240, yCm: 160, rotation: 0, revision: 'v2' } })
    let done!: () => void
    api.swap.mockImplementation(() => new Promise<void>(resolve => { done = resolve }))
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Karton 000002 ·/ }))
    click('Zamień miejscami')
    expect((screen.getByRole('button', { name: 'Zapisz zamianę' }) as HTMLButtonElement).disabled).toBe(true)
    click(/Karton 000003 ·/)
    const preview = screen.getByRole('region', { name: 'Podgląd zamiany' })
    expect(preview.textContent).toContain('000002 · YALCIN → X 240 · Y 160 cm · bok 120 cm od drzwi')
    expect(preview.textContent).toContain('000003 · YALCIN → X 80 · Y 0 cm · bok 80 cm od drzwi')
    click(/Szukaj kartonu/)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'BRAK-KARTONU' } })
    click('Gotowe')
    expect((screen.getByRole('button', { name: 'Zapisz zamianę' }) as HTMLButtonElement).disabled).toBe(true)
    click('Wyczyść filtr'); click(/Karton 000003 ·/)
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
    plan.cartons.push({ ...empty, id: 'c3', cartonNo: '000003', location: { slot: 'X160Y0', xCm: 160, yCm: 0, rotation: 90, revision: 'v2' } })
    api.swap.mockRejectedValue(new Error('Położenie jednego z kartonów zmieniło się'))
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Karton 000002 ·/ }))
    click('Zamień miejscami'); click(/Karton 000003 ·/); click('Anuluj zamianę')
    expect(api.swap).not.toHaveBeenCalled()
    click('Zamień miejscami'); click(/Karton 000002 ·/); click('Zapisz zamianę')
    await screen.findByText('Położenie jednego z kartonów zmieniło się')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Zapisz zamianę' })).toBeNull())
    expect(api.swap).toHaveBeenCalledTimes(1)
    expect(api.save).not.toHaveBeenCalled()
  })

  it('od wejścia pokazuje pełny skład każdego kartonu, oddzielne receptury i tylko niestandardową tuleję na skróconych kartach', async () => {
    plan.cartons[1].lines = [
      { qty: 12, kgPerUnit: 15, recipeName: 'BEYAZ', productTypeName: 'UDO', packagingName: 'METAL 65CM' },
      { qty: 6, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'INDYK', packagingName: 'METAL 80', source: 'plan' },
      { qty: 2, kgPerUnit: 25, recipeName: 'YAPRAK', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100CM' },
    ]
    render(<PlanMrozni onZamknij={vi.fn()} />)
    const cards = await screen.findAllByTestId('karton-zawartosc')
    expect(cards).toHaveLength(2)
    const card = within(screen.getByRole('region', { name: 'Zawartość kartonu 000002' }))
    expect(card.getByText('12 szt × 15 kg · BEYAZ')).toBeTruthy()
    expect(card.getByText('6 szt × 15 kg · KIRMIZI')).toBeTruthy()
    expect(card.getByText('2 szt × 25 kg · YAPRAK')).toBeTruthy()
    expect(card.getByText('tuleja: METAL 80 · niestandard')).toBeTruthy()
    expect(card.getByText('tuleja: PAPIER 100CM · niestandard')).toBeTruthy()
    expect(card.getByText('ROZPIS — bez skanów sztuk')).toBeTruthy()
    expect(card.queryByText(/METAL 65CM/)).toBeNull()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('wyszukanie numeru wyróżnia tylko właściwy karton; czyszczenie i brak wyników wyłączają pulsowanie', async () => {
    plan.cartons.push({ ...plan.cartons[1], id: 'c3', cartonNo: '000020', location: { slot: 'X160Y0', xCm: 160, yCm: 0, rotation: 90, revision: 'v1' } })
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Szukaj kartonu/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2' } })
    click('Gotowe')
    const target = screen.getByRole('button', { name: /Karton 000002 ·/ })
    const other = screen.getByRole('button', { name: /Karton 000020 ·/ })
    expect(target.dataset.highlighted).toBe('true')
    expect(other.dataset.highlighted).toBe('false')
    expect(screen.getAllByTestId('karton-zawartosc')).toHaveLength(1)
    click('Wyczyść filtr')
    expect(target.dataset.highlighted).toBe('false')
    expect(screen.getAllByTestId('karton-zawartosc')).toHaveLength(3)
    click(/Szukaj kartonu/)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'BRAK-KARTONU' } })
    click('Gotowe')
    expect(screen.getByText(/Nie znaleziono kartonów/)).toBeTruthy()
    expect(target.dataset.highlighted).toBe('false')
    expect(other.dataset.highlighted).toBe('false')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('obrót zmienia szerokość, blokuje kolizję i nie przesuwa sąsiada', async () => {
    render(<PlanMrozni cel={empty} onZamknij={vi.fn()} />)
    await screen.findByText(/Bok od drzwi: 80 cm/)
    click('Pokaż pierwsze wolne położenie')
    const preview = screen.getByLabelText('Podgląd palety')
    expect(preview.style.width).toBe(`${80 / 560 * 100}%`)
    click('Obróć o 90°')
    expect(preview.style.width).toBe(`${120 / 560 * 100}%`)
    expect(screen.getByRole('alert').textContent).toContain('nachodzi')
    expect((screen.getByRole('button', { name: 'Zapisz miejsce' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Na szerokość: 4 palety tym bokiem; zostaje 80 cm/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Karton 000002/ }).style.left).toBe(`${80 / 560 * 100}%`)
    click('Pokaż pierwsze wolne położenie')
    expect(screen.getByText(/Od lewej ściany: 160 cm/)).toBeTruthy()
    click('Zapisz miejsce')
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ kind: 'stock', container_id: 'c1', x_cm: 160, y_cm: 0, rotation: 0, expected_revision: null }))
  })

  it('towar bez skanowania: klawiatura dotykowa, polskie znaki, położenie i zapis', async () => {
    api.block.mockImplementation(async b => {
      const mark = { ...b, xCm: b.x_cm, yCm: b.y_cm, revision: 'manual1', operator: 'Jan', updatedAt: '' }
      plan = { ...plan, blocked: [mark] }; return mark
    })
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dodaj towar ręcznie' }))
    click(/Wpisz produkt/)
    const keyboard = screen.getByRole('dialog', { name: /Klawiatura/ })
    for (const name of ['ł', 'ó', 'j']) {
      fireEvent.click(within(keyboard).getByRole('button', { name }))
    }
    expect((within(keyboard).getByRole('textbox') as HTMLInputElement).value).toBe('łój')
    click('Gotowe')
    click('Pokaż pierwsze wolne położenie')
    click('Zapisz towar i położenie')
    await screen.findByRole('button', { name: 'Towar ręczny · łój' })
    expect(api.block).toHaveBeenCalledWith(expect.objectContaining({ description: 'łój', x_cm: 0, y_cm: 0, rotation: 90, expected_revision: null }))
    expect(api.save).not.toHaveBeenCalled()
    click('Towar ręczny · łój')
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
    click('Pokaż pierwsze wolne położenie')
    click('Zapisz miejsce')
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ container_id: 'c2', x_cm: 0, y_cm: 0, expected_revision: 'v1' })))
  })

  it('konflikt nie zamyka mapy i wymaga świadomego ponownego wyboru', async () => {
    api.save.mockRejectedValue(new Error('Położenie zajęte na innym stanowisku'))
    const close = vi.fn()
    render(<PlanMrozni cel={empty} onZamknij={close} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pokaż pierwsze wolne położenie' }))
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
    expect(screen.queryByLabelText('Podłoga mroźni')).toBeNull()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('stare miejsca nie otrzymują wymyślonych współrzędnych', async () => {
    plan.cartons[1].location = { slot: 'B2', rotation: 90, revision: 'old' }
    render(<PlanMrozni onZamknij={vi.fn()} />)
    await screen.findByText(/Stare adresy pól wymagają/)
    expect(screen.queryByRole('button', { name: /Karton 000002 ·/ })).toBeNull()
    expect(screen.getByText(/B2 · położenie do potwierdzenia/)).toBeTruthy()
    click('Zamknij mapę')
    expect(api.save).not.toHaveBeenCalled()
  })
})

it('skrót mieszanego kartonu nie przypisuje pierwszej receptury lub tulei do całości, a wyszukiwanie obejmuje cały skład', () => {
  const lines = [
    { qty: 12, kgPerUnit: 15, recipeName: 'BEYAZ', productTypeName: 'UDO', packagingName: 'METAL 65CM' },
    { qty: 6, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'WOŁOWINA', packagingName: 'PAPIER 100' },
  ]
  expect(freezerTileSummary(lines)).toEqual({ recipe: 'MIX · 2 receptury', quantity: '18 szt · 2 poz.', tubes: [100] })
  expect(findFreezerCartons([{ ...empty, lines }], 'wolowina 100')).toHaveLength(1)
  expect(freezerTube('METAL 65')).toEqual({ cm: 65, nonstandard: false })
  expect(freezerTube('Folia stretch')).toEqual({ cm: null, nonstandard: false })
})

it('560 cm mieści 7 × 80 lub 4 × 120; mieszane orientacje wykorzystują pozostałe 80 cm', () => {
  const narrow: Footprint[] = Array.from({ length: 7 }, (_, i) => ({ xCm: i * 80, yCm: 0, rotation: 90 }))
  expect(firstFree(90, narrow)?.yCm).toBe(120)
  const wide: Footprint[] = Array.from({ length: 4 }, (_, i) => ({ xCm: i * 120, yCm: 0, rotation: 0 }))
  expect(firstFree(0, wide)).toEqual({ xCm: 0, yCm: 80, rotation: 0 })
  expect(firstFree(90, wide)).toEqual({ xCm: 480, yCm: 0, rotation: 90 })
  expect(placementProblem({ xCm: 480, yCm: 960, rotation: 90 }, [])).toBe('')
  expect(placementProblem({ xCm: 480, yCm: 960, rotation: 0 }, [])).toContain('ścianę')
})
