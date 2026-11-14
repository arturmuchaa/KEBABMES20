// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const wz = vi.hoisted(() => ({ opisPozycji: vi.fn(), dopiszPozycje: vi.fn(), usunPozycje: vi.fn(), stockRaw: vi.fn(), list: vi.fn(), pdfUrl: (id: string) => `/api/wz/${id}/pdf` }))
const dokumenty = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (orig) => { const o = await orig() as Record<string, unknown>
  return { ...o, wzApi: { ...(o.wzApi as object), ...wz }, clientOrdersApi: { ...(o.clientOrdersApi as object), documents: dokumenty } } })
import { DopiszPozycjeDialog } from './DopiszPozycjeDialog'
import { DocumentsTab } from '../tabs/Documents'
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'

const app = { toast: vi.fn() } as unknown as AppApi
const OPIS = (o: Record<string, unknown> = {}) => ({ para: 'wm_wzk', bez_recznej: null, currency: 'PLN', eur_rate: null, valued: true,
  dokumenty: [{ id: 'w1', number: 'WM/1/11/26', doc_series: 'WM', valued: true, lines: [] }, { id: 'w2', number: 'WZ/7/11/26', doc_series: 'WZ', valued: true, lines: [] }], ...o })
const mount = (onZmiana = vi.fn()) => { render(<AppCtx.Provider value={app}><DopiszPozycjeDialog wzId="w2" onClose={vi.fn()} onZmiana={onZmiana} /></AppCtx.Provider>); return onZmiana }
afterEach(cleanup)
beforeEach(() => { Object.values(wz).forEach(f => typeof f === 'function' && 'mockReset' in f && (f as ReturnType<typeof vi.fn>).mockReset())
  wz.opisPozycji.mockResolvedValue(OPIS()); wz.list.mockResolvedValue([]); wz.stockRaw.mockResolvedValue([]); wz.dopiszPozycje.mockResolvedValue({}) })

