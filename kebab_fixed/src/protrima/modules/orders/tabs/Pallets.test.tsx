// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), orderPalletsApi: api }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'
import { PalletsTab } from './Pallets'

/** Zamówienie w kształcie API (syntetyczne): 2 pozycje, P1 spakowana, P3 rozpisana (numer 2 usunięty dawno temu). */
const RAW = { id: 'o1', order_no: 'T/Z/1', client_name: 'T', status: 'confirmed', lines: [
  { id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO' },
  { id: 'c', qty: 10, kg_per_unit: 25, recipe_id: 'b', recipe_name: 'BEYAZ', product_type_name: 'UDO' },
] }
const FRESH = [
  { id: 'p1', palletNo: 1, cartonNo: '000634', notes: 'x', status: 'packed', items: [{ orderLineId: 'a', qty: 10 }] },
  { id: 'p3', palletNo: 3, cartonNo: '000650', notes: '', status: 'created', items: [{ orderLineId: 'a', qty: 5 }] },
]
const order = () => mapujZamowienie(mapClientOrder(RAW), { clients: [], pallets: { o1: FRESH as never }, wz: [], planByLine: {} })
const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
const mount = () => render(<AppCtx.Provider value={app}><PalletsTab order={order()} /></AppCtx.Provider>)
afterEach(cleanup)
beforeEach(() => { api.list.mockReset().mockResolvedValue(FRESH); api.save.mockReset().mockImplementation((_id, p) => Promise.resolve(p.map((x: { palletNo: number }, i: number) => ({ ...x, palletNo: x.palletNo || 4 + i })))); refresh.mockClear() })

describe('zakładka Palety', () => {
  it('tuleja przy pozycji: ten sam kebab z różnymi tulejami rozróżniony na rozpisce i na karcie palety', () => {
    const RAW2 = { id: 'o2', order_no: 'T/Z/2', client_name: 'T', status: 'confirmed', lines: [
      { id: 'a', qty: 20, kg_per_unit: 15, recipe_id: 'b', recipe_name: 'BEYAZ', product_type_name: 'UDO', packaging_name: 'METAL 65CM' },
      { id: 'c', qty: 20, kg_per_unit: 15, recipe_id: 'b', recipe_name: 'BEYAZ', product_type_name: 'UDO', packaging_name: 'METAL 80CM' },
    ] }
    const P = [{ id: 'p1', palletNo: 1, cartonNo: '000700', notes: '', status: 'created', items: [{ orderLineId: 'a', qty: 20 }, { orderLineId: 'c', qty: 10 }] }]
    const o = mapujZamowienie(mapClientOrder(RAW2), { clients: [], pallets: { o2: P as never }, wz: [], planByLine: {} })
    render(<AppCtx.Provider value={app}><PalletsTab order={o} /></AppCtx.Provider>)
    const strip = screen.getByLabelText('Rozpisanie pozycji na palety')
    expect(within(strip).getByText('METAL 65CM')).toBeTruthy()
    expect(within(strip).getByText('METAL 80CM')).toBeTruthy()
    const karta = screen.getByRole('button', { name: /Paleta 1, karton 000700/ })
    expect(within(karta).getAllByText(/^METAL (65|80)CM$/).map(e => e.textContent)).toEqual(['METAL 65CM', 'METAL 80CM'])
  })

  it('nowa paleta: limit „do rozpisania”, zapis = świeża lista + nowa z numerem 0', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Nowa paleta/ }))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText('5 szt.')).toBeTruthy()   // KIRMIZI: 20 − 10 − 5
    fireEvent.change(within(dlg).getByLabelText('Sztuk z pozycji 1'), { target: { value: '6' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Dodaj paletę' }))
    expect(within(dlg).getByText('Zostało do rozpisania 5 szt.')).toBeTruthy()
    expect(api.save).not.toHaveBeenCalled()
    fireEvent.change(within(dlg).getByLabelText('Sztuk z pozycji 1'), { target: { value: '5' } })
    fireEvent.change(within(dlg).getByLabelText('Sztuk z pozycji 2'), { target: { value: '10' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Dodaj paletę' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.list).toHaveBeenCalledWith('o1')
    const sent = api.save.mock.calls[0][1]
    expect(sent.map((p: { id?: string; palletNo: number }) => [p.id, p.palletNo])).toEqual([['p1', 1], ['p3', 3], [undefined, 0]])
    expect(sent[2].items).toEqual([{ orderLineId: 'a', qty: 5 }, { orderLineId: 'c', qty: 10 }])
    expect(sent[0].notes).toBe('x')
    expect(refresh).toHaveBeenCalled()
  })

  it('paleta spakowana nie ma zmiany ani usunięcia; rozpisana — zmiana zawartości bez zmiany numeru', async () => {
    mount()
    fireEvent.click(screen.getByLabelText(/Paleta 1, karton 000634/))
    expect(screen.queryByRole('button', { name: /Zmień zawartość/ })).toBeNull()
    expect(screen.getByText(/jest w obiegu/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Paleta 3, karton 000650/))
    fireEvent.click(screen.getByRole('button', { name: /Zmień zawartość/ }))
    const dlg = screen.getByRole('dialog')
    const input = within(dlg).getByLabelText('Sztuk z pozycji 1') as HTMLInputElement
    expect(input.value).toBe('5')
    expect(input.closest('tr')!.textContent).toContain('10 szt.')  // 20 − 10 (P1); własne 5 wraca do puli
    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zapisz paletę' }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    const sent = api.save.mock.calls[0][1]
    expect(sent.map((p: { id?: string; palletNo: number }) => [p.id, p.palletNo])).toEqual([['p1', 1], ['p3', 3]])
    expect(sent[1].items).toEqual([{ orderLineId: 'a', qty: 10 }])
  })

  it('usunięcie palety: bez przenumerowania; odmowa serwera jego słowami', async () => {
    api.save.mockRejectedValueOnce(new Error('Paleta P3 jest w obiegu skanowania lub ma historię skanów — nie można jej usunąć ani zmienić zawartości.'))
    mount()
    fireEvent.click(screen.getByLabelText(/Paleta 3, karton 000650/))
    fireEvent.click(screen.getByRole('button', { name: /Usuń paletę/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Usuń paletę' }))
    expect(await screen.findByText(/ma historię skanów/)).toBeTruthy()
    expect(api.save.mock.calls[0][1].map((p: { id: string }) => p.id)).toEqual(['p1'])
  })

  it('rozpis automatyczny: standard sztuk, resztki różnych receptur razem dopiero na końcu; zapis tylko nowych palet (numer 0)', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Rozpisz pozostałe/ }))
    const dlg = screen.getByRole('dialog')
    // wolne: KIRMIZI 40 kg × 5 (std 20 — nie pełna), BEYAZ 25 kg × 10 (std 35 — nie pełna) → razem 450 kg, paleta mieszana
    expect(within(dlg).getByText('mieszana')).toBeTruthy()
    fireEvent.click(within(dlg).getByLabelText(/Resztki różnych receptur/))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Utwórz 2 palety' }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    const nowe = api.save.mock.calls[0][1].slice(2)
    expect(nowe.map((p: { palletNo: number; items: unknown }) => [p.palletNo, p.items])).toEqual([
      [0, [{ orderLineId: 'a', qty: 5 }]], [0, [{ orderLineId: 'c', qty: 10 }]],
    ])
  })
})
