// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

/** Niezmienniki przeniesione z features/orders/split/splitDialog.test.tsx (stary MES). */
const api = vi.hoisted(() => ({ saved: vi.fn(), preview: vi.fn(), save: vi.fn(), documents: vi.fn(), cancelDocuments: vi.fn() }))
const zal = vi.hoisted(() => ({ stan: { totals: { totalPallets: 2, loadedPallets: 0 } } as any }))
vi.mock('@/lib/api', () => ({
  errStatus: (e: any) => e?.status ?? 0,
  orderSplitApi: api,
  palletScanApi: { loadingStatus: () => Promise.resolve(zal.stan) },
  carriersApi: { list: () => Promise.resolve([{ id: 'p1', name: 'TRANS-KOWALSKI', city: 'Kraków', defaultPlate: 'KR 12345' }]) },
  downloadDocPdf: vi.fn(), wzApi: { pdfUrl: () => '' }, hdiApi: { pdfUrl: () => '' }, cmrApi: { pdfUrl: () => '' },
}))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { PodzialWysylki } from './PodzialWysylki'

const ODP = { kg_calosc: 13005, kg_fv: 7995, kg_wz: 5010, odchylka: -5, trafiono: true,
  lines: [{ id: 'l1', recipe_name: 'KIRMIZI', kg_per_unit: 50, qty: 15, qty_invoice: 9, qty_wz: 6 }, { id: 'l2', recipe_name: 'BEYAZ AFIYET', kg_per_unit: 40, qty: 40, qty_invoice: 25, qty_wz: 15 }] }
const BRAK = { istnieje: false, kompletny: false, cel_kg: null, lines: [], kg_calosc: 13005, kg_fv: 0, kg_wz: 0, trafiono: null, odchylka: null }
const ZAPISANY = { istnieje: true, kompletny: true, cel_kg: 400, kg_calosc: 800, kg_fv: 490, kg_wz: 310, trafiono: false, odchylka: 90,
  lines: [{ id: 'l1', recipe_name: 'KIRMIZI', kg_per_unit: 30, qty: 10, qty_invoice: 8, qty_wz: 2 }, { id: 'l2', recipe_name: 'BEYAZ AFIYET', kg_per_unit: 25, qty: 20, qty_invoice: 10, qty_wz: 10 }] }
const jak = (cel: number, lines = ODP.lines) => ({ istnieje: true, kompletny: true, cel_kg: cel, kg_calosc: 13005, kg_fv: 7995, kg_wz: 5010, trafiono: true, odchylka: 0, lines })

const app = { toast: vi.fn() } as unknown as AppApi
const mount = () => render(<AppCtx.Provider value={app}><PodzialWysylki orderId="o1" orderNo="T/Z/1" clientName="T" kgCalosc={13005} active setCmds={() => {}} onDone={() => {}} /></AppCtx.Provider>)
const wystawBtn = () => screen.getAllByRole('button', { name: /Wystaw komplet dokumentów/ }).at(-1) as HTMLButtonElement
const zapiszBtn = () => screen.getAllByRole('button', { name: /Zapisz podział/ }).at(-1) as HTMLButtonElement
const cel = (v: string) => fireEvent.change(screen.getByLabelText('Na fakturę kg'), { target: { value: v } })
afterEach(cleanup)
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); api.saved.mockResolvedValue(BRAK); api.preview.mockResolvedValue(ODP); api.save.mockResolvedValue(jak(8000)); api.documents.mockResolvedValue({}); api.cancelDocuments.mockResolvedValue({ returned_qty: 12 }); zal.stan = { totals: { totalPallets: 2, loadedPallets: 0 } } })

