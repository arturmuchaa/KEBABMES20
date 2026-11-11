// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const stan = vi.hoisted(() => ({ wywolania: [] as unknown[][], drukuj: 0 }))
vi.mock('@/lib/print', () => ({ drukuj: () => { stan.drukuj += 1 } }))
vi.mock('@/lib/api', () => ({
  settingsApi: {
    getCompany: () => Promise.resolve({ name: 'Firma Testowa', address: 'Zakładowa 1',
                                        postalCode: '00-001', city: 'Miasto', nip: '1112223344' }),
  },
  rozliczeniaApi: {
    zestawienie: (...a: unknown[]) => {
      stan.wywolania.push(['zestawienie', ...a])
      return Promise.resolve({
        klient: { nazwa: 'ROJPAK', nip: 'DE123456789', adres: 'Hauptstr. 1, Berlin' },
        waluta: 'EUR', na_dzien: '2026-11-09', policzono: '2026-11-09T10:00:00',
        wz: { pozycje: [], razem: 0 },
        fv: { pozycje: [{ numer: '541', data: '2026-11-03', termin: '2026-11-10', kwota: 12342.2,
                          zaplacono: 0, pozostalo: 12342.2, dni_po_terminie: 0, ten_dokument: false }],
              razem: 12342.2 },
        razem: 12342.2, po_terminie: 0, nadplata_wz: 0, nadplata_fv: 0,
      })
    },
    historia: (...a: unknown[]) => {
      stan.wywolania.push(['historia', ...a])
      return Promise.resolve({
        klient: { nazwa: 'ROJPAK', nip: '', adres: '' }, waluta: 'PLN',
        od: '2026-11-01', do: '2026-11-30',
        wz: { saldo_poczatek: 0, saldo_koniec: -1550, wiersze: [
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
  it('nagłówek firmy z ustawień, kontrahent i tabelka salda na dzień', async () => {
    renderuj('/office/rozliczenia/c1/zestawienie/druk?pdf=1&na_dzien=2026-11-09')
    expect(await screen.findByText('Zestawienie należności')).toBeTruthy()
    expect(stan.wywolania).toEqual([['zestawienie', 'c1', '2026-11-09']])
    expect(screen.getByTestId('druk-firma').textContent).toContain('Firma Testowa')
    expect(screen.getByText('ROJPAK')).toBeTruthy()
    expect(screen.getByText('NIP DE123456789')).toBeTruthy()
    expect(screen.getByText('Razem faktury')).toBeTruthy()
    // Osobna kartka zostaje przy „Razem do zapłaty” (spec 10.1).
    expect(document.body.textContent).toContain('Razem do zapłaty')
  })
})

describe('Historia rozliczeń — kartka', () => {
  it('tytuł z okresem, saldo otwarcia w kolumnie Wpłata, saldo łącznie', async () => {
    const { container } = renderuj('/office/rozliczenia/c1/historia/druk?pdf=1&od=2026-11-01&do=2026-11-30')
    expect(await screen.findByText('Historia rozliczeń 01.11.2026 – 30.11.2026')).toBeTruthy()
    expect(stan.wywolania).toEqual([['historia', 'c1', '2026-11-01', '2026-11-30']])
    const otwarcie = screen.getByText('Saldo otwarcia').closest('tr')!
    const komorki = Array.from(otwarcie.querySelectorAll('td')).map(td => td.textContent)
    expect(komorki).toEqual(['09.11.2026', 'Saldo otwarcia', '', '2 000,00 zł', '2 000,00 zł', '–'])
    expect(screen.getByText('Saldo na początek okresu')).toBeTruthy()
    expect(screen.getByText('Saldo na koniec okresu')).toBeTruthy()
    expect(container.textContent).toContain('Saldo łącznie na 30.11.2026: \u22121 550,00 zł')
    // Po terminie na koniec okresu: tylko WZ 9/11 — na czerwono, dni pogrubione.
    const po = container.querySelectorAll('tr[data-po-terminie="1"]')
    expect(po).toHaveLength(1)
    const wiersz = po[0] as HTMLElement
    expect(wiersz.textContent).toContain('WZ 9/11')
    expect(wiersz.style.color).toBe('rgb(176, 0, 32)')
    const dni = wiersz.lastElementChild as HTMLElement
    expect(dni.textContent).toBe('18')
    expect(dni.style.fontWeight).toBe('700')
    const naglDni = screen.getByText('Dni po terminie') as HTMLElement
    expect(naglDni.style.whiteSpace).toBe('nowrap')
    // Księga faktur bez ruchu i z zerem nie zaśmieca kartki.
    expect(screen.queryByText('Faktury')).toBeNull()
  })
})
