// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const stan = vi.hoisted(() => ({ wywolania: [] as unknown[][], drukuj: 0 }))
vi.mock('@/lib/print', () => ({ drukuj: () => { stan.drukuj += 1 } }))
vi.mock('@/lib/api', () => ({
  settingsApi: {
    getCompany: () => Promise.resolve({ name: 'Firma Testowa', address: 'Zakładowa 1',
                                        postalCode: '00-001', city: 'Miasto', nip: '1112223344',
                                        phone: '+48 600 100 200', email: 'biuro@firma.test' }),
  },
  rozliczeniaApi: {
    zestawienie: (...a: unknown[]) => {
      stan.wywolania.push(['zestawienie', ...a])
      return Promise.resolve({
        klient: { nazwa: 'RONDO GRILL', nip: 'DE123456789', adres: 'Hauptstr. 1, Berlin' },
        waluta: 'EUR', na_dzien: '2026-11-09', policzono: '2026-11-09T10:00:00',
        wz: { pozycje: [], razem: 0 },
        fv: { pozycje: [
                { numer: 'FV 431/2026', data: '2026-08-28', termin: '2026-09-04', kwota: 4380,
                  zaplacono: 0, pozostalo: 4380, dni_po_terminie: 66, ten_dokument: false },
                { numer: '541', data: '2026-11-03', termin: '2026-11-10', kwota: 12342.2,
                  zaplacono: 0, pozostalo: 12342.2, dni_po_terminie: 0, ten_dokument: false }],
              razem: 16722.2 },
        razem: 16722.2, po_terminie: 4380, nadplata_wz: 0, nadplata_fv: 0,
      })
    },
    historia: (...a: unknown[]) => {
      stan.wywolania.push(['historia', ...a])
      return Promise.resolve({
        klient: { nazwa: 'RONDO GRILL', nip: '', adres: '' }, waluta: 'PLN',
        od: '2026-11-01', do: '2026-11-30',
        wz: { saldo_poczatek: 0, saldo_koniec: -1550, wiersze: [
          { data: '2026-09-27', rodzaj: 'dokument', opis: 'WZ/77/09/26', obciazenie: 1260,
            wplata: 0, saldo: -1260, dni_po_terminie: 0 },
          { data: '2026-11-09', rodzaj: 'dokument', opis: 'Saldo otwarcia', obciazenie: 0,
            wplata: 2000, saldo: 2000, dni_po_terminie: 0 },
          { data: '2026-11-10', rodzaj: 'dokument', opis: 'WZ 7/11', obciazenie: 550,
            wplata: 0, saldo: 1450, dni_po_terminie: 0 },
          { data: '2026-11-12', rodzaj: 'dokument', opis: 'WZ 9/11', obciazenie: 3000,
            wplata: 0, saldo: -1550, dni_po_terminie: 18 },
        ] },
        fv: { saldo_poczatek: 0, saldo_koniec: 0, wiersze: [] },
        saldo_poczatek: 0, saldo_koniec: -1550,
      })
    },
  },
}))

import { ZestawienieNaleznosciPrintPage } from './ZestawienieNaleznosciPrintPage'
import { HistoriaRozliczenPrintPage } from './HistoriaRozliczenPrintPage'

