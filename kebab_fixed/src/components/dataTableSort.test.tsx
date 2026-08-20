// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DataTable, type DataColumn } from './DataTable'

/**
 * Sortowanie startowe tabeli — po nim operator widzi to, czego szuka,
 * bez klikania w nagłówki.
 *
 * Magazyn surowca ma od 20.08.2026 startować od NAJWYŻSZEGO numeru partii
 * (najświeższe dostawy na górze). Numery są tekstem („501", „48U"), więc
 * porównanie musi być numeryczne — inaczej „99" stanęłoby nad „501".
 */

afterEach(cleanup)

interface Wiersz { id: string; partia: string }

const KOLUMNY: DataColumn<Wiersz>[] = [
  { key: 'batch', header: 'Partia', sortable: true,
    sortValue: r => r.partia, cell: r => r.partia },
]

const WIERSZE: Wiersz[] = [
  { id: '1', partia: '99' },
  { id: '2', partia: '501' },
  { id: '3', partia: '487' },
  { id: '4', partia: '1200' },
]

function kolejnosc(): string[] {
  return screen.getAllByText(/^(99|501|487|1200)$/).map(e => e.textContent ?? '')
}

describe('DataTable — sortowanie startowe', () => {
  it('malejąco po numerze partii stawia najwyższy na górze', () => {
    render(<DataTable<Wiersz> rows={WIERSZE} columns={KOLUMNY} rowKey={r => r.id}
                              initialSort={{ key: 'batch', dir: 'desc' }} />)
    expect(kolejnosc()).toEqual(['1200', '501', '487', '99'])
  })

  it('porównuje numery jak liczby, nie jak napisy', () => {
    // Po znakach „99" wygrałoby z „501" — a magazyn pokazałby najstarszą
    // partię jako najnowszą.
    render(<DataTable<Wiersz> rows={WIERSZE} columns={KOLUMNY} rowKey={r => r.id}
                              initialSort={{ key: 'batch', dir: 'desc' }} />)
    expect(kolejnosc()[0]).not.toBe('99')
  })
})
