// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import type { Order, Pallet } from '../../../data/model'

/**
 * Przeniesienie CAŁYCH palet do innego zamówienia (właściciel 27.11.2026:
 * YALCIN Z/7 — 21 palet, 16 na niedzielę, 5 na poniedziałek).
 */
const biuro = vi.hoisted(() => ({ przeniesPalety: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), biuroApi: biuro }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { PrzeniesPaletyDialog } from './PrzeniesPalety'

afterEach(() => { cleanup(); vi.clearAllMocks() })
const app = { toast: vi.fn(), openOrder: vi.fn() } as unknown as AppApi
const wrap = (el: React.ReactElement) => render(<AppCtx.Provider value={app}>{el}</AppCtx.Provider>)

const pal = (no: number, qty: number, status: Pallet['status'] = 'cold'): Pallet =>
  ({ id: `p${no}`, no, carton: String(940 + no), status, items: [{ lineId: 'l1', qty }], readyQty: qty } as Pallet)
const zam = (id: string, no: string, clientId = 'yal', delivery = new Date(2026, 10, 30)): Order => ({
  id, no, client: { id: clientId, name: clientId === 'yal' ? 'YALCIN' : 'ZAGROS' }, delivery, status: 'confirmed',
  lines: [{ id: 'l1', lp: 1, qty: 400, kgPerUnit: 40, recipe: 'KIRMIZI', product: 'KEBAB UDO 100%' }],
  pallets: [], retiredPalletNos: [], history: [], docs: [],
} as unknown as Order)

const Z7 = { ...zam('z7', 'YALCIN/Z/7/11/26'), pallets: [pal(1, 20), pal(17, 60, 'created'), pal(18, 35, 'created'), pal(20, 12)] }
const PON = zam('z9', 'YALCIN/Z/9/11/26', 'yal', new Date(2026, 11, 1))
const OBCY = zam('zg', 'ZAGROS/Z/3/11/26', 'zag')

describe('przeniesienie palet do innego zamówienia', () => {
  it('domyślnie nowe zamówienie z datą wyjazdu; suma palet i sztuk; stare kartki działają', async () => {
    biuro.przeniesPalety.mockResolvedValue({ ok: true, targetOrderId: 'z8', targetOrderNo: 'YALCIN/Z/8/11/26', created: true, units: 107, pallets: [] })
    const onClose = vi.fn()
    wrap(<PrzeniesPaletyDialog order={Z7} pallets={[Z7.pallets[1], Z7.pallets[2], Z7.pallets[3]]} inne={[PON, OBCY]} onClose={onClose} />)
    expect(screen.getByText(/3 palety · 107 szt\. · 4\s?280 kg/)).toBeTruthy()
    expect(screen.getByText(/kartki palet zostają/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Data wyjazdu nowego zamówienia'), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś 3 palety' }))
    await waitFor(() => expect(biuro.przeniesPalety).toHaveBeenCalledWith('z7', { palletIds: ['p17', 'p18', 'p20'], newDeliveryDate: '2026-12-01' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('YALCIN/Z/8/11/26') }))
  })

  it('istniejące zamówienie — tylko otwarte zamówienia tego samego klienta', async () => {
    biuro.przeniesPalety.mockResolvedValue({ ok: true, targetOrderId: 'z9', targetOrderNo: 'YALCIN/Z/9/11/26', created: false, units: 60, pallets: [] })
    wrap(<PrzeniesPaletyDialog order={Z7} pallets={[Z7.pallets[1]]} inne={[PON, OBCY]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /Istniejące zamówienie/ }))
    expect(screen.queryByRole('option', { name: /ZAGROS/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /YALCIN\/Z\/9\/11\/26/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś 1 paletę' }))
    await waitFor(() => expect(biuro.przeniesPalety).toHaveBeenCalledWith('z7', { palletIds: ['p17'], targetOrderId: 'z9' }))
  })

  it('bez daty nic nie idzie do serwera; odmowa serwera jego słowami', async () => {
    biuro.przeniesPalety.mockRejectedValue(new Error('Palety P1 są na aucie albo wydane — najpierw cofnij ich skan'))
    wrap(<PrzeniesPaletyDialog order={Z7} pallets={[Z7.pallets[0]]} inne={[]} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Data wyjazdu nowego zamówienia'), { target: { value: '' } })
    expect((screen.getByRole('button', { name: 'Przenieś 1 paletę' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Data wyjazdu nowego zamówienia'), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś 1 paletę' }))
    expect(await screen.findByText(/na aucie albo wydane/)).toBeTruthy()
  })
})