function renderuj(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/office/rozliczenia/:clientId/zestawienie/druk" element={<ZestawienieNaleznosciPrintPage />} />
        <Route path="/office/rozliczenia/:clientId/historia/druk" element={<HistoriaRozliczenPrintPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { stan.wywolania = []; stan.drukuj = 0 })
afterEach(cleanup)

describe('Zestawienie należności — kartka', () => {
  it('nagłówek: logo zakładu, firma z ustawień, tytuł, nabywca w ramce, dane dokumentu', async () => {
    const { LOGO_ZAKLADU } = await import('@/components/print/LogoZakladu')
    renderuj('/office/rozliczenia/c1/zestawienie/druk?pdf=1&na_dzien=2026-11-09')
    expect(await screen.findByRole('heading', { level: 1, name: 'Zestawienie należności' })).toBeTruthy()
    expect(stan.wywolania).toEqual([['zestawienie', 'c1', '2026-11-09']])
    const firma = screen.getByTestId('druk-firma')
    expect(firma.querySelector('img')!.getAttribute('src')).toBe(LOGO_ZAKLADU.src)
    expect(firma.textContent).toContain('Firma Testowa')
    expect(firma.textContent).toContain('NIP 1112223344')
    const nabywca = screen.getByTestId('druk-nabywca')
    expect(within(nabywca).getByText('Nabywca')).toBeTruthy()
    expect(within(nabywca).getByText('RONDO GRILL')).toBeTruthy()
    expect(within(nabywca).getByText('NIP DE123456789')).toBeTruthy()
    const dane = screen.getByTestId('druk-dane').textContent ?? ''
    expect(dane).toContain('Stan na dzień09.11.2026')
    expect(dane).toContain('WalutaEUR')
    // Tytuł tabelki nie powtarza nagłówka kartki.
    expect(screen.queryByText(/Stan rozliczeń na dzień/)).toBeNull()
  })

  it('tabela, panel „Razem do zapłaty”, stopka z kontaktem firmy i datą wydruku', async () => {
    renderuj('/office/rozliczenia/c1/zestawienie/druk?pdf=1&na_dzien=2026-11-09')
    await screen.findByRole('heading', { level: 1, name: 'Zestawienie należności' })
    expect(screen.getByText('Razem faktury')).toBeTruthy()
    // Osobna kartka zostaje przy „Razem do zapłaty” (spec 10.1).
    expect(screen.getByTestId('suma-razem').textContent).toBe('Razem do zapłaty16 722,20 €')
    // Zaległa faktura sprzed startu jak zwykły dokument, bez „saldo otwarcia”.
    const zalegla = screen.getByText('FV 431/2026').closest('tr')!
    expect(zalegla.textContent).toContain('28.08.2026')
    expect(zalegla.textContent).toContain('04.09.2026')
    expect(document.body.textContent).not.toMatch(/saldo otwarcia/i)
    const stopka = screen.getByTestId('druk-stopka').textContent ?? ''
    expect(stopka).toContain('Firma Testowa')
    expect(stopka).toContain('+48 600 100 200')
    expect(stopka).toContain('biuro@firma.test')
    expect(stopka).toMatch(/Wydrukowano \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/)
  })

  it('PDF (?pdf=1) nie woła okna drukarki; zwykłe otwarcie drukuje raz po wczytaniu', async () => {
    renderuj('/office/rozliczenia/c1/zestawienie/druk?pdf=1&na_dzien=2026-11-09')
    await screen.findByRole('heading', { level: 1, name: 'Zestawienie należności' })
    await new Promise(r => setTimeout(r, 400))
    expect(stan.drukuj).toBe(0)
    cleanup()
    renderuj('/office/rozliczenia/c1/zestawienie/druk?na_dzien=2026-11-09')
    await screen.findByRole('heading', { level: 1, name: 'Zestawienie należności' })
    await waitFor(() => expect(stan.drukuj).toBe(1), { timeout: 1500 })
  })
})

describe('Historia rozliczeń — kartka', () => {
  it('tytuł i okres, saldo otwarcia w kolumnie Wpłata, panel salda łącznie', async () => {
    const { container } = renderuj('/office/rozliczenia/c1/historia/druk?pdf=1&od=2026-11-01&do=2026-11-30')
    expect(await screen.findByRole('heading', { level: 1, name: 'Historia rozliczeń' })).toBeTruthy()
    expect(screen.getByTestId('druk-dane').textContent).toContain('Okres01.11.2026 – 30.11.2026')
    expect(stan.wywolania).toEqual([['historia', 'c1', '2026-11-01', '2026-11-30']])
    const otwarcie = screen.getByText('Saldo otwarcia').closest('tr')!
    const komorki = Array.from(otwarcie.querySelectorAll('td')).map(td => td.textContent)
    expect(komorki).toEqual(['09.11.2026', 'Saldo otwarcia', '', '2 000,00 zł', '2 000,00 zł', '–'])
    // Zaległa WZ sprzed startu: zwykły wiersz z numerem.
    expect(Array.from(screen.getByText('WZ/77/09/26').closest('tr')!.querySelectorAll('td')).map(td => td.textContent))
      .toEqual(['27.09.2026', 'WZ/77/09/26', '1 260,00 zł', '', '−1 260,00 zł', '–'])
    expect(screen.getByText('Saldo na początek okresu')).toBeTruthy()
    expect(screen.getByText('Saldo na koniec okresu')).toBeTruthy()
    expect(screen.getByTestId('saldo-lacznie').textContent).toBe('Saldo łącznie na 30.11.2026−1 550,00 zł')
    // Po terminie na koniec okresu: tylko WZ 9/11 — na czerwono, dni pogrubione.
    const po = container.querySelectorAll('tr[data-po-terminie="1"]')
    expect(po).toHaveLength(1)
    const wiersz = po[0] as HTMLElement
    expect(wiersz.textContent).toContain('WZ 9/11')
    expect(wiersz.style.color).toBe('rgb(176, 0, 32)')
    const dni = wiersz.lastElementChild as HTMLElement
    expect(dni.textContent).toBe('18')
    expect(dni.style.fontWeight).toBe('700')
    const naglDni = screen.getAllByText('Dni po terminie')[0] as HTMLElement
    expect(naglDni.style.whiteSpace).toBe('nowrap')
    // Saldo łączne ujemne, ale bez czerwieni — czerwień tylko dla zaległości.
    expect(screen.getByTestId('saldo-lacznie').style.color).toBe('')
    // Księga faktur bez ruchu i z zerem nie zaśmieca kartki.
    expect(screen.queryByText('Faktury')).toBeNull()
    expect(screen.getByTestId('druk-stopka').textContent).toContain('Wydrukowano')
  })
})
