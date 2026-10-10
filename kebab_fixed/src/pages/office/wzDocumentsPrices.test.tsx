// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({ doc: {} as any }))
const api = vi.hoisted(() => ({
  list: vi.fn(), byId: vi.fn(), updatePrices: vi.fn(), updateLines: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ wzApi: api, hdiApi: {}, downloadDocPdf: vi.fn() }))
vi.mock('@/lib/otworzDokument', () => ({ useOtworzDokument: () => vi.fn() }))
vi.mock('@/features/wz/WydaniaSztukCard', () => ({ WydaniaSztukCard: () => null }))
vi.mock('@/features/wz/SladSkanowania', () => ({ SladSkanowania: () => null }))
vi.mock('@/components/wz/WzDocumentView', () => ({ WzDocumentView: () => null }))

import { WzDocumentsPage } from './WzDocumentsPage'

beforeEach(() => {
  vi.clearAllMocks()
  state.doc = {
    id: 'w23', number: 'WZ/23/10/26', source_type: 'order', source_id: 'yalcin',
    doc_series: 'WZ', split_scope: 'wz_klienta', buyer_name: 'Emin Handels GmbH',
    issued_date: '2026-10-10', status: 'wstepny', valued: true,
    currency: 'EUR', eur_rate: 4.39, total_value: 12400,
    lines: [
      { name: 'KEBAB UDO KIRMIZI', qty: 104, unit: 'szt', total_kg: 2345, price: 3.1, value: 7269.5 },
      { name: 'KEBAB UDO BEYAZ AFIYET', qty: 52, unit: 'szt', total_kg: 1655, price: 3.1, value: 5130.5 },
    ],
  }
  api.list.mockImplementation(async () => [structuredClone(state.doc)])
  api.byId.mockImplementation(async () => structuredClone(state.doc))
  api.updatePrices.mockImplementation(async (_id, prices) => {
    state.doc.lines = state.doc.lines.map((l: any, i: number) => ({
      ...l, price: prices[i].price, value: l.total_kg * prices[i].price,
    }))
    state.doc.total_value = state.doc.lines.reduce((s: number, l: any) => s + l.value, 0)
    return structuredClone(state.doc)
  })
})
afterEach(cleanup)

async function show() {
  render(<MemoryRouter><WzDocumentsPage /></MemoryRouter>)
  await screen.findByText('WZ/23/10/26')
}

describe('korekta już wycenionego WZ z kursu', () => {
  it('otwiera aktualne ceny, zachowuje EUR i koryguje 4000 kg do 12600 EUR', async () => {
    await show()
    expect(screen.getByText('Wyceniony')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj ceny' }))
    await screen.findByText(/Edycja cen — WZ\/23/)
    expect(screen.getByLabelText('Cena pozycji 1')).toHaveProperty('value', '3.1')
    expect(screen.getByLabelText('Cena pozycji 2')).toHaveProperty('value', '3.1')
    expect(screen.getByLabelText('EUR')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Kurs EUR')).toHaveProperty('value', '4.39')
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.getByText(/bez zmiany ilości i magazynu/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Jedna cena dla wszystkich'), { target: { value: '3,15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Wstaw do 2 pozycji' }))
    expect(screen.getByText('12600.00 €')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ceny' }))
    await waitFor(() => expect(api.updatePrices).toHaveBeenCalledWith('w23', [
      { index: 0, price: 3.15 }, { index: 1, price: 3.15 },
    ], 'EUR', 4.39))
    await waitFor(() => expect(screen.queryByText(/Edycja cen —/)).toBeNull())
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(api.updateLines).not.toHaveBeenCalled()
    // Przycisk nie znika po ponownym zapisie ceny.
    expect(screen.getByRole('button', { name: 'Edytuj ceny' })).toBeTruthy()
  })

  it('pozwala poprawić jedną pozycję, nie naruszając drugiej', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj ceny' }))
    fireEvent.change(await screen.findByLabelText('Cena pozycji 1'), { target: { value: '3,15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ceny' }))
    await waitFor(() => expect(api.updatePrices).toHaveBeenCalledWith('w23', [
      { index: 0, price: 3.15 }, { index: 1, price: 3.1 },
    ], 'EUR', 4.39))
  })

  it('pierwsza wycena nadal jest dostępna', async () => {
    state.doc.valued = false
    await show()
    expect(screen.getByRole('button', { name: 'Uzupełnij ceny' })).toBeTruthy()
  })

  it('błąd zapisu zachowuje formularz i korektę', async () => {
    api.updatePrices.mockRejectedValueOnce(new Error('Dokument został potwierdzony'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj ceny' }))
    fireEvent.change(await screen.findByLabelText('Cena pozycji 1'), { target: { value: '3,15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ceny' }))
    await screen.findByText('Dokument został potwierdzony')
    expect(screen.getByLabelText('Cena pozycji 1')).toHaveProperty('value', '3,15')
  })

  it.each(['potwierdzony', 'anulowany'])('nie proponuje korekty dokumentu %s', async status => {
    state.doc.status = status
    await showForStatus(status)
    expect(screen.queryByRole('button', { name: 'Edytuj ceny' })).toBeNull()
  })
})

async function showForStatus(status: string) {
  render(<MemoryRouter><WzDocumentsPage /></MemoryRouter>)
  if (status === 'anulowany') {
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Anulowane/ }))
  }
  await screen.findByText('WZ/23/10/26')
}
