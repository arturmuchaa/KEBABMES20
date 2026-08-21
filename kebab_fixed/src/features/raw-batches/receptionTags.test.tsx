// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { ReceptionTags } from './components/ReceptionTags'

/**
 * Ekran zawieszek liczy, ILE etykiet biuro ma wydrukować na przyjętą dostawę.
 * Operator zmienia tu kaliber i układ palety, a liczby muszą przeliczyć się
 * na oczach — pomyłka to albo brakująca zawieszka na palecie w chłodni, albo
 * stos wydruków do wyrzucenia.
 */

// Dostawa 12/08/2026: 9000 kg w dwóch numerach porządkowych (3000 + 6000).
const REC = {
  id: 'rec1', receptionNo: '12/08/2026', receivedDate: '2026-08-12',
  supplierId: 'sup1', supplierName: 'KOKO Sp. z o.o.',
  documentNo: '', hdiNo: '', hdiScan: '', notes: '', kgTotal: 9000,
  batches: [
    { id: 'b1', internalBatchNo: '471', kgReceived: 3000, containerKg: 15,
      slaughterDate: '2026-08-04', expiryDate: '2026-08-18' },
    { id: 'b2', internalBatchNo: '472', kgReceived: 6000, containerKg: 15,
      slaughterDate: '2026-08-04', expiryDate: '2026-08-18' },
  ],
} as any

function pokaz(props: Partial<React.ComponentProps<typeof ReceptionTags>> = {}) {
  const onPrint = vi.fn()
  render(
    <ReceptionTags
      reception={props.reception ?? REC}
      defaultContainersPerPallet={props.defaultContainersPerPallet ?? 36}
      onPrint={props.onPrint ?? onPrint}
      onRememberLayout={props.onRememberLayout ?? vi.fn()}
      onClose={() => {}}
    />,
  )
  return { onPrint }
}

afterEach(cleanup)

