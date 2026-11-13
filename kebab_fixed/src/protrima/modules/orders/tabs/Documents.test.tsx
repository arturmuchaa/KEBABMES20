// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'
const dokumenty = vi.hoisted(() => vi.fn())
const otworzBlob = vi.hoisted(() => vi.fn((_b: Blob, _n: string) => Promise.resolve()))
vi.mock('@/lib/api', async (orig) => { const o = await orig() as Record<string, unknown>; return { ...o, clientOrdersApi: { ...(o.clientOrdersApi as object), documents: dokumenty }, openDocumentBlob: otworzBlob,
  fetchBlob: async () => { const { PDFDocument } = await import('pdf-lib'); const d = await PDFDocument.create(); d.addPage([200, 200]); const b = await d.save(); return { arrayBuffer: async () => b.slice().buffer } } } })
import { DocumentsTab } from './Documents'

/** Zamówienie w kształcie API (syntetyczne): jedna pozycja 20 × 40 kg, połowa w magazynie. */
const order = (status = 'confirmed') => mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'T/Z/1', client_name: 'T', status, lines: [
  { id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 10 },
] }), { clients: [], pallets: {}, wz: [], planByLine: {} })
const app = { genHdi: vi.fn(), issueWz: vi.fn(), openCmr: vi.fn(), splitOrder: vi.fn(), printOrder: vi.fn(), printPicking: vi.fn(), printPallets: vi.fn(), toast: vi.fn() }
const mount = (status?: string) => render(<AppCtx.Provider value={app as unknown as AppApi}><DocumentsTab order={order(status)} /></AppCtx.Provider>)
afterEach(cleanup)
beforeEach(() => { Object.values(app).forEach(f => f.mockReset()); dokumenty.mockReset(); dokumenty.mockRejectedValue(new Error('brak')); otworzBlob.mockClear() })

describe('zakładka Dokumenty', () => {
  it('Wystaw HDI: najpierw pytanie (numer HDI nie wraca do puli), Wróć niczego nie wystawia', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Wystaw HDI/ }))
    const dlg = screen.getByRole('dialog')
    expect(app.genHdi).not.toHaveBeenCalled()
    // Okno mówi o obu przypadkach — przeglądarka nie wie, czy HDI już jest.
    expect(within(dlg).getByText(/Pierwsze wystawienie nada numer HDI/)).toBeTruthy()
    expect(within(dlg).getByText(/Ponowne odświeży treść/)).toBeTruthy()
    // Brak wyrobu (10 z 20 szt. × 40 kg) — ostrzeżenie przed, nie toast po fakcie.
    expect(within(dlg).getByText(/400 kg/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wróć' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.genHdi).not.toHaveBeenCalled()
  })

  it('Wystaw HDI po potwierdzeniu: jedno wywołanie, okno znika', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Wystaw HDI/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Wystaw HDI/ }))
    expect(app.genHdi).toHaveBeenCalledTimes(1)
    expect(app.genHdi).toHaveBeenCalledWith('o1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('zamknięte zamówienie: Podgląd HDI bez pytania (HDI zamrożone, numer już nadany); WZ i podział zablokowane', () => {
    mount('done')
    fireEvent.click(screen.getByRole('button', { name: /Podgląd HDI/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.genHdi).toHaveBeenCalledWith('o1')
    expect((screen.getByRole('button', { name: /Wystaw WZ/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Podział wysyłki/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('skutek słowem: WZ i podział zdejmują towar ze stanu, HDI i CMR nadają numer, wydruki bez skutku', () => {
    mount()
    const skutek = (nazwa: RegExp) => screen.getByRole('button', { name: nazwa }).querySelector('.dt-s')?.textContent ?? null
    expect(skutek(/Wystaw WZ/)).toBe('zdejmuje towar ze stanu')
    expect(skutek(/Podział wysyłki/)).toBe('zdejmuje towar ze stanu')
    expect(skutek(/Wystaw HDI/)).toBe('nadaje numer')
    expect(skutek(/Wystaw CMR/)).toBe('nadaje numer')
    expect(skutek(/^Zamówienie/)).toBeNull()
    expect(skutek(/Lista kompletacji/)).toBeNull()
    const wydruki = screen.getByRole('region', { name: 'Wydruki' })
    expect(within(wydruki).getByText('nic nie zmieniają w systemie')).toBeTruthy()
  })

  it('szkic: dokumenty wydania zablokowane z powodem w podpowiedzi, wydruki działają', () => {
    mount('draft')
    for (const n of [/Wystaw WZ/, /Wystaw HDI/, /Wystaw CMR/, /Podział wysyłki/]) {
      const b = screen.getByRole('button', { name: n }) as HTMLButtonElement
      expect(b.disabled).toBe(true)
      expect(b.dataset.tip).toBe('Najpierw potwierdź zamówienie')
    }
    fireEvent.click(screen.getByRole('button', { name: /^Zamówienie/ }))
    expect(app.printOrder).toHaveBeenCalledWith('o1')
  })

  it('zrealizowane zamówienie: WM, WZ, HDI, CMR i zestawienie należności w jednej liście; zaznaczone drukują się jednym PDF-em', async () => {
    dokumenty.mockResolvedValue({ order_id: 'o1', order_no: 'T/Z/1', client_id: 'c1', client_name: 'T', rozliczenia_otwarte: true,
      wz: [{ id: 'w1', number: 'WM/1/11/26', doc_series: 'WM', date: '2026-11-12' }, { id: 'w2', number: 'WZ/7/11/26', doc_series: 'WZ', date: '2026-11-12' }],
      hdi: [{ id: 'h1', number: 'HDI/1/11/26', scope: 'fv', date: '2026-11-12' }], cmr: [{ id: 'c1', number: 'CMR/1/11/26', scope: 'fv', date: '2026-11-13' }] })
    mount('done')
    expect(await screen.findByText('Wszystkie dokumenty zamówienia')).toBeTruthy()
    for (const nr of ['WM/1/11/26', 'WZ/7/11/26', 'HDI/1/11/26', 'CMR/1/11/26']) expect(screen.getByText(nr)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Zestawienie należności/ })).toBeTruthy()
    expect(screen.getByText('13.11.2026')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: CMR do faktury CMR/1/11/26'))
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: HDI do faktury HDI/1/11/26'))
    fireEvent.click(screen.getByLabelText('Zaznacz do wydruku: Zestawienie należności'))
    fireEvent.click(await screen.findByRole('button', { name: 'Drukuj zaznaczone (3)' }))
    await waitFor(() => expect(otworzBlob).toHaveBeenCalledTimes(1))
    expect(otworzBlob.mock.calls[0][1]).toBe('T_Z_1_—_dokumenty.pdf')
  })

  it('gdy serwer nie odda listy — zostaje dotychczasowa lista WZ/WM', async () => {
    mount()
    expect(await screen.findByText('Wystawione WZ / WM')).toBeTruthy()
  })
})
