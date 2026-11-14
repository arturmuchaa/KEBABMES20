// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

const dok = vi.hoisted(() => ({ wz: vi.fn(), cmr: vi.fn(), hdi: vi.fn() }))
const blob = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), dokumentyApi: dok, fetchBlob: blob }))
import { DokumentyModule } from './DokumentyModule'

const DZIS = new Date().toISOString().slice(0, 10)
const WZ = [
  { id: 'w1', number: 'WZ/2/11/26', buyer_name: 'VATAN Sp. z o.o.', total_value: 8670.3, valued: true, status: 'wstepny', release_date: DZIS, currency: 'PLN', source_type: 'manual', doc_series: 'WZ' },
  { id: 'w2', number: 'WM/1/11/26', buyer_name: 'VATAN Sp. z o.o.', total_value: 0, valued: false, status: 'wstepny', release_date: DZIS, source_type: 'order', source_id: 'o1', order_id: 'o1', order_no: 'VATAN/Z/3/11/26', split_scope: 'calosc', doc_series: 'WM', loaded_at: 'x' },
  { id: 'w3', number: 'WZ/1/11/26', buyer_name: 'BEYOGLU', total_value: 100, valued: true, status: 'wstepny', release_date: DZIS, source_type: 'manual', doc_series: 'WZ' },
]
const CMR = [{ id: 'c1', number: '68/11/26', client_name: 'VATAN Sp. z o.o.', status: 'wystawiony', issue_date: DZIS, carrier_name: 'TRANS-POL', order_no: 'VATAN/Z/3/11/26' }]
const HDI = [{ id: 'h1', number: '52/11/26', client_name: 'BEYOGLU', status: 'wystawiony', issue_date: DZIS, scope: 'calosc' }]
const app = { toast: vi.fn(), openOrder: vi.fn(), setPanel: vi.fn(), panel: 'bok' } as unknown as AppApi
const mount = () => render(<AppCtx.Provider value={app}><DokumentyModule active setCtx={vi.fn()} setCmds={vi.fn()} /></AppCtx.Provider>)
const lista = () => screen.getByRole('grid', { name: /Lista dokumentów/ })
const numery = () => within(lista()).queryAllByTestId('numer').map(e => e.textContent)
afterEach(cleanup)
beforeEach(() => {
  dok.wz.mockResolvedValue(WZ); dok.cmr.mockResolvedValue(CMR); dok.hdi.mockResolvedValue(HDI)
  blob.mockReset(); blob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
  ;(globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x')
  ;(globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
})

describe('moduł Dokumenty', () => {
  it('trzy zakładki z licznikami; WZ na start, najnowsze numery na górze', async () => {
    mount()
    await waitFor(() => expect(numery()).toEqual(['WZ/2/11/26', 'WZ/1/11/26', 'WM/1/11/26']))
    expect(screen.getByRole('tab', { name: /WZ.*3/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /CMR.*1/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /HDI.*1/ })).toBeTruthy()
  })
  it('szukaj i klient zostają po przełączeniu zakładki', async () => {
    mount()
    await waitFor(() => expect(numery().length).toBe(3))
    fireEvent.change(screen.getByLabelText('Szukaj dokumentu'), { target: { value: 'vatan' } })
    expect(numery()).toEqual(['WZ/2/11/26', 'WM/1/11/26'])
    fireEvent.click(screen.getByRole('tab', { name: /HDI/ }))
    expect((screen.getByLabelText('Szukaj dokumentu') as HTMLInputElement).value).toBe('vatan')
    expect(numery()).toEqual([])
    fireEvent.click(screen.getByRole('tab', { name: /CMR/ }))
    expect(numery()).toEqual(['68/11/26'])
  })
  it('sort po kliknięciu nagłówka „Klient”', async () => {
    mount()
    await waitFor(() => expect(numery().length).toBe(3))
    fireEvent.click(within(lista()).getByRole('columnheader', { name: /Klient/ }))
    expect(numery()[0]).toBe('WZ/1/11/26')   // BEYOGLU przed VATAN
  })
  it('zaznaczenie jest osobne dla każdej zakładki (druk nie miesza WZ z CMR)', async () => {
    mount()
    await waitFor(() => expect(numery().length).toBe(3))
    fireEvent.click(within(lista()).getByLabelText('Zaznacz WZ/2/11/26'))
    expect(screen.getByRole('button', { name: /Drukuj zaznaczone \(1\)/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /CMR/ }))
    expect(screen.getByRole('button', { name: /^Drukuj zaznaczone$/ })).toBeTruthy()
  })
  it('podgląd PDF wybranego; „Anuluj” przy WM z kursu wyłączone z podpowiedzią', async () => {
    mount()
    await waitFor(() => expect(numery().length).toBe(3))
    fireEvent.click(within(lista()).getByText('WM/1/11/26'))
    await waitFor(() => expect(document.querySelector('iframe[title^="Podgląd"]')).toBeTruthy())
    const an = screen.getByRole('button', { name: 'Anuluj dokument' }) as HTMLButtonElement
    expect(an.disabled).toBe(true)
    expect(an.getAttribute('data-tip')).toMatch(/komplet/)
  })
  it('błąd pobrania PDF: komunikat i „Otwórz PDF” zamiast pustej ramki', async () => {
    blob.mockRejectedValue(new Error('401'))
    mount()
    await waitFor(() => expect(numery().length).toBe(3))
    fireEvent.click(within(lista()).getByText('WZ/2/11/26'))
    expect(await screen.findByText(/Nie udało się wczytać podglądu/)).toBeTruthy()
    expect(document.querySelector('iframe[title^="Podgląd"]')).toBeNull()
  })
})
