// @vitest-environment jsdom
/**
 * WZ wewnętrzny (seria WM, Task 3) jedzie razem z fakturowanym WZ na TĘ SAMĄ
 * przesyłkę — istnieje wyłącznie po to, żeby stan ruszył dokładnie raz
 * (Task 4: ruch księgujemy na WM, nie na WZ). Wygląda identycznie jak zwykły
 * WZ i pokazuje CAŁĄ przesyłkę, łącznie z częścią, która nie jest na
 * fakturze — gdyby trafił do klienta zamiast dokumentu WZ, ujawniłby ilości
 * i ceny spoza faktury. Dopisek ma to uniemożliwić na pierwszy rzut oka,
 * zanim ktoś podepnie kartkę do palety.
 *
 * ZMIANA 22.09.2026: dopisek pokazuje się TYLKO przy wysyłce z podziałem.
 * Właściciel: „WM nie pisz na czerwono, że nie dla klienta — czasem
 * chciałbym dać klientowi papier, bo fakturę wystawiamy dopiero za kilka
 * dni". Gdy CAŁOŚĆ idzie na fakturę, WM nie ukrywa niczego i ostrzeżenie
 * jest hałasem. Warunek (`ukrywa_czesc_poza_faktura`) liczy backend po
 * istnieniu WZ dla klienta — ten powstaje wyłącznie przy podziale.
 * Pierwotna troska zostaje nietknięta tam, gdzie jest realna.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WzDocumentView, WzDocData } from './WzDocumentView'

afterEach(cleanup)

const DOC: WzDocData = {
  number: 'WZ/1/09/26',
  place: 'Wrocław',
  issued_date: '2026-09-10',
  release_date: '2026-09-10',
  seller: { name: 'FHUP Marek Księżyc', address: 'ul. Przykładowa 1', nip: '1234567890' },
  buyer_name: 'ODBIORCA SP. Z O.O.',
  buyer_address: 'ul. Testowa 2',
  buyer_nip: '9876543210',
  valued: false,
  lines: [
    { name: 'Kebab wołowy', qty: 10, unit: 'szt', price: null, value: null, total_kg: 250 },
  ],
}

describe('WzDocumentView — dopisek dokumentu wewnętrznego (seria WM)', () => {
  it('WM z wysylki Z PODZIALEM: „Wydanie zewnętrzne”, bez czerwonego paska (właściciel 14.11.2026)', () => {
    // „WM zawiera wszystko, co wyszło z magazynu; WZ to dokument dla klienta do zapłaty”
    // — WM drukuje się jak zwykłe wydanie zewnętrzne, bez dopisku „nie dla klienta”.
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WM', number: 'WM/1/09/26',
                                  ukrywa_czesc_poza_faktura: true }} />)
    expect(screen.queryByText(/DOKUMENT WEWNĘTRZNY|NIE WYDAWAĆ/i)).toBeNull()
    expect(document.body.textContent).toMatch(/Wydanie zewnętrzne\s+WM\/1\/09\/26/)
    expect(screen.queryByText(/WZ — Wydanie/)).toBeNull()
  })

  it('WM przy CALOSCI na fakture dopisku NIE ma — nie ukrywa niczego', () => {
    // Przypadek FUDI z 22.09: 150 zamowione, 150 na fakture, 0 poza.
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WM', number: 'WM/9/09/26',
                                  ukrywa_czesc_poza_faktura: false }} />)
    expect(screen.queryByText(/DOKUMENT WEWNĘTRZNY/i)).toBeNull()
  })

  it('brak flagi = brak dopisku — bezpieczny domysl dla starych dokumentow', () => {
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WM', number: 'WM/1/09/26' }} />)
    expect(screen.queryByText(/DOKUMENT WEWNĘTRZNY/i)).toBeNull()
  })

  it('zwykly WZ dopisku NIE ma', () => {
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WZ', number: 'WZ/1/09/26' }} />)
    expect(screen.queryByText(/DOKUMENT WEWNĘTRZNY/i)).toBeNull()
  })

  it('dokument bez doc_series (sprzed serii WM) nie ma dopisku', () => {
    render(<WzDocumentView doc={DOC} />)
    expect(screen.queryByText(/DOKUMENT WEWNĘTRZNY/i)).toBeNull()
  })
})

describe('WzDocumentView — logo zakładu', () => {
  it('logo ze wspólnej stałej (inny zakład podmienia jedno miejsce)', async () => {
    const { LOGO_ZAKLADU } = await import('@/components/print/LogoZakladu')
    const { container } = render(<WzDocumentView doc={DOC} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe(LOGO_ZAKLADU.src)
    expect(img.getAttribute('alt')).toBe(LOGO_ZAKLADU.alt)
  })
})

describe('WzDocumentView — wariant A (właściciel 14.11.2026)', () => {
  it('duże pola na pieczątkę i podpis wystawiającego oraz odbiorcy', () => {
    render(<WzDocumentView doc={DOC} />)
    expect(screen.getByText('Pieczątka i podpis wystawiającego')).toBeTruthy()
    expect(screen.getByText('Data, pieczątka i podpis odbiorcy')).toBeTruthy()
    const pole = screen.getByTestId('pole-podpisu-wystawiajacy')
    expect(parseInt(pole.style.height)).toBeGreaterThanOrEqual(90)
  })
  it('bez szarych pasów sekcji — etykiety „Sprzedawca” i „Nabywca” nad danymi', () => {
    const { container } = render(<WzDocumentView doc={DOC} />)
    expect(screen.getByText('Sprzedawca')).toBeTruthy()
    expect(screen.getByText('Nabywca')).toBeTruthy()
    expect(container.innerHTML).not.toContain('#d7d7d7')
  })
})

describe('WzDocumentView — kwoty', () => {
  it('spacja tysięcy także w kwotach 4-cyfrowych', () => {
    render(<WzDocumentView doc={{ ...DOC, valued: true, total_value: 8520, lines: [{ name: 'KEBAB', qty: 20, unit: 'szt', total_kg: 600, price: 14.2, value: 8520, vat_rate: 5 }] }} />)
    expect(screen.getAllByText(/8\s520,00/).length).toBeGreaterThan(0)
  })
})
