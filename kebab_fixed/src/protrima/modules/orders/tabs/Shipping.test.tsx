// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const kursy = vi.hoisted(() => ({ doWydruku: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), zaladunkiApi: kursy }))
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie, type KontekstZamowien } from '../../../data/mapuj'
import { ShippingTab } from './Shipping'

/** Zamówienie w kształcie API (syntetyczne): 2 pozycje, cały wyrób w magazynie; palety wg scenariusza. */
const RAW = { id: 'o1', order_no: 'T/Z/1', client_name: 'T', status: 'confirmed', lines: [
  { id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 20 },
  { id: 'c', qty: 10, kg_per_unit: 25, recipe_id: 'b', recipe_name: 'BEYAZ', product_type_name: 'UDO', qty_stock: 10 },
] }
const palety = (status: string) => [
  { id: 'p1', pallet_no: 1, carton_no: 701, status, items: [{ order_line_id: 'a', qty: 20 }] },
  { id: 'p2', pallet_no: 2, carton_no: 702, status: status === 'loaded' ? 'packed' : status, items: [{ order_line_id: 'c', qty: 10 }] },
]
const WZ = { id: 'wz1', number: 'WZ/7/10/26', status: 'wstepny', issued_date: '2026-10-30', source_type: 'order', source_id: 'o1', vehicle_plate: 'KR1', loaded_at: '2026-10-30T08:40:00+00:00', doc_series: 'WZ' }
const order = (ctx: Partial<KontekstZamowien> = {}) => mapujZamowienie(mapClientOrder(RAW), { clients: [], pallets: {}, wz: [], planByLine: {}, ...ctx })
const app = { issueWz: vi.fn(), splitOrder: vi.fn(), openKurs: vi.fn(), toast: vi.fn() }
const mount = (ctx?: Partial<KontekstZamowien>) => render(<AppCtx.Provider value={app as unknown as AppApi}><ShippingTab order={order(ctx)} /></AppCtx.Provider>)
const kursBtn = () => screen.queryByRole('button', { name: /Papiery kursu/ })
afterEach(cleanup)
beforeEach(() => { Object.values(app).forEach(f => f.mockReset()); kursy.doWydruku.mockReset(); kursy.get.mockReset() })

describe('zakładka Wysyłka', () => {
  it('kurs czeka na papiery (auto zamknięte, WZ brak): Papiery kursu jako jedyny przycisk główny, bez ręcznej drogi', async () => {
    kursy.doWydruku.mockResolvedValue([{ id: 'k9', plate: 'KR1' }])
    kursy.get.mockResolvedValue({ id: 'k9', plate: 'KR1', pozycje: [{ order_id: 'o1' }] })
    const { container } = mount({ pallets: { o1: palety('shipped') as never }, zaladunki: { o1: { plate: 'KR1' } } })
    expect(kursBtn()!.className).toContain('primary')
    expect(container.querySelectorAll('.btn.primary')).toHaveLength(1)
    expect(screen.getByText(/kurs czeka na papiery/)).toBeTruthy()
    // Auto już zeskanowane — „bez skanowania” nie dotyczy; podział wybiera się w papierach kursu.
    expect(screen.queryByRole('button', { name: /Wystaw WZ/ })).toBeNull()
    fireEvent.click(kursBtn()!)
    await waitFor(() => expect(app.openKurs).toHaveBeenCalledWith('k9', 'KR1'))
  })

  it('przed załadunkiem: zwykła droga opisana, bez przycisku kursu; Wystaw WZ drugorzędny z opisem, kiedy', () => {
    const { container } = mount()
    expect(kursBtn()).toBeNull()
    expect(screen.getByText(/Zwykła droga: magazynier skanuje palety na auto/)).toBeTruthy()
    expect(screen.getByText('Towar wyjeżdża bez skanowania załadunku?')).toBeTruthy()
    const wz = screen.getByRole('button', { name: /Wystaw WZ/ })
    expect(wz.className).not.toContain('primary')
    expect(container.querySelectorAll('.btn.primary')).toHaveLength(0)
    fireEvent.click(wz)
    expect(app.issueWz).toHaveBeenCalledWith('o1')
  })

  it('skanowanie w toku (paleta na aucie, kurs otwarty): kurs nie jest główną akcją', () => {
    mount({ pallets: { o1: palety('loaded') as never } })
    expect(screen.getByText(/Trwa załadunek: 1 z 2 palet/)).toBeTruthy()
    expect(kursBtn()!.className).not.toContain('primary')
  })

  it('auto wzięte z wystawionej WZ (papiery zrobione): kurs nie jest główną akcją, widać numer WZ', () => {
    mount({ pallets: { o1: palety('shipped') as never }, wz: [WZ] as never })
    expect(screen.getAllByText(/WZ\/7\/10\/26/).length).toBeGreaterThan(0)
    expect(kursBtn()!.className).not.toContain('primary')
  })
})
