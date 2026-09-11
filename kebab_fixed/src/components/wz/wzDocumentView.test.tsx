// @vitest-environment jsdom
/**
 * WZ wewnętrzny (seria WM, Task 3) jedzie razem z fakturowanym WZ na TĘ SAMĄ
 * przesyłkę — istnieje wyłącznie po to, żeby stan ruszył dokładnie raz
 * (Task 4: ruch księgujemy na WM, nie na WZ). Wygląda identycznie jak zwykły
 * WZ i pokazuje CAŁĄ przesyłkę, łącznie z częścią, która nie jest na
 * fakturze — gdyby trafił do klienta zamiast dokumentu WZ, ujawniłby ilości
 * i ceny spoza faktury. Dopisek ma to uniemożliwić na pierwszy rzut oka,
 * zanim ktoś podepnie kartkę do palety.
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
  it('WZ wewnetrzny ma dopisek, ze nie wychodzi do klienta', () => {
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WM', number: 'WM/1/09/26' }} />)
    expect(screen.getByText(/DOKUMENT WEWNĘTRZNY/i)).toBeTruthy()
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
