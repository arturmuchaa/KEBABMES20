// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TakeSettlementWizard } from './TakeSettlementWizard'
import { settlementPendingKey, type TakeSettlement, type SettlementMeasurement, type SettlementKind } from './settlement'
import type { ScaleState } from './useScale'
import { takeSettlementApi } from '@/lib/api'

vi.mock('@/lib/api', () => ({ takeSettlementApi: {
  weigh: vi.fn(), correct: vi.fn(), advance: vi.fn(), finish: vi.fn(), reopen: vi.fn(),
} }))

function state(overrides: Partial<TakeSettlement> = {}): TakeSettlement {
  return {
    id: 'take-1', sessionId: 's1', sessionDate: '2026-11-05', rawBatchId: 'batch-1', rawBatchNo: '620',
    workerId: 'w1', workerName: 'JAN KOWALSKI', kgTaken: 300, kgMeat: 0, kgBacks: 0, kgBones: 0,
    kgRemainder: 300, yieldPct: 0, sessionNo: 'ROZ/05/11/26', createdAt: '2026-11-05T06:00:00Z',
    status: 'pending', meatType: 'zs', mode: 'worker', stage: 'meat',
    meatKg: 0, backsKg: 0, bonesKg: 0, totalKg: 0, differenceKg: -300, balancePct: 0,
    tolerancePct: 1, toleranceKg: 3, minKg: 297, maxKg: 303, withinTolerance: false, weighings: [],
    ...overrides,
  }
}
const scale = (gross = 0, connected = true, stable = true): ScaleState => ({ available: true, connected, stable, gross, tare: vi.fn() })
let server: TakeSettlement
const onClose = vi.fn()
const onChange = vi.fn()

function append(dto: SettlementMeasurement) {
  const key = `${dto.kind}Kg` as 'meatKg' | 'backsKg' | 'bonesKg'
  server = { ...server, [key]: server[key] + dto.kgNet,
    weighings: [...server.weighings, { ...dto, id: dto.requestId, weighedAt: '2026-11-05T07:00:00Z' }] }
  const total = server.meatKg + server.backsKg + server.bonesKg
  server = { ...server, totalKg: total, differenceKg: total - 300, balancePct: total / 3, withinTolerance: total >= 297 && total <= 303 }
  return server
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); server = state()
  vi.mocked(takeSettlementApi.weigh).mockImplementation(async (_id, dto) => append(dto))
  vi.mocked(takeSettlementApi.advance).mockImplementation(async (_id, kind) => {
    server = { ...server, stage: ({ meat: 'backs', backs: 'bones', bones: 'balance' } as const)[kind] }
    return server
  })
  vi.mocked(takeSettlementApi.finish).mockImplementation(async () => server = { ...server, status: 'complete', stage: 'done' })
})
afterEach(cleanup)

function renderWizard(reading = scale(), initialState = server) {
  const props = { initialState, scale: reading, cartTares: [6, 91], onClose, onChange }
  const view = render(<TakeSettlementWizard {...props} />)
  return { ...view, reading: (next: ScaleState) => view.rerender(<TakeSettlementWizard {...props} scale={next} />) }
}

async function weighCart(kind: SettlementKind, net: number, view: ReturnType<typeof renderWizard>) {
  view.reading(scale(net + 16))
  fireEvent.click(screen.getByRole('button', { name: /wózek 6,0/ }))
  fireEvent.change(screen.getByLabelText('Liczba pojemników E2'), { target: { value: '5' } })
  const save = screen.getByRole('button', { name: 'Zapisz ważenie' }) as HTMLButtonElement
  expect(save.disabled).toBe(false)
  fireEvent.click(save)
  await waitFor(() => expect(server[`${kind}Kg`]).toBe(net))
  await waitFor(() => expect(screen.getByRole('button', { name: /gotowe —/ }).hasAttribute('disabled')).toBe(false))
  view.reading(scale(0))
  fireEvent.click(screen.getByRole('button', { name: /gotowe —/ }))
  await waitFor(() => expect(takeSettlementApi.advance).toHaveBeenCalledWith('take-1', kind, false))
}

