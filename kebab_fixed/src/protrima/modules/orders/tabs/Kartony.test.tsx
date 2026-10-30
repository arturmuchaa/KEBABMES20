// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const api = vi.hoisted(() => ({ stockCartonOptions: vi.fn(), assignStockCarton: vi.fn(), detachStockCarton: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), clientOrdersApi: api }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { mapStockCartonOptions, mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'
import { KartonyZMagazynu } from './Kartony'

const karton = (id: string, no: number, extra: Record<string, unknown> = {}) => ({ carton_id: id, carton_no: no, client_name: 'ISSA', status: 'packed', packed_qty: 20, target_qty: 20, units: 20,
  lines: [{ recipe_name: 'BEYAZ', product_type_name: 'UDO', packaging_name: 'METAL 65CM', kg_per_unit: 20, packed_qty: 20, target_qty: 20 }], ...extra })
const RAW = (extra: Record<string, unknown> = {}) => mapStockCartonOptions({ order_id: 'o1', order_no: 'ISSA/Z/1', order_status: 'confirmed', assign_blocked_reason: null,
  available: [karton('k1', 700)], assigned: [karton('k2', 650, { can_detach: true }), karton('k3', 651, { can_detach: false, detach_blocked_reason: 'Karton na aucie' })],
  unavailable: [karton('k4', 702, { reason: 'Inny klient (POLAT)' })], assigned_totals: { cartons: 2, units: 40 }, ...extra })
const order = (status = 'confirmed') => mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'ISSA/Z/1', client_name: 'ISSA', status, lines: [] }), { clients: [], pallets: {}, wz: [], planByLine: {} })
const app = { toast: vi.fn() } as unknown as AppApi
const mount = (status?: string) => render(<AppCtx.Provider value={app}><KartonyZMagazynu order={order(status)} /></AppCtx.Provider>)
afterEach(cleanup)
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); api.stockCartonOptions.mockResolvedValue(RAW()); api.assignStockCarton.mockResolvedValue({}); api.detachStockCarton.mockResolvedValue({}); refresh.mockClear() })

describe('Kartony z magazynu', () => {
  it('przypisanie dostępnego kartonu: endpoint, odświeżenie przeglądu i listy zamówień', async () => {
    mount()
    const row = (await screen.findByText('000700')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /Przypisz/ }))
    await waitFor(() => expect(api.assignStockCarton).toHaveBeenCalledWith('o1', 'k1'))
    await waitFor(() => expect(api.stockCartonOptions).toHaveBeenCalledTimes(2))
    expect(refresh).toHaveBeenCalled()
  })
  it('odłączenie tylko z potwierdzeniem i tylko gdy serwer pozwala', async () => {
    mount()
    const r3 = (await screen.findByText('000651')).closest('tr')!
    expect(within(r3).queryByRole('button', { name: /Odłącz/ })).toBeNull()
    fireEvent.click(within(screen.getByText('000650').closest('tr')!).getByRole('button', { name: /Odłącz/ }))
    expect(api.detachStockCarton).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Odłącz karton' }))
    await waitFor(() => expect(api.detachStockCarton).toHaveBeenCalledWith('o1', 'k2'))
  })
  it('niedostępne z powodem; odmowa serwera jego słowami', async () => {
    api.assignStockCarton.mockRejectedValue(new Error('Karton ma inną recepturę niż pozycje zamówienia'))
    mount()
    expect(await screen.findByText(/Inny klient \(POLAT\)/)).toBeTruthy()
    fireEvent.click(within(screen.getByText('000700').closest('tr')!).getByRole('button', { name: /Przypisz/ }))
    expect(await screen.findByText(/inną recepturę/)).toBeTruthy()
  })
  it('zamówienie zamknięte: tylko podgląd przypisanych, bez akcji', async () => {
    api.stockCartonOptions.mockResolvedValue(RAW({ order_status: 'done' }))
    mount('done')
    expect(await screen.findByText(/zrealizowane — kartonów nie przypisuje/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Przypisz|Odłącz/ })).toBeNull()
  })
})
