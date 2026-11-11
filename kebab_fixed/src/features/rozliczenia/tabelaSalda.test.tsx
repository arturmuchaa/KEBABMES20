// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TabelaSalda } from './TabelaSalda'
import type { Zestawienie } from './druk'

/** Zestawienie ROJPAK na 09.11.2026 — te same liczby co backend (Task 6). */
const ROJPAK: Zestawienie = {
  klient: { nazwa: 'ROJPAK', nip: 'DE123456789', adres: '' },
  waluta: 'EUR', na_dzien: '2026-11-09', policzono: '2026-11-09T10:00:00',
  wz: {
    pozycje: [
      { numer: 'WZ 21/10', data: '2026-10-27', termin: '2026-10-27', kwota: 6120,
        zaplacono: 3000, pozostalo: 3120, dni_po_terminie: 13, ten_dokument: false },
      { numer: 'WZ 02/11', data: '2026-11-03', termin: '2026-11-03', kwota: 5289.5,
        zaplacono: 0, pozostalo: 5289.5, dni_po_terminie: 6, ten_dokument: true },
    ],
    razem: 8409.5,
  },
  fv: {
    pozycje: [
      { numer: '528', data: '2026-10-27', termin: '2026-11-03', kwota: 14280,
        zaplacono: 7000, pozostalo: 7280, dni_po_terminie: 6, ten_dokument: false },
      { numer: '541', data: '2026-11-03', termin: '2026-11-10', kwota: 12342.2,
        zaplacono: 0, pozostalo: 12342.2, dni_po_terminie: 0, ten_dokument: false },
      { numer: '553', data: '2026-11-08', termin: '2026-11-15', kwota: 10416,
        zaplacono: 0, pozostalo: 10416, dni_po_terminie: 0, ten_dokument: false },
    ],
    razem: 30038.2,
  },
  razem: 38447.7, po_terminie: 15689.5, nadplata_wz: 0, nadplata_fv: 0,
}

const PUSTE: Zestawienie = {
  ...ROJPAK, waluta: 'PLN',
  wz: { pozycje: [], razem: 0 }, fv: { pozycje: [], razem: 0 },
  razem: 0, po_terminie: 0, nadplata_wz: 0, nadplata_fv: 0,
}

afterEach(cleanup)

describe('TabelaSalda — ROJPAK', () => {
  it('nagłówek, pozycje i kwoty w walucie klienta', () => {
    render(<TabelaSalda z={ROJPAK} />)
    expect(screen.getByText(/Stan rozliczeń na dzień 09\.11\.2026 — dokumenty niezapłacone/)).toBeTruthy()
    expect(screen.getByText('WZ 21/10')).toBeTruthy()
    expect(screen.getByText('3 120,00 €')).toBeTruthy()
    expect(screen.getByText('Razem WZ')).toBeTruthy()
    expect(screen.getByText('Razem faktury')).toBeTruthy()
    expect(screen.getAllByRole('table')).toHaveLength(2)
  })

  it('stopka sum: razem do zapłaty i w tym po terminie', () => {
    const { container } = render(<TabelaSalda z={ROJPAK} />)
    const tekst = container.textContent ?? ''
    expect(tekst).toContain('Razem do zapłaty: 38 447,70 €')
    expect(tekst).toContain('W tym po terminie: 15 689,50 €')
  })

  it('dokładnie trzy wiersze po terminie, na czerwono', () => {
    const { container } = render(<TabelaSalda z={ROJPAK} />)
    const po = container.querySelectorAll('tr[data-po-terminie="1"]')
    expect(po).toHaveLength(3)
    po.forEach(tr => expect((tr as HTMLElement).style.color).toBe('rgb(176, 0, 32)'))
  })

  it('FV 541 w terminie pokazuje kreskę zamiast dni', () => {
    render(<TabelaSalda z={ROJPAK} />)
    const wiersz = screen.getByText('541').closest('tr')!
    expect(wiersz.getAttribute('data-po-terminie')).toBeNull()
    expect(wiersz.lastElementChild!.textContent).toBe('–')
  })

  it('drukowana WZ ma dopisek (ten dokument)', () => {
    render(<TabelaSalda z={ROJPAK} />)
    expect(screen.getByText('WZ 02/11').closest('td')!.textContent).toContain('(ten dokument)')
  })

  it('stopka o zaksięgowanych wpłatach', () => {
    const { container } = render(<TabelaSalda z={ROJPAK} />)
    expect(container.textContent).toContain(
      'Wpłaty zaksięgowane do 09.11.2026. Jeżeli zapłacili Państwo w ostatnich dniach, prosimy uznać zestawienie za nieaktualne.')
  })
})

describe('TabelaSalda — bez należności', () => {
  it('jedna linia podziękowania i żadnej tabeli', () => {
    const { container } = render(<TabelaSalda z={PUSTE} />)
    expect(screen.getByText('Brak należności — dziękujemy')).toBeTruthy()
    expect(container.querySelector('table')).toBeNull()
  })

  it('nadpłata zamiast podziękowania', () => {
    const { container } = render(<TabelaSalda z={{ ...PUSTE, nadplata_wz: 350 }} />)
    expect(container.textContent).toContain('Nadpłata (WZ): 350,00 zł')
    expect(container.textContent).not.toContain('Brak należności')
  })

  it('pokazuje tylko tabelę, która ma pozycje', () => {
    render(<TabelaSalda z={{ ...ROJPAK, fv: { pozycje: [], razem: 0 } }} />)
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByText('Razem faktury')).toBeNull()
  })
})
