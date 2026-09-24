// @vitest-environment jsdom
/**
 * Karta rozrachunków kontrahenta.
 *
 * Zastępuje jedną zakładkę arkusza `PŁATNOŚCI08.04.xlsx`. Trzy rzeczy musi
 * robić dobrze: pokazać saldo w walucie klienta, powiedzieć OD KIEDY liczy
 * (żeby nikt nie szukał starszych dokumentów w MES) i nie udawać zera, gdy
 * salda otwarcia nikt jeszcze nie wpisał.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const stan = vi.hoisted(() => ({ karta: null as any, padnij: false }))

vi.mock('@/lib/api', () => ({
  rozrachunkiApi: {
    karta: () => (stan.padnij
      ? Promise.reject(new Error('x'))
      : Promise.resolve(JSON.parse(JSON.stringify(stan.karta)))),
    otwarcie: () => Promise.resolve({}),
    faktura: () => Promise.resolve({}),
    wplata: () => Promise.resolve({}),
    usunPozycje: () => Promise.resolve({ ok: true }),
  },
}))

import { KartaRozrachunkow } from './KartaRozrachunkow'

const KARTA = {
  client: { id: 'c1', name: 'YBM GASTRO', nip: '123' },
  waluta: 'EUR',
  podstawa: 'both',
  otwarcie: { amount: -15649, as_of_date: '2026-09-01', note: '' },
  obciazenia: [
    { kind: 'wz', number: 'WZ/9/09/26', doc_date: '2026-09-15', amount: -3000,
      termin: '2026-09-16', dni_po_terminie: 4 },
    { kind: 'invoice', id: 'ch1', number: 'FS 12/09/2026', doc_date: '2026-09-18',
      amount: -2000, termin: '2026-10-02', dni_po_terminie: 0 },
  ],
  wplaty: [{ id: 'p1', paid_date: '2026-09-20', amount: -500, note: '2850 28.07' }],
  saldo: { otwarcie: -15649, obciazenia: -5000, wplaty: -500,
           saldo: -20149, skonfigurowane: true },
  na_dzien: '2026-09-20',
}

beforeEach(() => { stan.karta = KARTA; stan.padnij = false })
afterEach(cleanup)

describe('karta rozrachunków', () => {
  it('pokazuje saldo w walucie klienta', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/-20 149,00 €/)).toBeTruthy()
  })

  it('mówi, OD KIEDY liczy — żeby nikt nie szukał starszych dokumentów', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/01\.09\.2026/)).toBeTruthy()
  })

  it('wyróżnia pozycje po terminie', async () => {
    const { container } = render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText('WZ/9/09/26')
    expect(container.querySelector('[data-po-terminie="4"]')).toBeTruthy()
  })

  it('pozycja w terminie NIE jest wyróżniona', async () => {
    const { container } = render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText('FS 12/09/2026')
    const w = container.querySelector('[data-numer="FS 12/09/2026"]')
    expect(w?.getAttribute('data-po-terminie')).toBe('0')
  })

  it('bez salda otwarcia mówi WPROST, że trzeba je wpisać', async () => {
    stan.karta = { ...KARTA, otwarcie: null,
                   saldo: { ...KARTA.saldo, skonfigurowane: false } }
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/wpisz saldo otwarcia/i)).toBeTruthy()
  })

  it('pokazuje wpłaty z uwagą biura', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText('2850 28.07')).toBeTruthy()
  })

  it('błąd wczytania nie zostawia pustego ekranu', async () => {
    stan.padnij = true
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/nie udało się wczytać/i)).toBeTruthy()
  })
})