describe('Podział wysyłki', () => {
  it('podgląd po wpisaniu kg; wystawienie zablokowane, dopóki podział nie jest zapisany', async () => {
    mount(); cel('8000')
    expect(await screen.findByLabelText('na FV — KIRMIZI 50 kg')).toBeTruthy()
    expect(api.preview).toHaveBeenCalledWith('o1', 8000)
    expect(wystawBtn().disabled).toBe(true)
  })
  it('ręczna korekta idzie do zapisu w per_line — razem z liczbami, których nikt nie ruszał; puste pole = jawne zero', async () => {
    mount(); cel('8000')
    fireEvent.change(await screen.findByLabelText('na FV — KIRMIZI 50 kg'), { target: { value: '' } })
    expect(screen.getByText(/Sumy poniżej są sprzed tej korekty/)).toBeTruthy()
    fireEvent.click(zapiszBtn())
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('o1', 8000, { l1: 0, l2: 25 }))
  })
  it('ułamek w pozycji — zapis odmówiony z nazwą pozycji, wystawienie zablokowane', async () => {
    api.saved.mockResolvedValue(jak(8000))
    mount()
    const pole = await screen.findByLabelText('na FV — KIRMIZI 50 kg')
    await waitFor(() => expect(wystawBtn().disabled).toBe(false))
    fireEvent.change(pole, { target: { value: '8.5' } })
    expect(wystawBtn().disabled).toBe(true)
    fireEvent.click(zapiszBtn())
    expect(await screen.findByText(/KIRMIZI: sztuki na fakturę muszą być liczbą całkowitą/)).toBeTruthy()
    expect(api.save).not.toHaveBeenCalled()
  })
  it('zapisany podział z bazy: widać ręczną korektę i można wystawić BEZ ponownego zapisu; zmiana celu blokuje', async () => {
    api.saved.mockResolvedValue(ZAPISANY)
    mount()
    expect(((await screen.findByLabelText('na FV — KIRMIZI 30 kg')) as HTMLInputElement).value).toBe('8')
    expect(screen.getByText(/Zwykle znaczy to, że pozycja została poprawiona ręcznie/)).toBeTruthy()
    await waitFor(() => expect(wystawBtn().disabled).toBe(false))
    cel('500')
    await waitFor(() => expect(wystawBtn().disabled).toBe(true))
  })
  it('wystawienie: potwierdzenie we własnym oknie, ostatnie sprawdzenie bazy, potem komplet z danymi transportu', async () => {
    api.saved.mockResolvedValue(jak(8000))
    api.documents.mockResolvedValue({ wm: { id: 'w1', number: 'WM/1' }, wz: { id: 'w2', number: 'WZ/2' }, cmr: [{ id: 'c1', number: '1/10' }, { id: 'c2', number: '2/10' }], hdi_calosc: { id: 'h1', number: '55/10' }, pokrycie: { pelne: false, kg_wydane: 7000, kg_zamowienia: 7995, kg_braku: 995 } })
    mount()
    await waitFor(() => expect(wystawBtn().disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Przewoźnik CMR'), { target: { value: 'p1' } })
    fireEvent.click(wystawBtn())
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText(/Auto nie jest jeszcze załadowane/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wystaw komplet' }))
    await waitFor(() => expect(api.documents).toHaveBeenCalledWith('o1', false, expect.objectContaining({ carrier_id: 'p1', plate: 'KR 12345', instructions: 'TRANSPORT MROŻNICZY -22' })))
    expect(api.saved).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('WM/1')).toBeTruthy()
    expect(screen.getByText(/Papiery opisują o 995 kg więcej, niż wyjechało/)).toBeTruthy()
  })
  it('ktoś zmienił podział w międzyczasie — dokumentów nie wystawiono, na ekranie stan z bazy', async () => {
    api.saved.mockResolvedValueOnce(jak(8000)).mockResolvedValueOnce(jak(9000))
    mount()
    await waitFor(() => expect(wystawBtn().disabled).toBe(false))
    fireEvent.click(wystawBtn())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Wystaw komplet' }))
    expect(await screen.findByText(/Ktoś zmienił podział tego zamówienia/)).toBeTruthy()
    expect(api.documents).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Na fakturę kg') as HTMLInputElement).value).toBe('9000')
  })
  it('błąd odczytu zapisanego podziału NIE udaje braku podziału: zapis zablokowany, „Spróbuj ponownie”', async () => {
    api.saved.mockRejectedValueOnce(Object.assign(new Error('timeout'), { status: 500 })).mockResolvedValue(ZAPISANY)
    mount()
    expect(await screen.findByText(/Nie udało się sprawdzić, czy to zamówienie ma już zapisany podział \(timeout\)/)).toBeTruthy()
    cel('8000')
    await screen.findByLabelText('na FV — KIRMIZI 50 kg')
    expect(zapiszBtn().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    await waitFor(() => expect(screen.queryByText(/Nie udało się sprawdzić/)).toBeNull())
  })
  it('404 przy odczycie to nie awaria — okno milczy i pozwala zapisać', async () => {
    api.saved.mockRejectedValue(Object.assign(new Error('brak'), { status: 404 }))
    mount(); cel('8000')
    await screen.findByLabelText('na FV — KIRMIZI 50 kg')
    expect(screen.queryByText(/Nie udało się sprawdzić/)).toBeNull()
    expect(zapiszBtn().disabled).toBe(false)
  })
  it('odmowa „najpierw anuluj dokumenty podziału” — anulowanie na miejscu; HDI i CMR zostają', async () => {
    api.save.mockRejectedValue(new Error('Najpierw anuluj dokumenty podziału WZ/2'))
    mount(); cel('8000')
    await screen.findByLabelText('na FV — KIRMIZI 50 kg')
    fireEvent.click(zapiszBtn())
    expect(await screen.findByText(/HDI i CMR zostają z tymi samymi numerami/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Anuluj dokumenty podziału/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anuluj dokumenty' }))
    await waitFor(() => expect(api.cancelDocuments).toHaveBeenCalledWith('o1'))
    expect(await screen.findByText(/towar wrócił na stan \(12 szt\.\)/)).toBeTruthy()
  })
  it('spóźniona odpowiedź podglądu nie wskrzesza tabeli po wyczyszczeniu pola', async () => {
    let oddaj: (v: unknown) => void = () => {}
    api.preview.mockImplementation(() => new Promise(r => { oddaj = r }))
    mount(); cel('8000'); cel('')
    await act(async () => { oddaj(ODP) })
    expect(screen.queryByLabelText('na FV — KIRMIZI 50 kg')).toBeNull()
  })
  it('50/50 wpisuje połowę całości', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '50/50' }))
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith('o1', 6502.5))
  })
  it('bez przewoźnika — ostrzeżenie w potwierdzeniu; auto załadowane — bez ostrzeżenia o planie', async () => {
    zal.stan = { totals: { totalPallets: 2, loadedPallets: 2 } }
    api.saved.mockResolvedValue(jak(8000))
    mount()
    await waitFor(() => expect(wystawBtn().disabled).toBe(false))
    fireEvent.click(wystawBtn())
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText(/BEZ danych przewoźnika/)).toBeTruthy()
    expect(within(dlg).queryByText(/Auto nie jest jeszcze załadowane/)).toBeNull()
  })
})