describe('ReceptionTags — ile zawieszek na dostawę', () => {
  it('liczy zawieszki osobno dla każdego numeru porządkowego', () => {
    pokaz()
    // 3000 kg / 15 = 200 poj. → 5 pełnych palet + reszta 20 = 6 zawieszek
    expect(screen.getByLabelText('Zawieszek 471').textContent).toBe('6')
    // 6000 kg / 15 = 400 poj. → 11 pełnych palet + reszta 4 = 12 zawieszek
    expect(screen.getByLabelText('Zawieszek 472').textContent).toBe('12')
  })

  it('pokazuje pełne palety i resztę, żeby biuro mogło sprawdzić rachunek', () => {
    pokaz()
    expect(screen.getByLabelText('Palety 471').textContent).toContain('5')
    expect(screen.getByLabelText('Palety 471').textContent).toContain('20')
  })

  it('podaje sumę zawieszek do wydrukowania na całą dostawę', () => {
    pokaz()
    expect(screen.getByLabelText('Zawieszek razem').textContent).toBe('18')
  })

  it('zmiana układu palety przelicza zawieszki od razu', () => {
    pokaz()
    fireEvent.change(screen.getByLabelText('Pojemników na palecie 471'), { target: { value: '32' } })
    // 200 poj. / 32 = 6 pełnych + reszta 8 → 7 zawieszek
    expect(screen.getByLabelText('Zawieszek 471').textContent).toBe('7')
    expect(screen.getByLabelText('Zawieszek 472').textContent).toBe('12')
  })

  it('zmiana kalibru przelicza pojemniki, a nie tylko wagę', () => {
    pokaz()
    fireEvent.change(screen.getByLabelText('Kaliber 471'), { target: { value: '20' } })
    // 3000 / 20 = 150 poj. → 4 pełne palety + reszta 6 → 5 zawieszek
    expect(screen.getByLabelText('Pojemników 471').textContent).toBe('150')
    expect(screen.getByLabelText('Zawieszek 471').textContent).toBe('5')
  })

  it('startuje z układem zapamiętanym dla dostawcy', () => {
    pokaz({ defaultContainersPerPallet: 32 })
    expect((screen.getByLabelText('Pojemników na palecie 471') as HTMLInputElement).value).toBe('32')
    expect(screen.getByLabelText('Zawieszek 471').textContent).toBe('7')
  })

  it('druk oddaje gotowe zawieszki z numerem palety i wagą', () => {
    const { onPrint } = pokaz()
    fireEvent.click(screen.getByLabelText('Drukuj 471'))

    const tags = onPrint.mock.calls[0][0]
    expect(tags).toHaveLength(6)
    expect(tags[0]).toMatchObject({ batchNo: '471', palletIndex: 1, containers: 36, netKg: 540 })
    expect(tags[5]).toMatchObject({ palletIndex: 6, containers: 20, netKg: 300, full: false })
    expect(tags[0].receptionNo).toBe('12/08/2026')
    expect(tags[0].supplierName).toBe('KOKO Sp. z o.o.')
    expect(tags[0].receivedDate).toBe('2026-08-12')
  })

  it('druk całej dostawy idzie jednym ciągiem, numer po numerze', () => {
    const { onPrint } = pokaz()
    fireEvent.click(screen.getByLabelText('Drukuj wszystkie'))

    const tags = onPrint.mock.calls[0][0]
    expect(tags).toHaveLength(18)
    expect(tags[0].batchNo).toBe('471')
    expect(tags[17].batchNo).toBe('472')
  })

  it('ręcznie przeliczony stos wchodzi jako liczba wyjściowa', () => {
    pokaz({ reception: { ...REC, batches: [{ ...REC.batches[0], containersCount: 199 }] } })
    expect(screen.getByLabelText('Pojemników 471').textContent).toBe('199')
  })

  it('surowiec bez kalibru mówi wprost, czego brakuje, zamiast drukować zero', () => {
    pokaz({ reception: { ...REC, batches: [{ ...REC.batches[0], containerKg: null }] } })
    expect(screen.getByLabelText('Zawieszek 471').textContent).toBe('—')
    expect(screen.getByText(/Uzupełnij kaliber/)).toBeTruthy()
  })

  it('anulowany numer porządkowy nie dostaje zawieszek', () => {
    pokaz({ reception: { ...REC, batches: [REC.batches[0], { ...REC.batches[1], status: 'cancelled' }] } })
    expect(screen.queryByLabelText('Zawieszek 472')).toBeNull()
    expect(screen.getByLabelText('Zawieszek razem').textContent).toBe('6')
  })

  it('podgląd pokazuje DOKŁADNIE to, co pójdzie na taśmę', () => {
    // Podgląd rysowany osobno od ZPL rozjeżdżał się z wydrukiem przy
    // pierwszej zmianie formatu liczb („3000,0 kg" na ekranie, „3000 kg"
    // na etykiecie) — biuro decyduje z niego o wypuszczeniu stosu etykiet.
    pokaz()
    expect(screen.getByText('PALETA 1 / 6')).toBeTruthy()
    expect(screen.getByText('z partii 3000 kg')).toBeTruthy()
    expect(screen.getByText('36 poj. x 15 kg')).toBeTruthy()
  })

  it('preset układa całą dostawę tak samo jednym kliknięciem', () => {
    pokaz()
    fireEvent.click(screen.getByLabelText('Układ 8 na warstwę'))
    expect(screen.getByLabelText('Zawieszek 471').textContent).toBe('7')
    expect(screen.getByLabelText('Zawieszek 472').textContent).toBe('13')
  })

  it('zapamiętanie układu dla dostawcy wysyła liczbę z ekranu', () => {
    const onRememberLayout = vi.fn()
    pokaz({ onRememberLayout })
    fireEvent.change(screen.getByLabelText('Pojemników na palecie 471'), { target: { value: '32' } })
    fireEvent.click(screen.getByLabelText('Zapamiętaj układ dla dostawcy'))
    expect(onRememberLayout).toHaveBeenCalledWith(32)
  })
})
