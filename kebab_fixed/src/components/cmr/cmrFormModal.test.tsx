// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const { generate, generateDispatch, carriers } = vi.hoisted(() => ({
  generate: vi.fn(), generateDispatch: vi.fn(), carriers: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ carriersApi: { list: carriers }, cmrApi: { generate, generateDispatch } }))
import { CmrFormModal } from './CmrFormModal'
beforeEach(() => {
  vi.resetAllMocks()
  carriers.mockResolvedValue([{ id: 'c', name: 'Transport', defaultPlate: 'KR 12345' }])
  generate.mockResolvedValue({ id: 'cmr1' })
  generateDispatch.mockResolvedValue({ id: 'cmr2' })
  vi.spyOn(window, 'open').mockReturnValue({} as Window)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('CMR — wspólny dialog transportu', () => {
  it('zachowuje przewoźnika, numer auta i dodatkowy towar w kontrakcie API', async () => {
    const close = vi.fn()
    render(<CmrFormModal orderId="o1" onClose={close} />)
    await screen.findByRole('option', { name: 'Transport' })
    fireEvent.change(screen.getByLabelText('Przewoźnik'), { target: { value: 'c' } })
    await waitFor(() => expect((screen.getByLabelText('Nr rejestracyjny') as HTMLInputElement).value).toBe('KR 12345'))
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj pozycję' }))
    fireEvent.change(screen.getByLabelText('Nazwa towaru 1'), { target: { value: 'Dodatkowy towar' } })
    fireEvent.change(screen.getByLabelText('Sztuki 1'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Masa kg 1'), { target: { value: '20.125' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generuj CMR' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(generate).toHaveBeenCalledWith('o1', expect.objectContaining({ carrier_id: 'c', plate: 'KR 12345', goods_manual: [{ name: 'Dodatkowy towar', qty: 2, kg: 20.125 }] }))
    expect(window.open).toHaveBeenCalledWith('/office/cmr/cmr1/druk', '_blank')
  })
  it('błąd pozostawia formularz i wpisane dane', async () => {
    generate.mockRejectedValue(new Error('Nie można wystawić CMR'))
    const close = vi.fn()
    render(<CmrFormModal orderId="o1" onClose={close} />)
    fireEvent.change(screen.getByLabelText('Nr faktury (pole 5)'), { target: { value: 'FV/1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generuj CMR' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nie można wystawić CMR')
    expect((screen.getByLabelText('Nr faktury (pole 5)') as HTMLInputElement).value).toBe('FV/1')
    expect(close).not.toHaveBeenCalled()
  })
  it('zachowuje osobną ścieżkę wydania z kiosku', async () => {
    render(<CmrFormModal dispatchId="d1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generuj CMR' }))
    await waitFor(() => expect(generateDispatch).toHaveBeenCalledWith('d1', expect.any(Object)))
    expect(generate).not.toHaveBeenCalled()
  })
})
