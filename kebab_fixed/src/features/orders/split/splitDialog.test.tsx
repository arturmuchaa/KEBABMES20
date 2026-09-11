// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const podglad   = vi.hoisted(() => ({ fn: vi.fn() }))
const zapisz    = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const dokumenty = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
const anuluj    = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve({})) }))
vi.mock('@/lib/api', () => ({
  orderSplitApi: {
    preview: podglad.fn,
    save: zapisz.fn,
    documents: dokumenty.fn,
    cancelDocuments: anuluj.fn,
  },
}))

import { SplitDialog } from './SplitDialog'

const ODPOWIEDZ = {
  kg_calosc: 13005, kg_fv: 7995, kg_wz: 5010, odchylka: -5,
  lines: [
    { id: 'l1', recipe_name: 'KIRMIZI', kg_per_unit: 50, qty: 15, qty_invoice: 9, qty_wz: 6 },
    { id: 'l2', recipe_name: 'BEYAZ AFIYET', kg_per_unit: 40, qty: 40, qty_invoice: 25, qty_wz: 15 },
  ],
}

afterEach(cleanup)

describe('SplitDialog', () => {
  it('pokazuje podzial po wpisaniu kilogramow', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('7995')).toBeTruthy())
    expect(screen.getByText('5010')).toBeTruthy()
  })

  it('pokazuje odchylke od celu', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText(/-5 kg/)).toBeTruthy())
  })

  it('przycisk 50/50 wpisuje polowe calosci', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} kgCalosc={13005} />)
    fireEvent.click(screen.getByRole('button', { name: /50\/50/ }))
    await waitFor(() => expect(podglad.fn).toHaveBeenCalledWith('o1', 6502.5))
  })

  it('kazda pozycja pokazuje ile na FV i ile na WZ', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    expect(screen.getByDisplayValue('9')).toBeTruthy()
  })

  // ── Testy dopisane ponad brief ──────────────────────────────────────

  it('gdy nie da sie trafic w cel calymi sztukami, mowi to wprost obok odchylki', async () => {
    podglad.fn.mockResolvedValue({ ...ODPOWIEDZ, trafiono: false })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText(/nie da się trafić/i)).toBeTruthy())
    // Odchylka widoczna OBOK (w ostrzeżeniu i w stopce) — nie trzeba jej szukać osobno.
    expect(screen.getAllByText(/-5 kg/).length).toBeGreaterThan(0)
  })

  it('gdy podzial trafia dokladnie w cel, nie straszy odchylka', async () => {
    podglad.fn.mockResolvedValue({ ...ODPOWIEDZ, trafiono: true, odchylka: 0 })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '7995' } })
    await waitFor(() => expect(screen.getByText('7995')).toBeTruthy())
    expect(screen.queryByText(/nie da się trafić/i)).toBeNull()
  })

  it('reczna korekta pojedynczej linii idzie do zapisu przez per_line', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockResolvedValue({ ...ODPOWIEDZ, kg_fv: 8050, kg_wz: 4955 })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    // Biuro poprawia RĘCZNIE jedną pozycję — z 9 na 10 sztuk na fakturę.
    fireEvent.change(screen.getByDisplayValue('9'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() => expect(zapisz.fn).toHaveBeenCalledWith('o1', 8000, { l1: 10 }))
  })

  it('wystawia komplet dokumentow z checkboxem HDI do faktury i pokazuje numery', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    dokumenty.fn.mockResolvedValue({
      order_id: 'o1',
      wm: { id: 'wm1', number: 'WM/1/09/2026' },
      wz: { id: 'wz1', number: 'WZ/2/09/2026' },
      cmr: [{ id: 'c1', number: 'CMR/1' }, { id: 'c2', number: 'CMR/2' }],
      hdi_calosc: { id: 'h1', number: 'HDI/1' },
      hdi_fv: { id: 'h2', number: 'HDI/2' },
    })
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText(/także HDI do faktury/i))
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(dokumenty.fn).toHaveBeenCalledWith('o1', true))
    expect(screen.getByText('WM/1/09/2026')).toBeTruthy()
  })

  it('gdy zapis odmawia bo dokumenty juz wystawione, oferuje anulowanie ich na miejscu', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    zapisz.fn.mockRejectedValue(new Error(
      'Zamówienie ma już wystawione dokumenty z podziału (WM/1/09/2026) — zmiana podziału ' +
      'rozjechałaby je między sobą. Żeby zmienić podział, najpierw anuluj dokumenty podziału ' +
      '(przycisk „Anuluj podział” na zamówieniu).'))
    anuluj.fn.mockResolvedValue({ order_id: 'o1', documents: [], returned_qty: 42 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /zapisz podział/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /anuluj dokumenty podziału/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /anuluj dokumenty podziału/i }))
    await waitFor(() => expect(anuluj.fn).toHaveBeenCalledWith('o1'))
    expect(screen.getByText(/42/)).toBeTruthy()
  })

  it('gdy wystawienie kompletu odmawia bo brak zapisanego podzialu, nie proponuje anulowania', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    dokumenty.fn.mockRejectedValue(new Error(
      'Zamówienie nie ma podziału na fakturę i WZ — najpierw zapisz podział.'))
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /wystaw komplet dokumentów/i }))
    await waitFor(() => expect(screen.getByText(/najpierw zapisz podział/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /anuluj dokumenty podziału/i })).toBeNull()
  })
})
