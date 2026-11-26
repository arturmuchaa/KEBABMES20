// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import { mapujZamowienie } from '../../../data/mapuj'
import { mapClientOrder, type PrzeniesienieOpcje } from '@/lib/api'

/**
 * Zamówienia z biura (26.11.2026): wyjazd kartonem, przeniesienie sztuk do
 * innego klienta, zakończenie kursu niezamkniętego na HMI. Dane syntetyczne
 * w kształcie odpowiedzi serwera (biuro_zamowienia_service).
 */
const biuro = vi.hoisted(() => ({
  kursyOtwarte: vi.fn(), zakonczKurs: vi.fn(), kartonyDoWyjazdu: vi.fn(), wyjazd: vi.fn(),
  przeniesienieOpcje: vi.fn(), przenies: vi.fn(), usunKartonMagazynowy: vi.fn(),
}))
const pojazdy = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), biuroApi: biuro, vehiclesApi: pojazdy }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { PrzeniesSztukiDialog, podpowiedzCelu } from './PrzeniesSztuki'
import { WyjazdZBiuraDialog } from './WyjazdZBiura'
import { KursyNiezakonczone } from '../../wysylki/KursyNiezakonczone'

afterEach(() => { cleanup(); vi.clearAllMocks() })
const app = { toast: vi.fn() } as unknown as AppApi
const wrap = (el: React.ReactElement) => render(<AppCtx.Provider value={app}>{el}</AppCtx.Provider>)

const POZ = (o: Partial<PrzeniesienieOpcje['items'][number]>) => ({
  lineId: 'a10', recipeId: 'r1', recipeName: 'KIRMIZI', productTypeId: 'udo', productTypeName: 'KEBAB UDO 100%',
  packagingId: 'm65', packagingName: 'METAL 65CM', kgPerUnit: 10, qty: 31, ...o })
const OPCJE: PrzeniesienieOpcje = {
  palletId: 'p3', palletNo: 3, cartonNo: '000931', status: 'cold_storage', orderId: 'ali', orderNo: 'NIEMCY-PROBA/Z/1/11/26', clientName: 'ALI GOLD KEBAB',
  items: [POZ({}), POZ({ lineId: 'a15', kgPerUnit: 15, qty: 10 })],
  orders: [{ orderId: 'kevn', orderNo: 'KEVN-GMBH/Z/1/11/26', clientName: 'KEVN GMBH', delivery: '2026-11-24',
    lines: [{ ...POZ({ lineId: 'k10', packagingId: 'm50', packagingName: 'METAL 50CM', qty: 10 }), free: 10 },
            { ...POZ({ lineId: 'k15', kgPerUnit: 15, qty: 5 }), free: 5 }] }],
}