describe('prowadzone rozliczenie pobrania', () => {
  it('prowadzi mięso → grzbiety → kości i zamyka dopiero po pełnym bilansie', async () => {
    const view = renderWizard()
    expect(screen.getByRole('heading', { name: /JAN KOWALSKI/ })).toBeTruthy()
    await weighCart('meat', 200, view)
    await screen.findByRole('heading', { name: /KROK 2\/3/ })
    expect((screen.getByLabelText('Liczba pojemników E2') as HTMLInputElement).value).toBe('')
    expect(takeSettlementApi.finish).not.toHaveBeenCalled()
    await weighCart('backs', 55, view)
    await screen.findByRole('heading', { name: /KROK 3\/3/ })
    await weighCart('bones', 44, view)
    await screen.findByRole('heading', { name: 'Sprawdź pełny bilans' })
    expect(screen.getByText('Brakuje 1,00 kg')).toBeTruthy()
    expect(screen.getByText('✓ W tolerancji ±1%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zatwierdź rozliczenie' }))
    await screen.findByRole('heading', { name: 'Pobranie rozliczone' })
    expect(takeSettlementApi.weigh).toHaveBeenCalledTimes(3)
    expect(takeSettlementApi.finish).toHaveBeenCalledTimes(1)
  })

  it.each([297, 303])('akceptuje granicę %s kg dla pobrania 300 kg', total => {
    renderWizard(scale(), state({ stage: 'balance', meatKg: 200, backsKg: 55, bonesKg: total - 255,
      totalKg: total, differenceKg: total - 300, withinTolerance: true }))
    expect((screen.getByRole('button', { name: 'Zatwierdź rozliczenie' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/297,00–303,00 kg/)).toBeTruthy()
  })

  it.each([296.99, 303.01])('nie zamyka %s kg poza 1%, choć mieściłoby się w 2%', total => {
    renderWizard(scale(), state({ stage: 'balance', totalKg: total, differenceKg: total - 300 }))
    const finish = screen.getByRole('button', { name: 'Zatwierdź rozliczenie' })
    expect((finish as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(finish)
    expect(takeSettlementApi.finish).not.toHaveBeenCalled()
    expect(screen.getByText('Poza tolerancją ±1%')).toBeTruthy()
  })

  it('nie zapisuje niestabilnej ani odłączonej wagi', () => {
    const view = renderWizard(scale(216, true, false))
    fireEvent.click(screen.getByRole('button', { name: /wózek 6,0/ }))
    fireEvent.change(screen.getByLabelText('Liczba pojemników E2'), { target: { value: '5' } })
    expect((screen.getByRole('button', { name: 'Zapisz ważenie' }) as HTMLButtonElement).disabled).toBe(true)
    view.reading(scale(216, false))
    expect((screen.getByRole('button', { name: 'Zapisz ważenie' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('po zapisie wymaga zjazdu i nie przenosi tary do kolejnej frakcji', async () => {
    const view = renderWizard(scale(216))
    fireEvent.click(screen.getByRole('button', { name: /wózek 6,0/ }))
    fireEvent.change(screen.getByLabelText('Liczba pojemników E2'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ważenie' }))
    await screen.findByText('Zjedź z wagi przed kolejnym pomiarem.')
    fireEvent.click(screen.getByRole('button', { name: /Mięso gotowe/ }))
    await screen.findByRole('heading', { name: /KROK 2/ })
    fireEvent.click(screen.getByRole('button', { name: /wózek 6,0/ }))
    fireEvent.change(screen.getByLabelText('Liczba pojemników E2'), { target: { value: '5' } })
    expect((screen.getByRole('button', { name: 'Zapisz ważenie' }) as HTMLButtonElement).disabled).toBe(true)
    view.reading(scale(0)); view.reading(scale(71))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Zapisz ważenie' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('po zjeździe zachowuje ostatni stabilny pomiar, bez automatycznego zapisu', async () => {
    const view = renderWizard(scale(216))
    fireEvent.click(screen.getByRole('button', { name: /wózek 6,0/ }))
    fireEvent.change(screen.getByLabelText('Liczba pojemników E2'), { target: { value: '5' } })
    view.reading(scale(0))
    await screen.findByText('Zapamiętany stabilny pomiar — jeszcze niezapisany')
    expect(takeSettlementApi.weigh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ważenie' }))
    await waitFor(() => expect(takeSettlementApi.weigh).toHaveBeenCalledWith('take-1', expect.objectContaining({ kgNet: 200, kgGross: 216, tareCartKg: 6, tareE2Kg: 10 })))
  })

  it('ręczne ważenie wymaga powodu i obsługuje klawiaturę dotykową', async () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: 'Ręcznie' }))
    const keypad = screen.getByLabelText('Klawiatura numeryczna')
    for (const digit of ['2', '0', '0']) fireEvent.click(within(keypad).getByRole('button', { name: digit }))
    expect((screen.getByLabelText('Masa netto (kg)') as HTMLInputElement).value).toBe('200')
    expect((screen.getByRole('button', { name: 'Zapisz ważenie' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Waga niedostępna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ważenie' }))
    await waitFor(() => expect(takeSettlementApi.weigh).toHaveBeenCalledWith('take-1', expect.objectContaining({ kgNet: 200, weighMode: 'manual', reason: 'Waga niedostępna' })))
  })

  it('po utracie odpowiedzi i restarcie ponawia dokładnie ten sam pomiar', async () => {
    vi.mocked(takeSettlementApi.weigh).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const view = renderWizard(scale(216))
    fireEvent.click(screen.getByRole('button', { name: /wózek 6,0/ }))
    fireEvent.change(screen.getByLabelText('Liczba pojemników E2'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ważenie' }))
    await screen.findByText('Failed to fetch')
    const first = vi.mocked(takeSettlementApi.weigh).mock.calls[0][1]
    expect(localStorage.getItem(settlementPendingKey('take-1'))).toContain(first.requestId)
    view.unmount(); renderWizard(scale(0))
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź / ponów zapis' }))
    await waitFor(() => expect(takeSettlementApi.weigh).toHaveBeenCalledTimes(2))
    expect(vi.mocked(takeSettlementApi.weigh).mock.calls[1][1]).toEqual(first)
    await waitFor(() => expect(localStorage.getItem(settlementPendingKey('take-1'))).toBeNull())
  })

  it('wznowienie zaczyna od zapisanych kości, nie od mięsa', () => {
    renderWizard(scale(), state({ stage: 'bones', meatKg: 200, backsKg: 55, totalKg: 255, differenceKg: -45 }))
    expect(screen.getByRole('heading', { name: /KROK 3\/3 — Zważ kości/ })).toBeTruthy()
    expect(screen.getByText('Brakuje 45,00 kg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /dokończ później/i }))
    expect(onClose).toHaveBeenCalledWith(false)
  })
})
