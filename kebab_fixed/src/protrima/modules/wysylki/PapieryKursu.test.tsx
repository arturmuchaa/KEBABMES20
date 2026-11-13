// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/** Papiery kursu: wystawienie zdejmuje towar ze stanu (WM) — test na danych w kształcie API. */
const api = vi.hoisted(() => ({ get: vi.fn(), wystaw: vi.fn(), wydrukowano: vi.fn(), doWydruku: vi.fn() }))
const pdf = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const otworzBlob = vi.hoisted(() => vi.fn((_b: Blob, _n: string) => Promise.resolve()))
const pobraneUrl = vi.hoisted(() => [] as string[])
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), zaladunkiApi: api, downloadDocPdf: pdf, openDocumentBlob: otworzBlob,
  fetchBlob: async (url: string) => { pobraneUrl.push(url); const { PDFDocument } = await import('pdf-lib'); const d = await PDFDocument.create(); d.addPage([200, 200]); const b = await d.save(); return { arrayBuffer: async () => b.slice().buffer } }, carriersApi: { list: () => Promise.resolve([{ id: 'c1', name: 'TRANS-POL', city: 'Kraków', defaultPlate: 'KR1234A' }]) } }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { PapieryKursu } from './PapieryKursu'
import { papieryPozycji, polaczPdfBajty, zamowieniaDoWystawienia, wpiszKg, calosc, PUSTA_DECYZJA, kgSprzedazy, uklad, type Kurs, type PozycjaKursu } from './kurs'

const KURS_SALDO: Kurs = {
  id: 'k2', plate: 'KOL1', finished_at: '2026-10-30T07:08:40Z', printed_at: '2026-10-30T09:00:00Z',
  pozycje: [
    { order_id: 'o1', order_no: 'A/1', client_id: 'c1', rozliczenia_otwarte: true, client_name: 'ODBIORCA PIERWSZY', wz_status: 'wystawiony', kg_zaladowane: 100, zaladowano: [],
      wz: [{ id: 'w1', number: 'WM/1/10/26', doc_series: 'WM' }], hdi: [], cmr: [] },
    { order_id: 'o2', order_no: 'B/1', client_id: 'c2', rozliczenia_otwarte: true, client_name: 'ODBIORCA DRUGI', wz_status: 'wystawiony', kg_zaladowane: 100, zaladowano: [],
      wz: [{ id: 'w2', number: 'WZ/2/10/26', doc_series: 'WZ' }], hdi: [], cmr: [] },
    { order_id: 'o3', order_no: 'C/1', client_id: null, client_name: 'BEZ KLIENTA', wz_status: 'wystawiony', kg_zaladowane: 100, zaladowano: [],
      wz: [], hdi: [], cmr: [] },
    // Bez salda otwarcia saldo nie idzie do klienta (dostałby „Brak należności”, choć wisi z Excela).
    { order_id: 'o4', order_no: 'D/1', client_id: 'c4', rozliczenia_otwarte: false, client_name: 'NIEOTWARTY', wz_status: 'wystawiony', kg_zaladowane: 100, zaladowano: [],
      wz: [], hdi: [], cmr: [] },
  ],
}

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
  it('nic nie wpisano = całość na fakturę; HDI do faktury domyślnie', () => {
    expect(zamowieniaDoWystawienia(KURS, {})).toEqual({ orders: [{ order_id: 'o1', cel_kg: 5200, invoice_no: '', hdi_fv: true }] })
  })
  it('pola połączone: wpis na WZ liczy fakturę i odwrotnie (9000 → WZ 3000 = FV 6000)', () => {
    const p = { ...KURS.pozycje[0], kg_zaladowane: 9000 }
    expect(wpiszKg(p, PUSTA_DECYZJA, 'wz', '3000')).toMatchObject({ kgWz: '3000', kgFv: '6000' })
    expect(wpiszKg(p, PUSTA_DECYZJA, 'fv', '2500,5')).toMatchObject({ kgFv: '2500,5', kgWz: '6499,5' })
    expect(wpiszKg(p, PUSTA_DECYZJA, 'fv', '')).toMatchObject({ kgFv: '', kgWz: '' })
  })
  it('całość na WZ = 0 kg na fakturę, bez HDI i numeru faktury; więcej niż wyjechało — odmowa', () => {
    const p = KURS.pozycje[0]
    expect(zamowieniaDoWystawienia(KURS, { o1: { ...calosc(p, PUSTA_DECYZJA, 'wz'), fakturaNr: 'FV 1' } }))
      .toEqual({ orders: [{ order_id: 'o1', cel_kg: 0, invoice_no: '', hdi_fv: false }] })
    expect(zamowieniaDoWystawienia(KURS, { o1: wpiszKg(p, PUSTA_DECYZJA, 'fv', '6000') })).toMatchObject({ blad: expect.stringMatching(/więcej niż wyjechało/) })
    expect(zamowieniaDoWystawienia(KURS, { o1: wpiszKg(p, PUSTA_DECYZJA, 'wz', '6000') })).toMatchObject({ blad: expect.stringMatching(/na WZ nie może iść więcej/) })
    expect(zamowieniaDoWystawienia(KURS, { o1: { ...PUSTA_DECYZJA, kgFv: '-5', kgWz: '5205' } })).toMatchObject({ blad: expect.stringMatching(/ujemne/) })
    expect(zamowieniaDoWystawienia(KURS, { o1: { ...wpiszKg(p, PUSTA_DECYZJA, 'fv', '3 000,5'), fakturaNr: ' FV 1/10 ', hdiFv: false } }))
      .toEqual({ orders: [{ order_id: 'o1', cel_kg: 3000.5, invoice_no: 'FV 1/10', hdi_fv: false }] })
    expect(zamowieniaDoWystawienia(KURS, { o1: { ...PUSTA_DECYZJA, kgFv: 'abc', kgWz: '1' } })).toMatchObject({ blad: expect.stringMatching(/wpisz kilogramy/) })
  })
  it('dokumenty odbiorcy: WM, HDI na całość i do faktury, CMR — z adresami PDF', () => {
    const p = papieryPozycji(KURS.pozycje[1])
    expect(p.map(d => `${d.etykieta} ${d.numer}`)).toEqual(['WM (wewnętrzny) WM/27/10/26', 'HDI 52/10/26', 'HDI do faktury 53/10/26', 'CMR na drogę 68/10/26'])
    expect(p[0].url).toMatch(/\/wz\/w1\/pdf$/)
    expect(p[0].plik).toBe('WM-WM-27-10-26.pdf')
  })
})