describe('przeniesienie sztuk do innego zamówienia', () => {
  beforeEach(() => { biuro.przeniesienieOpcje.mockResolvedValue(OPCJE) })

  it('podpowiada pozycję tej samej tulei, potem innej tulei, inaczej nową', () => {
    const kevn = OPCJE.orders[0]
    expect(podpowiedzCelu(OPCJE.items[1], kevn)).toBe('k15')
    expect(podpowiedzCelu(OPCJE.items[0], kevn)).toBe('k10')          // inna tuleja — trzeba zaznaczyć zmianę
    expect(podpowiedzCelu(POZ({ kgPerUnit: 18 }), kevn)).toBe('')       // nowa pozycja
  })

  it('jak ALI GOLD → KEVN: wybór zamówienia, ilości, tulei i decyzji o źródle', async () => {
    biuro.przenies.mockResolvedValue({ ok: true, targetOrderNo: 'KEVN-GMBH/Z/1/11/26', palletNo: 3, cartonNo: '000960', sourceCartonNo: '000931', sourceWithdrawnFromColdStorage: true })
    const onClose = vi.fn()
    wrap(<PrzeniesSztukiDialog palletId="p3" onClose={onClose} />)
    expect(await screen.findByText(/sam z niej wyjedzie/)).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /KEVN GMBH/ }))
    fireEvent.change(screen.getByLabelText(/Przenieś sztuk: .*10 kg/), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText(/Przenieś sztuk: .*15 kg/), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś sztuki' }))
    // Inna tuleja i brak decyzji — nic nie poszło do serwera.
    expect(await screen.findByText(/Inna tuleja/)).toBeTruthy()
    expect(screen.getByText('Wybierz, co z zamówieniem źródłowym.')).toBeTruthy()
    expect(biuro.przenies).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(/zmień tuleję w tej pozycji na METAL 65CM/))
    fireEvent.click(screen.getByRole('radio', { name: /dorobimy/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś sztuki' }))
    await waitFor(() => expect(biuro.przenies).toHaveBeenCalledWith('p3', {
      targetOrderId: 'kevn', zrodlo: 'dorob',
      items: [{ lineId: 'a10', qty: 10, targetLineId: 'k10', changePackaging: true },
              { lineId: 'a15', qty: 5, targetLineId: 'k15', changePackaging: false }],
    }))
    expect(refresh).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('więcej niż w kartonie albo ponad wolne w pozycji — odmowa przed zapisem', async () => {
    wrap(<PrzeniesSztukiDialog palletId="p3" onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('option', { name: /KEVN GMBH/ }))
    fireEvent.change(screen.getByLabelText(/Przenieś sztuk: .*15 kg/), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('radio', { name: /Zmniejsz/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Przenieś sztuki' }))
    expect(await screen.findByText(/wolne 5 szt/)).toBeTruthy()
    expect(biuro.przenies).not.toHaveBeenCalled()
  })
})

describe('wyjazd kartonem z biura', () => {
  const order = mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'GOLD-KEBAB/Z/5/11/26', client_name: 'GOLD KEBAB', status: 'confirmed', lines: [] }), { clients: [], pallets: {}, wz: [], planByLine: {} })
  beforeEach(() => {
    pojazdy.list.mockResolvedValue([{ id: 'v1', name: 'Bus', plate: 'KOL47267', active: true }, { id: 'v2', name: 'Stare', plate: '', active: false }])
    biuro.kartonyDoWyjazdu.mockResolvedValue([
      { id: 'p2', kind: 'order', palletNo: 2, cartonNo: '000943', status: 'cold_storage', vehicleId: null, szt: 8, kg: 240 },
      { id: 's1', kind: 'stock', palletNo: null, cartonNo: '000835', status: 'packed', vehicleId: null, szt: 80, kg: 800 },
    ])
  })

  it('auto obowiązkowe, częściowe wydanie potwierdzane tokenem z serwera', async () => {
    const odmowa = Object.assign(new Error('Wydanie częściowe'), { code: 'PARTIAL_LOADING_CONFIRMATION_REQUIRED', detail: {
      code: 'PARTIAL_LOADING_CONFIRMATION_REQUIRED', confirmation_token: 'tok1',
      orders: [{ order_id: 'o1', order_no: 'GOLD-KEBAB/Z/5/11/26', client_name: 'GOLD KEBAB',
        coverage: { complete: false, extra_qty: 0, missing: [{ order_line_id: 'l1', name: 'KIYMA 40 kg', kg_per_unit: 40, ordered_qty: 5, missing_qty: 2, missing_kg: 80 }] } }] } })
    biuro.wyjazd.mockRejectedValueOnce(odmowa).mockResolvedValueOnce({ ok: true, plate: 'KOL47267', orders: [{ order_id: 'o1', order_no: 'GOLD-KEBAB/Z/5/11/26', client_name: 'GOLD KEBAB', pallets: 2, hdi_number: '48/11/26' }] })
    wrap(<WyjazdZBiuraDialog order={order} onClose={vi.fn()} />)
    expect(await screen.findByText('000943')).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Stare/ })).toBeNull()      // nieaktywne auto niedostępne
    const go = screen.getByRole('button', { name: 'Załaduj i zakończ kurs' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Auto'), { target: { value: 'v1' } })
    fireEvent.click(go)
    await waitFor(() => expect(biuro.wyjazd).toHaveBeenCalledWith('o1', 'v1', ['p2', 's1'], undefined))
    expect(await screen.findByText(/brakuje/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź wydanie częściowe' }))
    await waitFor(() => expect(biuro.wyjazd).toHaveBeenLastCalledWith('o1', 'v1', ['p2', 's1'], 'tok1'))
    expect(await screen.findByText(/HDI 48\/11\/26/)).toBeTruthy()
  })

  it('odmowa serwera jego słowami', async () => {
    biuro.wyjazd.mockRejectedValue(new Error('GOLD-KEBAB/Z/5/11/26: brakuje na stanie — KIYMA 40 kg: 5 szt'))
    wrap(<WyjazdZBiuraDialog order={order} onClose={vi.fn()} />)
    await screen.findByText('000943')
    fireEvent.change(screen.getByLabelText('Auto'), { target: { value: 'v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Załaduj i zakończ kurs' }))
    expect(await screen.findByText(/brakuje na stanie/)).toBeTruthy()
  })
})

describe('kursy niezakończone na pulpicie', () => {
  it('pokazuje auto z towarem i kończy kurs po potwierdzeniu', async () => {
    biuro.kursyOtwarte.mockResolvedValueOnce([{ vehicleId: 'v1', name: 'Bus', plate: 'KOL47267', loadedSince: '2026-11-24T10:31:00Z',
      orders: [{ orderId: 'o1', orderNo: 'GOLD-KEBAB/Z/5/11/26', clientName: 'GOLD KEBAB', orderStatus: 'confirmed', cartons: ['000943'], szt: 8, kg: 240 },
               { orderId: 'o2', orderNo: 'KEVN-GMBH/Z/1/11/26', clientName: 'KEVN GMBH', orderStatus: 'confirmed', cartons: ['000942'], szt: 25, kg: 900 }] }]).mockResolvedValue([])
    biuro.zakonczKurs.mockResolvedValue({ ok: true, plate: 'KOL47267', orders: [{ order_id: 'o1', order_no: 'GOLD-KEBAB/Z/5/11/26', client_name: 'GOLD KEBAB', pallets: 1, wz_number: 'WM/44/11/26' }] })
    wrap(<KursyNiezakonczone />)
    expect(await screen.findByText(/GOLD KEBAB, KEVN GMBH/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Zakończ kurs/ }))
    const dlg = await screen.findByRole('dialog')
    expect(biuro.zakonczKurs).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zakończ kurs' }))
    await waitFor(() => expect(biuro.zakonczKurs).toHaveBeenCalledWith('v1', undefined))
    expect(await screen.findByText(/WM\/44\/11\/26 potwierdzony/)).toBeTruthy()
  })

  it('bez niezakończonych kursów nic nie pokazuje', async () => {
    biuro.kursyOtwarte.mockResolvedValue([])
    const { container } = wrap(<KursyNiezakonczone />)
    await waitFor(() => expect(biuro.kursyOtwarte).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
