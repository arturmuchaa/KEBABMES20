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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ karta: null as any, padnij: false }))
const wolania = vi.hoisted(() => ({
  otwarcie: [] as any[], faktura: [] as any[], wplata: [] as any[],
}))

vi.mock('@/lib/api', () => ({
  rozrachunkiApi: {
    karta: () => (stan.padnij
      ? Promise.reject(new Error('x'))
      : Promise.resolve(JSON.parse(JSON.stringify(stan.karta)))),
    otwarcie: (id: string, dto: any) => { wolania.otwarcie.push({ id, dto }); return Promise.resolve({}) },
    faktura: (id: string, dto: any) => { wolania.faktura.push({ id, dto }); return Promise.resolve({}) },
    wplata: (id: string, dto: any) => { wolania.wplata.push({ id, dto }); return Promise.resolve({}) },
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

beforeEach(() => {
  stan.karta = KARTA; stan.padnij = false
  wolania.otwarcie = []; wolania.faktura = []; wolania.wplata = []
})
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

// ─── Formularze zapisu (luka zlapana w przegladzie 24.09.2026) ─────────
//
// Karta byla w calosci TYLKO DO ODCZYTU: nie dalo sie wpisac salda
// otwarcia, faktury ani wplaty inaczej niz SQL-em w bazie.
describe('zapisy na karcie', () => {
  it('saldo otwarcia wysyła kwotę i datę', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText(/-20 149,00 €/)

    fireEvent.click(screen.getByTestId('pokaz-otwarcie'))
    fireEvent.change(screen.getByTestId('otwarcie-kwota'), { target: { value: '15649' } })
    fireEvent.change(screen.getByTestId('otwarcie-data'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByTestId('otwarcie-zapisz'))

    await waitFor(() => expect(wolania.otwarcie).toHaveLength(1))
    expect(wolania.otwarcie[0].dto.amount).toBe(15649)
    expect(wolania.otwarcie[0].dto.as_of_date).toBe('2026-09-01')
  })

  it('faktura wysyła numer, datę i kwotę', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText(/-20 149,00 €/)

    fireEvent.click(screen.getByTestId('pokaz-fakture'))
    fireEvent.change(screen.getByTestId('faktura-numer'), { target: { value: 'FS 12/09/2026' } })
    fireEvent.change(screen.getByTestId('faktura-kwota'), { target: { value: '2000,50' } })
    fireEvent.click(screen.getByTestId('faktura-zapisz'))

    await waitFor(() => expect(wolania.faktura).toHaveLength(1))
    expect(wolania.faktura[0].dto.number).toBe('FS 12/09/2026')
    // Przecinek dziesiętny — biuro pisze po polsku.
    expect(wolania.faktura[0].dto.amount).toBe(2000.5)
  })

  it('wpłata wysyła kwotę i uwagę', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText(/-20 149,00 €/)

    fireEvent.click(screen.getByTestId('pokaz-wplate'))
    fireEvent.change(screen.getByTestId('wplata-kwota'), { target: { value: '400' } })
    fireEvent.change(screen.getByTestId('wplata-uwaga'), { target: { value: '2850 28.07' } })
    fireEvent.click(screen.getByTestId('wplata-zapisz'))

    await waitFor(() => expect(wolania.wplata).toHaveLength(1))
    expect(wolania.wplata[0].dto.amount).toBe(400)
    expect(wolania.wplata[0].dto.note).toBe('2850 28.07')
  })

  it('faktura bez numeru NIE jest wysyłana', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText(/-20 149,00 €/)

    fireEvent.click(screen.getByTestId('pokaz-fakture'))
    fireEvent.change(screen.getByTestId('faktura-kwota'), { target: { value: '100' } })
    fireEvent.click(screen.getByTestId('faktura-zapisz'))

    await waitFor(() => expect(wolania.faktura).toHaveLength(0))
  })

  it('ostrzega o dokumentach w innej walucie', async () => {
    stan.karta = { ...KARTA, ostrzezenia: { inna_waluta: 2 } }
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/2 dokument/i)).toBeTruthy()
  })
})
