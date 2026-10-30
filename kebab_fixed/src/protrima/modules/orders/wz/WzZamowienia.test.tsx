// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const wz = vi.hoisted(() => ({ fromOrderPicks: vi.fn(), nextNumber: vi.fn(), createManual: vi.fn(), stockFg: vi.fn(), pdfUrl: (id: string) => `/api/wz/${id}/pdf` }))
const clients = vi.hoisted(() => ({ list: vi.fn() }))
const pdf = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), wzApi: wz, clientsApi: clients, downloadDocPdf: pdf, fxApi: { eurRate: vi.fn() } }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { WzZamowienia } from './WzZamowienia'

const PICKS = { order_id: 'o1', order_no: 'NYSA/Z/1/10/26', client_id: 'c1', ordered: 25,
  buyer: { name: 'BUBU KEBAB S.C.', address: 'NIEZAPOMINAJEK 12', nip: '7532482090' },
  picks: [{ stock_id: 'f1', qty: 20, batch_no: '291026 669', name: 'KEBAB UDO BEYAZ HALAL 20kg', product_type_name: 'KEBAB UDO', recipe_name: 'BEYAZ HALAL', kg_per_unit: 20, qty_available: 20 }] }
let cmds: Array<{ id: string; run?: () => void }> = []
const app = { toast: vi.fn() } as unknown as AppApi
const mount = () => { const onDone = vi.fn(); render(<AppCtx.Provider value={app}><WzZamowienia orderId="o1" active setCmds={c => { cmds = c }} onDone={onDone} /></AppCtx.Provider>); return onDone }
const run = (id: string) => cmds.find(c => c.id === id)!.run!()
afterEach(cleanup)
beforeEach(() => { Object.values(wz).forEach(f => typeof f === 'function' && 'mockReset' in f && (f as ReturnType<typeof vi.fn>).mockReset()); wz.fromOrderPicks.mockResolvedValue(PICKS); wz.nextNumber.mockResolvedValue({ number: 'WZ/7/10/26' }); pdf.mockClear(); refresh.mockClear() })

describe('WZ z zamówienia', () => {
  it('pozycje z serwera; brak 5 szt. do pełnego zamówienia; ilość ponad stan blokuje zapis', async () => {
    mount()
    const q = await screen.findByLabelText(/Ilość do wydania, KEBAB UDO BEYAZ HALAL 20kg/) as HTMLInputElement
    expect(q.value).toBe('20')
    expect(screen.getByText(/brakuje/i).textContent).toContain('5 szt.')
    fireEvent.change(q, { target: { value: '21' } })
    run('issue')
    expect(await screen.findByText(/przekracza stan magazynowy/)).toBeTruthy()
    expect(wz.createManual).not.toHaveBeenCalled()
  })
  it('wystawienie: DTO z orderId i stock_id, ekran sukcesu z numerem i PDF', async () => {
    wz.createManual.mockResolvedValue({ id: 'w9', number: 'WZ/7/10/26', buyer_name: 'BUBU KEBAB S.C.', valued: false, status: 'wstepny', lines: [], total_value: 0 })
    const onDone = mount()
    const q = await screen.findByLabelText(/Ilość do wydania/) as HTMLInputElement
    fireEvent.change(q, { target: { value: '15' } })
    run('issue')
    await waitFor(() => expect(wz.createManual).toHaveBeenCalledTimes(1))
    const dto = wz.createManual.mock.calls[0][0]
    expect(dto).toMatchObject({ orderId: 'o1', valued: false, containersTotal: null, buyer: { name: 'BUBU KEBAB S.C.', nip: '7532482090' } })
    expect(dto.items).toEqual([expect.objectContaining({ stockType: 'fg', stockId: 'f1', qty: 15, batchNo: '291026 669', kgPerUnit: 20 })])
    expect(await screen.findByText('Wystawiono WZ/7/10/26')).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
    const karta = within(document.querySelector('.ph-card') as HTMLElement)
    fireEvent.click(karta.getByRole('button', { name: /Otwórz PDF/ }))
    await waitFor(() => expect(pdf).toHaveBeenCalledWith('/api/wz/w9/pdf', 'WZ-7-10-26.pdf'))
    fireEvent.click(karta.getByRole('button', { name: 'Zamknij' }))
    expect(onDone).toHaveBeenCalled()
  })
  it('karta Ceny: jedna cena za kg dla wszystkich pozycji, wartość za kilogram jak na serwerze, ręczna poprawka wiersza', async () => {
    wz.fromOrderPicks.mockResolvedValue({ ...PICKS, picks: [...PICKS.picks, { stock_id: 'f2', qty: 10, batch_no: '291026 670', name: 'KEBAB UDO BEYAZ HALAL 10kg', product_type_name: 'KEBAB UDO', recipe_name: 'BEYAZ HALAL', kg_per_unit: 10, qty_available: 10 }] })
    wz.createManual.mockResolvedValue({ id: 'w9', number: 'WZ/7/10/26', buyer_name: 'BUBU KEBAB S.C.', valued: true, status: 'wstepny', lines: [], total_value: 6250 })
    mount()
    await screen.findByLabelText(/Ilość do wydania, KEBAB UDO BEYAZ HALAL 20kg/)
    fireEvent.click(screen.getByLabelText('Dokument wartościowy'))
    const wsz = screen.getByLabelText('Cena za kg dla wszystkich pozycji') as HTMLInputElement
    fireEvent.change(wsz, { target: { value: '12,50' } })
    expect((screen.getByLabelText('Cena za kg, KEBAB UDO BEYAZ HALAL 20kg') as HTMLInputElement).value).toBe('12,50')
    expect((screen.getByLabelText('Cena za kg, KEBAB UDO BEYAZ HALAL 10kg') as HTMLInputElement).value).toBe('12,50')
    // 20 szt × 20 kg × 12,50 = 5000 zł; 10 × 10 × 12,50 = 1250 zł (nie 20 × 12,50).
    expect(screen.getAllByText(/^5\s?000,00\s?zł$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^6\s?250,00\s?zł$/).length).toBeGreaterThan(0)
    expect(screen.getByText('wszystkie pozycje mają cenę')).toBeTruthy()
    // Jeden wiersz poprawiony ręcznie → pole „wszystkie” pokazuje różne ceny.
    fireEvent.change(screen.getByLabelText('Cena za kg, KEBAB UDO BEYAZ HALAL 10kg'), { target: { value: '13' } })
    expect(wsz.value).toBe('')
    expect(wsz.placeholder).toBe('różne ceny')
    run('issue')
    await waitFor(() => expect(wz.createManual).toHaveBeenCalledTimes(1))
    expect(wz.createManual.mock.calls[0][0].items.map((i: { price: number }) => i.price)).toEqual([12.5, 13])
  })
  it('odmowa serwera — jego słowami, formularz zostaje', async () => {
    wz.createManual.mockRejectedValue(new Error('Partia 291026 669: na stanie 18 szt.'))
    mount()
    await screen.findByLabelText(/Ilość do wydania/)
    run('issue')
    expect(await screen.findByText(/na stanie 18 szt/)).toBeTruthy()
    expect(screen.getByLabelText(/Ilość do wydania/)).toBeTruthy()
  })
})

