// @vitest-environment jsdom
/**
 * Biuro: wydanie sztuk z kiosku → Wystaw WZ → HDI / CMR (30.09.2026).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({ zamkniete: [] as string[], hdi: [] as string[] }))
const W = { id: 'd1', status: 'ready', clientId: 'k1', clientName: 'KEBAP HAUS', pickup: 'klient', vehicleId: '',
  operator: 'Ola', notes: 'odbiór przez klienta', createdAt: '', handedAt: '', qty: 3, kg: 150,
  units: [1, 2, 3].map(i => ({ id: `u${i}`, kg: 50, batchNo: '', recipeName: 'KIRMIZI', productTypeName: '', fromCartonNo: '', fromClient: '' })) }

vi.mock('@/lib/api', () => ({
  magazynApi: { wydanieSztukDoWystawienia: () => Promise.resolve(s.zamkniete.length ? [] : [W]) },
  dispatchesApi: { close: (id: string) => { s.zamkniete.push(id); return Promise.resolve({ wzId: 'wz1', wzNumber: 'WZ/12/09/26' }) } },
  hdiApi: { generateFromWz: (id: string) => { s.hdi.push(id); return Promise.resolve({ id: 'h1' }) } },
  cmrApi: {}, carriersApi: { list: () => Promise.resolve([]) },
}))

import { WydaniaSztukCard } from './WydaniaSztukCard'

afterEach(cleanup)

describe('karta „Wydania sztuk z magazynu"', () => {
  it('pokazuje skład, wystawia WZ, potem HDI z tego WZ', async () => {
    const otwarte: string[] = []
    const odswiez = vi.fn()
    render(<WydaniaSztukCard otworz={u => otwarte.push(u)} onWystawiono={odswiez} />)
    expect((await screen.findByText('KEBAP HAUS'))).toBeTruthy()
    expect(screen.getByTestId('wydania-sztuk').textContent).toContain('3 × 50 kg KIRMIZI')
    fireEvent.click(screen.getByRole('button', { name: 'Wystaw WZ' }))
    await screen.findByText('✓ WZ/12/09/26')
    expect(s.zamkniete).toEqual(['d1'])
    expect(odswiez).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Wystaw HDI' }))
    await waitFor(() => expect(otwarte).toContain('/office/hdi/h1/druk'))
    expect(s.hdi).toEqual(['wz1'])
    expect(screen.getByRole('button', { name: 'Drukuj HDI' })).toBeTruthy()
  })
})
