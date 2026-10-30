// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/** Papiery kursu: wystawienie zdejmuje towar ze stanu (WM) — test na danych w kształcie API. */
const api = vi.hoisted(() => ({ get: vi.fn(), wystaw: vi.fn(), wydrukowano: vi.fn(), doWydruku: vi.fn() }))
const pdf = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), zaladunkiApi: api, downloadDocPdf: pdf, carriersApi: { list: () => Promise.resolve([{ id: 'c1', name: 'TRANS-POL', city: 'Kraków', defaultPlate: 'KR1234A' }]) } }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { PapieryKursu } from './PapieryKursu'
import { papieryPozycji, zamowieniaDoWystawienia, PUSTA_DECYZJA, type Kurs } from './kurs'

const KURS: Kurs = {
  id: 'k1', plate: 'KOL47267', finished_at: '2026-10-30T07:08:40Z', printed_at: null,
  pozycje: [
    { order_id: 'o1', order_no: 'ISSA/Z/3/10/26', client_name: 'ISSA DISTRIB', wz_status: 'do_wystawienia', kg_zaladowane: 5200, zaladowano: [{ stock_id: 's1', batch_no: 'b1', szt: 34 }], wz: [], hdi: [], cmr: [] },
    { order_id: 'o2', order_no: 'POLAT/Z/4/10/26', client_name: 'POLAT', wz_status: 'wystawiony', kg_zaladowane: 900, zaladowano: [],
      wz: [{ id: 'w1', number: 'WM/27/10/26', doc_series: 'WM' }], hdi: [{ id: 'h1', number: '52/10/26', scope: 'calosc' }, { id: 'h2', number: '53/10/26', scope: 'fv' }], cmr: [{ id: 'c1', number: '68/10/26', scope: 'calosc' }] },
  ],
}
const app = { toast: vi.fn() } as unknown as AppApi
let cmds: Array<{ id: string; run?: () => void; disabled?: boolean }> = []
const run = (id: string) => cmds.find(c => c.id === id)!.run!()
afterEach(cleanup)
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); pdf.mockClear(); refresh.mockClear(); api.get.mockResolvedValue(KURS); api.wystaw.mockResolvedValue({}) })

describe('Papiery kursu — logika', () => {
  it('całość = to, co wyjechało; podział: kg > 0 i nie więcej niż wyjechało; HDI do faktury domyślnie', () => {
    expect(zamowieniaDoWystawienia(KURS, {})).toEqual({ orders: [{ order_id: 'o1', cel_kg: 5200, invoice_no: '', hdi_fv: true }] })
    expect(zamowieniaDoWystawienia(KURS, { o1: { ...PUSTA_DECYZJA, tryb: 'podzial', kgFv: '' } })).toEqual({ blad: 'ISSA DISTRIB: podaj kilogramy na fakturę.' })
    expect(zamowieniaDoWystawienia(KURS, { o1: { ...PUSTA_DECYZJA, tryb: 'podzial', kgFv: '6000' } })).toMatchObject({ blad: expect.stringMatching(/więcej niż wyjechało/) })
    expect(zamowieniaDoWystawienia(KURS, { o1: { tryb: 'podzial', kgFv: '3 000,5', fakturaNr: ' FV 1/10 ', hdiFv: false } }))
      .toEqual({ orders: [{ order_id: 'o1', cel_kg: 3000.5, invoice_no: 'FV 1/10', hdi_fv: false }] })
  })
  it('dokumenty odbiorcy: WM, HDI na całość i do faktury, CMR — z adresami PDF', () => {
    const p = papieryPozycji(KURS.pozycje[1])
    expect(p.map(d => `${d.etykieta} ${d.numer}`)).toEqual(['WM (wewnętrzny) WM/27/10/26', 'HDI 52/10/26', 'HDI do faktury 53/10/26', 'CMR na drogę 68/10/26'])
    expect(p[0].url).toMatch(/\/wz\/w1\/pdf$/)
    expect(p[0].plik).toBe('WM-WM-27-10-26.pdf')
  })
})

describe('Papiery kursu — ekran', () => {
  const mount = () => render(<AppCtx.Provider value={app}><PapieryKursu kursId="k1" active setCmds={c => { cmds = c }} onDone={vi.fn()} /></AppCtx.Provider>)

  it('wystawienie: podział + nr faktury + przewoźnik, potwierdzenie przed zapisem, numer rejestracyjny z załadunku', async () => {
    mount()
    expect(await screen.findByText('Do wystawienia · 1')).toBeTruthy()
    const karta = screen.getByLabelText('Odbiorca ISSA DISTRIB')
    fireEvent.click(within(karta).getByRole('button', { name: 'Podział' }))
    fireEvent.change(within(karta).getByLabelText('kg na fakturę, ISSA DISTRIB'), { target: { value: '4000' } })
    expect(within(karta).getByText(/reszta 1\s?200 kg na WZ/)).toBeTruthy()
    fireEvent.change(within(karta).getByLabelText('Nr faktury, ISSA DISTRIB'), { target: { value: 'FV 11/10/2026' } })
    await waitFor(() => expect(screen.getByRole('option', { name: 'TRANS-POL, Kraków' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Przewoźnik'), { target: { value: 'c1' } })
    expect((screen.getByLabelText('Numer rejestracyjny') as HTMLInputElement).value).toBe('KOL47267')
    run('issue')
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText(/zdejmie towar ze stanu/)).toBeTruthy()
    expect(api.wystaw).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wystaw komplet' }))
    await waitFor(() => expect(api.wystaw).toHaveBeenCalledTimes(1))
    const [id, orders, transport] = api.wystaw.mock.calls[0]
    expect(id).toBe('k1')
    expect(orders).toEqual([{ order_id: 'o1', cel_kg: 4000, invoice_no: 'FV 11/10/2026', hdi_fv: true }])
    expect(transport).toMatchObject({ carrier_id: 'c1', plate: 'KOL47267', instructions: 'TRANSPORT MROŻNICZY -22' })
    expect(refresh).toHaveBeenCalled()
  })

  it('pobranie PDF pojedynczo i wszystkich; „wydrukowane” zablokowane, dopóki ktoś czeka na wystawienie', async () => {
    mount()
    await screen.findByText('WM/27/10/26')
    fireEvent.click(screen.getByRole('button', { name: /CMR na drogę/ }))
    await waitFor(() => expect(pdf).toHaveBeenCalledWith(expect.stringMatching(/\/cmr\/c1\/pdf$/), 'CMR-68-10-26.pdf'))
    expect(cmds.find(c => c.id === 'printed')!.disabled).toBe(true)
    run('all')
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(5))
  })
})
