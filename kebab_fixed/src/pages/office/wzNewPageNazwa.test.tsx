// @vitest-environment jsdom
/**
 * Formularz WZ pokazuje TĘ nazwę, którą wystawi dokument.
 *
 * Biuro (12.09.2026, FUDI): „podczas wystawiania WZ dalej pokazuje rodzaj +
 * receptura, mimo że w ustawieniach zaznaczone tylko rodzaj i stosuj na WZ".
 * Papier był już dobry — nazwę nadpisywał backend przy wystawianiu — ale ekran
 * składał ją po swojemu w przeglądarce (`zlozNazweWyrobu`) i kartoteki nie
 * znał. Biuro nie miało jak sprawdzić dokumentu przed wystawieniem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({ picks: [] as any[], magazyn: [] as any[] }))

vi.mock('@/lib/api', () => ({
  wzApi: {
    fromOrderPicks: () => Promise.resolve({
      order_id: 'oF', order_no: 'FUDI/Z/1/09/26', client_id: 'cF',
      buyer: { name: 'FUDI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', address: '', nip: '6211836715' },
      ordered: 2, picks: stan.picks,
    }),
    stockFg: () => Promise.resolve(stan.magazyn),
    stockRaw: () => Promise.resolve([]),
    nextNumber: () => Promise.resolve({ number: 'WZ/15/09/26' }),
    createManual: vi.fn(),
    pdfUrl: () => '',
  },
  clientsApi: { list: () => Promise.resolve([]) },
  settingsApi: { get: () => Promise.resolve({}), getCompany: () => Promise.resolve({}) },
  containersApi: { partners: () => Promise.resolve([]), balance: () => Promise.resolve({}) },
  payrollApi: { workers: () => Promise.resolve([]) },
  downloadDocPdf: vi.fn(),
}))
vi.mock('@/lib/otworzDokument', () => ({ useOtworzDokument: () => vi.fn() }))
vi.mock('@/lib/clientNames', () => ({
  useClientNames: () => (n: string) => n,
  useClientRecipeNames: () => (_a: any, _b: any, f: string) => f,
}))

import { WzNewPage } from './WzNewPage'

beforeEach(() => {
  stan.picks = []
  stan.magazyn = []
  window.history.pushState({}, '', '/office/wz/nowy?order=oF')
})
afterEach(() => { cleanup(); window.history.pushState({}, '', '/') })

function pokaz() {
  render(<MemoryRouter initialEntries={['/office/wz/nowy?order=oF']}><WzNewPage /></MemoryRouter>)
}

describe('nazwa pozycji w formularzu WZ', () => {
  it('bierze nazwę ZŁOŻONĄ PRZEZ BACKEND, nie składa własnej', async () => {
    stan.picks = [{
      stock_id: 'fg1', qty: 2, batch_no: '110926 545/549',
      name: 'MIX UDO/FILET 30kg',                 // to, co wystawi dokument
      product_type_name: 'KEBAB MIX', recipe_name: 'FUDI KIRMIZI',
      kg_per_unit: 30, qty_available: 28,
    }]
    pokaz()

    expect(await screen.findByText('MIX UDO/FILET 30kg')).toBeTruthy()
    expect(screen.queryByText(/FUDI KIRMIZI/)).toBeNull()
  })

  it('starszy backend bez pola `name` — formularz dalej działa', async () => {
    stan.picks = [{
      stock_id: 'fg1', qty: 2, batch_no: '110926 545/549',
      product_type_name: 'KEBAB MIX', recipe_name: 'FUDI KIRMIZI',
      kg_per_unit: 30, qty_available: 28,
    }]
    pokaz()

    expect(await screen.findByText('KEBAB MIX FUDI KIRMIZI 30kg')).toBeTruthy()
  })
})
