// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PlanMrozniDane } from '@/lib/api'
import { PlanMrozni } from './PlanMrozni'

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), block: vi.fn(), unblock: vi.fn() }))
vi.mock('@/lib/api', () => ({ magazynApi: { mrozniaPlan: api.read, mrozniaLokalizacja: api.save,
  mrozniaZajete: api.block, mrozniaZwolnij: api.unblock } }))
const empty = { kind: 'stock' as const, id: 'c1', code: 'SCARTON|c1', cartonNo: '000001', clientName: 'YALCIN', orderNo: '', location: null,
  lines: [{ qty: 12, kgPerUnit: 15, recipeName: 'KIRMIZI', productTypeName: 'UDO', packagingName: 'METAL 80' }] }
let plan: PlanMrozniDane
beforeEach(() => {
  vi.resetAllMocks()
  plan = { columns: [...'ABCDEFGHI'], rows: 7, cartons: [empty, { ...empty, id: 'c2', cartonNo: '000002',
    location: { slot: 'B2', rotation: 90, revision: 'v1' } }] }
  api.read.mockImplementation(async () => plan)
  api.save.mockResolvedValue({ slot: 'I7', rotation: 90, revision: 'v2' })
})
afterEach(cleanup)

describe('plan mroźni', () => {
  it('wolny kafelek → ręcznie zajęte bez skanowania i bez tworzenia kartonu', async () => {
    api.block.mockImplementation(async b => {
      const mark = { ...b, revision: 'manual1', operator: 'Jan', updatedAt: '' }
      plan = { ...plan, blocked: [mark] }
      return mark
    })
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'A1 · wolne' }))
    fireEvent.change(screen.getByLabelText('Co zajmuje miejsce (opcjonalnie)'), { target: { value: 'Łój wołowy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Oznacz jako zajęte' }))
    await screen.findByRole('button', { name: 'A1 · zajęte · Łój wołowy' })
    expect(api.block).toHaveBeenCalledWith({ slot: 'A1', description: 'Łój wołowy', expected_revision: null })
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByText(/Zajęte: 2\/63 · w tym ręcznie: 1/)).toBeTruthy()
  })

  it('ręczna blokada nie jest miejscem dla kartonu; zwolnienie wymaga potwierdzenia', async () => {
    plan = { ...plan, blocked: [{ slot: 'A1', description: 'Łój wołowy', revision: 'manual1', operator: 'Jan', updatedAt: '' }] }
    const { unmount } = render(<PlanMrozni cel={empty} onZamknij={vi.fn()} />)
    const blocked = await screen.findByRole('button', { name: 'A1 · zajęte · Łój wołowy' })
    await waitFor(() => expect((blocked as HTMLButtonElement).disabled).toBe(true))
    unmount()
    api.unblock.mockImplementation(async () => { plan = { ...plan, blocked: [] }; return { ok: true } })
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'A1 · zajęte · Łój wołowy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zwolnij miejsce' }))
    expect(api.unblock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Tak, zwolnij miejsce' }))
    await screen.findByRole('button', { name: 'A1 · wolne' })
    expect(api.unblock).toHaveBeenCalledWith({ slot: 'A1', expected_revision: 'manual1' })
  })

  it('konflikt ręcznego oznaczenia nie nadpisuje palety', async () => {
    api.block.mockRejectedValue(new Error('Miejsce jest zajęte przez karton'))
    render(<PlanMrozni onZamknij={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'A1 · wolne' }))
    fireEvent.click(screen.getByRole('button', { name: 'Oznacz jako zajęte' }))
    await screen.findByText('Miejsce jest zajęte przez karton')
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.queryByText('Miejsce A1 oznaczone jako zajęte.')).toBeNull()
  })
  it('63 miejsca, domyślnie dłuższym bokiem, obrót i zapis; zajęte zablokowane', async () => {
    const close = vi.fn()
    render(<PlanMrozni cel={empty} onZamknij={close} />)
    await screen.findByRole('heading', { name: 'Wybierz miejsce · karton 000001' })
    expect(screen.getAllByRole('button', { name: /^[A-I][1-7] ·/ })).toHaveLength(63)
    expect((screen.getByRole('button', { name: /B2 · karton/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Zapisz miejsce' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Dłuższym bokiem od drzwi')).toBeTruthy()
    expect(screen.getByText(/12 szt × 15 kg · KIRMIZI/)).toBeTruthy()
    expect(screen.getByText(/tuleja: METAL 80/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I7 · wolne' }))
    fireEvent.click(screen.getByRole('button', { name: 'Obróć o 90°' }))
    expect(screen.getByText('Krótszym bokiem od drzwi')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz miejsce' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(api.save).toHaveBeenCalledWith({ kind: 'stock', container_id: 'c1', slot: 'I7', rotation: 90, expected_revision: null })
  })

  it('szuka kartonu, pokazuje zawartość i przenosi z kontrolą wersji', async () => {
    render(<PlanMrozni onZamknij={vi.fn()} />)
    await screen.findByRole('button', { name: /B2 · karton 000002/ })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '000002' } })
    expect(screen.getByText(/Znaleziono: 1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /B2 · karton 000002/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś / obróć' }))
    fireEvent.click(screen.getByRole('button', { name: 'A1 · wolne' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz miejsce' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ container_id: 'c2', slot: 'A1', rotation: 90, expected_revision: 'v1' })))
  })

  it('konflikt zachowuje okno i wymaga ponownego wyboru; nie udaje sukcesu', async () => {
    api.save.mockRejectedValue(new Error('Miejsce A1 jest już zajęte. Wybierz inne.'))
    const close = vi.fn()
    render(<PlanMrozni cel={empty} onZamknij={close} />)
    await screen.findByRole('heading', { name: /Wybierz miejsce/ })
    fireEvent.click(screen.getByRole('button', { name: 'A1 · wolne' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz miejsce' }))
    await screen.findByRole('alert')
    expect(close).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Zapisz miejsce' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('brak sieci nie pokazuje pustej mroźni ani nie pozwala zapisywać', async () => {
    api.read.mockRejectedValue(new Error('offline'))
    render(<PlanMrozni cel={empty} onZamknij={vi.fn()} />)
    await screen.findByText(/Brak aktualnego planu/)
    expect(screen.queryByRole('button', { name: 'A1 · wolne' })).toBeNull()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('zamknięcie bez miejsca nie zapisuje domyślnego A1', async () => {
    const close = vi.fn()
    render(<PlanMrozni cel={empty} onZamknij={close} />)
    await screen.findByRole('heading', { name: /Wybierz miejsce/ })
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij bez zmiany miejsca' }))
    expect(close).toHaveBeenCalledOnce()
    expect(api.save).not.toHaveBeenCalled()
  })
})