describe('Papiery kursu — jeden PDF z zaznaczonych', () => {
  it('łączy strony wszystkich dokumentów w kolejności listy', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const dok = async (stron: number) => { const d = await PDFDocument.create(); for (let i = 0; i < stron; i++) d.addPage([100 + stron, 100]); const b = await d.save(); return { arrayBuffer: async () => b.slice().buffer as ArrayBuffer } }
    const zrodla: Record<string, number> = { a: 2, b: 1 }
    const bajty = await polaczPdfBajty([{ key: 'a', etykieta: 'CMR', numer: '1', url: 'a', plik: 'a.pdf' }, { key: 'b', etykieta: 'HDI', numer: '2', url: 'b', plik: 'b.pdf' }], url => dok(zrodla[url]))
    const wynik = await PDFDocument.load(bajty)
    expect(wynik.getPages().map(p => Math.round(p.getWidth()))).toEqual([102, 102, 101])
  })
})

describe('Papiery kursu — ekran', () => {
  const mount = () => render(<AppCtx.Provider value={app}><PapieryKursu kursId="k1" active setCmds={c => { cmds = c }} onDone={vi.fn()} /></AppCtx.Provider>)

  it('wystawienie: podział + nr faktury + przewoźnik, potwierdzenie przed zapisem, numer rejestracyjny z załadunku', async () => {
    mount()
    expect(await screen.findByText('Do wystawienia · 1')).toBeTruthy()
    const karta = screen.getByLabelText('Odbiorca ISSA DISTRIB')
    expect((within(karta).getByLabelText('kg na fakturę, ISSA DISTRIB') as HTMLInputElement).value).toBe('5200')
    fireEvent.change(within(karta).getByLabelText('kg na WZ, ISSA DISTRIB'), { target: { value: '1200' } })
    expect((within(karta).getByLabelText('kg na fakturę, ISSA DISTRIB') as HTMLInputElement).value).toBe('4000')
    expect(within(karta).getByRole('button', { name: 'Podział' }).getAttribute('aria-pressed')).toBe('true')
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

  it('całość na WZ: bez pól faktury, w potwierdzeniu „bez dokumentów do faktury”, wysyła 0 kg', async () => {
    mount()
    const karta = await screen.findByLabelText('Odbiorca ISSA DISTRIB')
    fireEvent.click(within(karta).getByRole('button', { name: 'Całość na WZ' }))
    expect((within(karta).getByLabelText('kg na WZ, ISSA DISTRIB') as HTMLInputElement).value).toBe('5200')
    expect((within(karta).getByLabelText('kg na fakturę, ISSA DISTRIB') as HTMLInputElement).value).toBe('0')
    expect(within(karta).queryByLabelText('Nr faktury, ISSA DISTRIB')).toBeNull()
    run('issue')
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText(/na WZ — bez dokumentów do faktury/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wystaw komplet' }))
    await waitFor(() => expect(api.wystaw).toHaveBeenCalledTimes(1))
    expect(api.wystaw.mock.calls[0][1]).toEqual([{ order_id: 'o1', cel_kg: 0, invoice_no: '', hdi_fv: false }])
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

  it('ptaszki: zaznaczone CMR i HDI do faktury idą do JEDNEGO PDF-a w kolejności listy; bez zaznaczenia druk zablokowany', async () => {
    otworzBlob.mockClear(); pobraneUrl.length = 0
    mount()
    await screen.findByText('WM/27/10/26')
    expect(cmds.find(c => c.id === 'print-sel')!.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: CMR na drogę 68/10/26'))
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: HDI do faktury 53/10/26'))
    const guzik = await screen.findByRole('button', { name: 'Drukuj zaznaczone (2)' })
    fireEvent.click(guzik)
    await waitFor(() => expect(otworzBlob).toHaveBeenCalledTimes(1))
    // Kolejność listy (HDI przed CMR), nie kolejność klikania.
    expect(pobraneUrl.map(u => u.replace(/^.*\/api/, ''))).toEqual(['/hdi/h2/pdf', '/cmr/c1/pdf'])
    expect(otworzBlob.mock.calls[0][1]).toBe('Kurs_KOL47267_—_papiery.pdf')
    expect(pdf).not.toHaveBeenCalled()
  })

  it('„Zaznacz wszystkie” zaznacza komplet kursu', async () => {
    mount()
    await screen.findByText('WM/27/10/26')
    fireEvent.click(screen.getByRole('button', { name: 'Zaznacz wszystkie' }))
    expect(await screen.findByRole('button', { name: 'Drukuj zaznaczone (4)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Odznacz wszystkie' }))
    expect(await screen.findByRole('button', { name: 'Drukuj zaznaczone' })).toBeTruthy()
  })
})

describe('Papiery kursu — zestawienie należności', () => {
  const mount = () => render(<AppCtx.Provider value={app}><PapieryKursu kursId="k2" active setCmds={c => { cmds = c }} onDone={vi.fn()} /></AppCtx.Provider>)
  const dzis = new Date().toISOString().slice(0, 10)

  it('bez WZ klienta: pozycja z tagiem i w „wszystkich”; z WZ: pojedynczo, ale poza „wszystkimi”; bez client_id albo bez salda otwarcia: brak', async () => {
    api.get.mockResolvedValue(KURS_SALDO)
    mount()
    await screen.findByText('WM/1/10/26')
    const przyciski = screen.getAllByRole('button', { name: /Zestawienie należności/ })
    expect(przyciski).toHaveLength(2)
    expect(screen.getAllByText('do wydruku — brak WZ')).toHaveLength(1)
    fireEvent.click(przyciski[1])
    await waitFor(() => expect(pdf).toHaveBeenCalledWith(expect.stringMatching(/\/rozliczenia\/klient\/c2\/zestawienie\/pdf/), `SALDO_ODBIORCA_DRUGI_${dzis}.pdf`))
    pdf.mockClear()
    run('all')
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(3))
    const urle = (pdf.mock.calls as unknown as string[][]).map(c => c[0])
    expect(urle.some(u => /\/rozliczenia\/klient\/c1\/zestawienie\/pdf/.test(u))).toBe(true)
    expect(urle.some(u => /\/rozliczenia\/klient\/c2\//.test(u))).toBe(false)
    expect(urle.some(u => /\/rozliczenia\/klient\/c4\//.test(u))).toBe(false)
  })
})

describe('kurs z usługą (VATAN)', () => {
  const p = { order_id: 'o9', order_no: 'VATAN/1', client_name: 'VATAN', wz_status: 'do_wystawienia', kg_zaladowane: 400, kg_usluga: 300,
    zaladowano: [], wz: [], hdi: [], cmr: [] } as PozycjaKursu
  const k = { id: 'k9', plate: 'KR 1', finished_at: null, printed_at: null, pozycje: [p] } as Kurs
  it('na fakturę i WZ dzieli się tylko sprzedaż', () => {
    expect(kgSprzedazy(p)).toBe(100)
    expect(zamowieniaDoWystawienia(k, {})).toEqual({ orders: [{ order_id: 'o9', cel_kg: 100, invoice_no: '', hdi_fv: true }] })
    expect(wpiszKg(p, PUSTA_DECYZJA, 'wz', '40').kgFv).toBe('60')
    expect('blad' in zamowieniaDoWystawienia(k, { o9: { ...PUSTA_DECYZJA, kgFv: '400', kgWz: '0' } })).toBe(true)
  })
  it('sama usługa: nic na fakturę, układ „WZ” bez dokumentów do faktury', () => {
    const sama = { ...p, kg_usluga: 400 }
    expect(uklad(sama, PUSTA_DECYZJA)).toBe('wz')
    expect(zamowieniaDoWystawienia({ ...k, pozycje: [sama] }, {})).toEqual({ orders: [{ order_id: 'o9', cel_kg: 0, invoice_no: '', hdi_fv: false }] })
  })
  it('HDI usługa ma własną etykietę na liście papierów', () => {
    const papiery = papieryPozycji({ ...p, hdi: [{ id: 'h1', number: '12/11/26', scope: 'calosc' }, { id: 'h2', number: '13/11/26', scope: 'usluga' }] })
    expect(papiery.map(x => x.etykieta)).toEqual(['HDI', 'HDI usługa'])
  })
})
