// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'

/** „Gdzie jest kebab” — dane w kształcie API (syntetyczne). */
const units = vi.hoisted(() => ({ locationSummary: vi.fn(), lookup: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), finishedUnitsApi: units }))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => (n === 'POLAT GMBH' ? 'POLAT' : n) }))
import { LokalizacjaPartii, SzukajSztuki } from './LokalizacjaPartii'

afterEach(cleanup)
beforeEach(() => { units.locationSummary.mockReset(); units.lookup.mockReset() })

describe('Lokalizacja partii', () => {
  it('ile sztuk na każdym etapie i w których kartonach', async () => {
    units.locationSummary.mockResolvedValue({ planned: 0, produced: 4, packed: 30, shipped: 6, cartons: ['000709', '000710'] })
    render(<LokalizacjaPartii batchNo="P-12" />)
    const box = await screen.findByLabelText('Lokalizacja sztuk partii P-12')
    expect(units.locationSummary).toHaveBeenCalledWith('P-12')
    expect(within(box).getByText('40 szt. z kodem QR')).toBeTruthy()
    const etap = (t: string) => within(box).getByText(t).closest('.lok-etap')!
    expect(etap('Mroźnia szokowa').textContent).toMatch(/^4szt\./)
    expect(etap('Mroźnia składowa').textContent).toMatch(/^30szt\./)
    expect(etap('W produkcji').className).not.toContain('on')
    expect(within(box).getByText('000710')).toBeTruthy()
  })
  it('partia bez sztuk z kodem — komunikat zamiast pustych zer', async () => {
    units.locationSummary.mockResolvedValue({ planned: 0, produced: 0, packed: 0, shipped: 0, cartons: [] })
    render(<LokalizacjaPartii batchNo="P-1" />)
    expect(await screen.findByText(/nie ma sztuk z kodem QR/)).toBeTruthy()
  })
})

describe('Szukaj sztuki', () => {
  it('kod z etykiety → gdzie jest (jak skaner): karton i składowa; klient po nazwie z kartoteki', async () => {
    units.lookup.mockResolvedValue({ id: 'u1', qrCode: 'KB|P-12|0007', status: 'packed', clientName: 'POLAT GMBH', productTypeId: 'pt', productTypeName: 'KEBAB UDO 100%', recipeId: 'r1', recipeName: 'BEYAZ',
      tuleja: 'METAL 65CM', weightKg: 10, batchNo: 'P-12', trolleyId: null, cartonId: 'k1', cartonNo: '000709', producedAt: '2026-10-29T10:00:00Z' })
    render(<SzukajSztuki />)
    fireEvent.change(screen.getByLabelText('Kod QR sztuki'), { target: { value: ' KB|P-12|0007 ' } })
    fireEvent.click(screen.getByRole('button', { name: /Znajdź/ }))
    expect(await screen.findByText('Karton 000709 · Mroźnia składowa')).toBeTruthy()
    expect(units.lookup).toHaveBeenCalledWith('KB|P-12|0007')
    expect(screen.getByText('POLAT')).toBeTruthy()
    expect(screen.getByText('KEBAB UDO 100% · BEYAZ')).toBeTruthy()
  })
  it('nieznany kod — „nie znaleziono” słowami', async () => {
    units.lookup.mockRejectedValue(new Error('404 Not Found'))
    render(<SzukajSztuki />)
    fireEvent.change(screen.getByLabelText('Kod QR sztuki'), { target: { value: 'XYZ' } })
    fireEvent.submit(screen.getByLabelText('Kod QR sztuki').closest('form')!)
    expect(await screen.findByText('Nie znaleziono sztuki o tym kodzie.')).toBeTruthy()
    await waitFor(() => expect(units.lookup).toHaveBeenCalledTimes(1))
  })
})