const wpiszJogurt = async () => {
  fireEvent.change(await screen.findByLabelText('Nazwa pozycji'), { target: { value: 'Jogurt naturalny' } })
  fireEvent.change(screen.getByLabelText('Ilość'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Cena za szt'), { target: { value: '4,50' } })
}

describe('Dopisz pozycję do wystawionego dokumentu', () => {
  it('jogurt: jedno wywołanie z lineId i ceną z przecinkiem; podwójny klik nie dubluje', async () => {
    let koniec: (v: unknown) => void = () => {}
    wz.dopiszPozycje.mockImplementation(() => new Promise(r => { koniec = r }))
    const onZmiana = mount()
    await wpiszJogurt()
    const btn = screen.getByRole('button', { name: 'Dodaj pozycję' })
    fireEvent.click(btn); fireEvent.click(btn)
    expect(wz.dopiszPozycje).toHaveBeenCalledTimes(1)
    expect(wz.dopiszPozycje).toHaveBeenCalledWith('w2', expect.objectContaining({ rodzaj: 'reczna', name: 'Jogurt naturalny', qty: 10, price: 4.5, unit: 'szt', lineId: expect.any(String) }))
    koniec({}); await waitFor(() => expect(onZmiana).toHaveBeenCalled())
  })
  it('błąd serwera (409) pokazany w oknie', async () => {
    wz.dopiszPozycje.mockRejectedValue(new Error('Dokument WZ/7 jest anulowany'))
    mount()
    await wpiszJogurt()
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj pozycję' }))
    expect(await screen.findByText(/jest anulowany/)).toBeTruthy()
  })
  it('sam WM (całość na fakturę): zakładka „Z ręki” wyłączona z komunikatem', async () => {
    wz.opisPozycji.mockResolvedValue(OPIS({ para: 'sam_wm', bez_recznej: 'Ten kurs idzie w całości na fakturę z Subiekta — dopisz tę pozycję na fakturze.',
      dokumenty: [{ id: 'w1', number: 'WM/1/11/26', doc_series: 'WM', valued: false, lines: [] }] }))
    mount()
    expect(await screen.findByText(/na fakturę z Subiekta/)).toBeTruthy()
    expect((screen.getByRole('tab', { name: 'Z ręki' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('EUR: nagłówek z walutą i kursem NBP, € przy cenie', async () => {
    wz.opisPozycji.mockResolvedValue(OPIS({ currency: 'EUR', eur_rate: 4.2512 }))
    mount()
    expect(await screen.findByText(/kurs NBP 4,2512/)).toBeTruthy()
    expect((screen.getByLabelText('Cena za szt').parentElement as HTMLElement).textContent).toContain('€')
  })
  it('dopisana pozycja widoczna raz (kopie na WM i WZ) i usuwana po potwierdzeniu', async () => {
    const loj = { line_id: 'L1', stock_type: 'raw', stock_id: 'rb', name: 'Łój wołowy otokowy', qty: 15, unit: 'kg', value: 30, batch_no: '950' }
    wz.opisPozycji.mockResolvedValue(OPIS({ dokumenty: [
      { id: 'w1', number: 'WM/1/11/26', doc_series: 'WM', valued: true, lines: [loj] },
      { id: 'w2', number: 'WZ/7/11/26', doc_series: 'WZ', valued: true, lines: [{ ...loj, stock_id: undefined }] }] }))
    wz.usunPozycje.mockResolvedValue({})
    mount()
    const tab = await screen.findByLabelText('Dopisane pozycje')
    expect(within(tab).getAllByText('Łój wołowy otokowy')).toHaveLength(1)
    fireEvent.click(within(tab).getByRole('button', { name: /Usuń dopisaną pozycję/ }))
    expect(screen.getByText(/wróci na stan partii 950/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Usuń' }))
    await waitFor(() => expect(wz.usunPozycje).toHaveBeenCalledWith('w2', 'L1'))
  })
})

describe('Dopisz pozycję — stan surowca po dopisaniu', () => {
  it('po dopisaniu łoju lista partii wczytuje się od nowa (wolne kg spadają)', async () => {
    wz.stockRaw.mockResolvedValueOnce([{ id: 'rb', stock_type: 'raw', internal_batch_no: '735', name: 'Łój wołowy zwykły', kg_available: 80 }])
      .mockResolvedValueOnce([{ id: 'rb', stock_type: 'raw', internal_batch_no: '735', name: 'Łój wołowy zwykły', kg_available: 65 }])
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: 'Z magazynu surowca' }))
    fireEvent.click(await screen.findByText('Łój wołowy zwykły'))
    fireEvent.change(screen.getByLabelText('Ilość w kg'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Cena za kg'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj pozycję' }))
    expect(await screen.findByText('65 kg')).toBeTruthy()
    expect(wz.stockRaw).toHaveBeenCalledTimes(2)
  })
})

describe('zakładka Dokumenty zamówienia — „Dopisz pozycję…” przy WZ/WM', () => {
  it('przycisk przy WZ i WM (nie przy HDI/CMR) otwiera okno dla tego dokumentu', async () => {
    dokumenty.mockResolvedValue({ order_id: 'o1', order_no: 'T/Z/1', client_id: 'c1', client_name: 'T', rozliczenia_otwarte: false,
      wz: [{ id: 'w1', number: 'WM/1/11/26', doc_series: 'WM', date: '2026-11-12' }, { id: 'w2', number: 'WZ/7/11/26', doc_series: 'WZ', date: '2026-11-12' }],
      hdi: [{ id: 'h1', number: 'HDI/1/11/26', scope: 'fv', date: '2026-11-12' }], cmr: [] })
    const order = mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'T/Z/1', client_name: 'T', status: 'done', lines: [] }), { clients: [], pallets: {}, wz: [], planByLine: {} })
    render(<AppCtx.Provider value={app}><DocumentsTab order={order} /></AppCtx.Provider>)
    const btns = await screen.findAllByRole('button', { name: /Dopisz pozycję/ })
    expect(btns).toHaveLength(2)
    fireEvent.click(btns[1])
    await waitFor(() => expect(wz.opisPozycji).toHaveBeenCalledWith('w2'))
  })
})