describe('WZ z magazynu (zaznaczone w Wyrobie gotowym)', () => {
  const FG = [
    { id: 'g1', batch_no: '291026 659', qty_available: 12, kg_per_unit: 20, name: 'KEBAB YAPRAK 20kg', product_type_name: 'KEBAB YAPRAK', recipe_name: 'YAPRAK', client_name: 'DEM`S', client_order_no: 'DEM-S/Z/4/10/26' },
    { id: 'g2', batch_no: '291026 660', qty_available: 5, kg_per_unit: 20, name: 'KEBAB YAPRAK 20kg', product_type_name: 'KEBAB YAPRAK', recipe_name: 'YAPRAK', client_name: 'DEM`S', client_order_no: 'DEM-S/Z/4/10/26' },
  ]
  beforeEach(() => {
    clients.list.mockReset()
    clients.list.mockResolvedValue([{ id: 'c1', name: 'DEM`S GMBH', displayName: 'DEM`S', address: 'Hauptstr. 1', city: 'Wien', nip: 'ATU12345678' }, { id: 'c2', name: 'BUBU KEBAB S.C.', city: 'Nysa', nip: '7532482090' }])
    wz.stockFg.mockImplementation((id = '') => Promise.resolve(id === 'c1' ? FG.map(g => ({ ...g, name: 'DÖNER YAPRAK 20kg' })) : FG))
  })
  const mountMag = () => { const onDone = vi.fn(); render(<AppCtx.Provider value={app}><WzZamowienia wybor={[{ id: 'g2', qty: 5 }, { id: 'g1', qty: 12 }]} active setCmds={c => { cmds = c }} onDone={onDone} /></AppCtx.Provider>); return onDone }

  it('odbiorca podpowiedziany z zaznaczenia, nazwy wg jego kartoteki, zapis BEZ zamówienia', async () => {
    wz.createManual.mockResolvedValue({ id: 'w9', number: 'WZ/66/10/26', buyer_name: 'DEM`S GMBH', valued: false, status: 'wstepny', lines: [], total_value: 0 })
    mountMag()
    expect(await screen.findByText('WZ z magazynu')).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('Odbiorca z kartoteki') as HTMLSelectElement).value).toBe('c1'))
    expect((screen.getByLabelText('Nazwa odbiorcy') as HTMLInputElement).value).toBe('DEM`S GMBH')
    await screen.findAllByText('DÖNER YAPRAK 20kg')
    run('issue')
    await waitFor(() => expect(wz.createManual).toHaveBeenCalledTimes(1))
    const dto = wz.createManual.mock.calls[0][0]
    expect(dto.orderId).toBeUndefined()
    expect(dto.buyer).toEqual({ name: 'DEM`S GMBH', address: 'Hauptstr. 1 Wien', nip: 'ATU12345678' })
    expect(dto.items.map((i: { stockId: string; qty: number; name: string }) => [i.stockId, i.qty, i.name])).toEqual([['g2', 5, 'DÖNER YAPRAK 20kg'], ['g1', 12, 'DÖNER YAPRAK 20kg']])
  })

  it('inny odbiorca niż stempel → pytanie o cudzą rezerwację przed wystawieniem', async () => {
    mountMag()
    await waitFor(() => expect((screen.getByLabelText('Odbiorca z kartoteki') as HTMLSelectElement).value).toBe('c1'))
    fireEvent.change(screen.getByLabelText('Odbiorca z kartoteki'), { target: { value: 'c2' } })
    expect((screen.getByLabelText('Nazwa odbiorcy') as HTMLInputElement).value).toBe('BUBU KEBAB S.C.')
    run('issue')
    expect(await screen.findByText('Wydajesz towar zarezerwowany pod inne zamówienia')).toBeTruthy()
    expect(wz.createManual).not.toHaveBeenCalled()
  })
})
