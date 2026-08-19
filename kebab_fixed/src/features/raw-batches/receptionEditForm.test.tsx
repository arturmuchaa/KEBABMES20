// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReceptionForm } from './components/ReceptionForm'
import { documentToForm } from './receptionEditView'

/**
 * Formularz edycji MUSI wystartować z treścią zapisanej dostawy.
 *
 * Prod 2026-08-19: edycja otwierała PUSTY formularz. Zasianie danych działało,
 * ale zaraz po nim wykonywał się reset z czasów okna modalnego
 * (`setLines([emptyLine()])`) i kasował wczytaną dostawę. Testy czystej logiki
 * tego nie widziały — błąd siedział w KOLEJNOŚCI efektów, nie w mapowaniu.
 */

vi.mock('@/lib/apiClient', () => ({
  receptionsApi: { nextNumber: vi.fn(), attachHdiScan: vi.fn(), hdiScanUrl: () => '' },
}))
vi.mock('@/lib/desktopScanner', () => ({
  isDesktopApp: () => false,
  scanDocument: vi.fn(),
  scannerDiagnose: vi.fn(),
  errorText: (e: unknown) => String(e),
}))

const REC = {
  id: 'rec1', receptionNo: '27/08', receivedDate: '2026-08-19',
  supplierId: 'sup1', documentNo: 'WZ 728/MDU/08/2026', hdiNo: '33836', notes: '',
  batches: [
    { id: 'b1', internalBatchNo: '493', kgReceived: 4800, pricePerKg: 5.4,
      materialTypeId: 'mat-cwiartka', containerKg: 15, containersCount: 317,
      palletsH1: 17, supplierBatches: [
        { supplierBatchNo: 'A-1', kg: 4800, slaughterDate: '2026-08-18', expiryDate: '2026-08-25' }] },
    { id: 'b2', internalBatchNo: '494', kgReceived: 4200, pricePerKg: 5.4,
      materialTypeId: 'mat-cwiartka', supplierBatches: [] },
  ],
} as any

function pokazFormularz() {
  const { header, groups, frozen } = documentToForm(REC)
  render(
    <ReceptionForm
      mode="edit"
      initialGroups={groups}
      frozen={frozen}
      header={header}
      onClose={() => {}}
      onSubmit={() => {}}
      suggestedReceptionNo={header.receptionNo}
      suggestedBatchNo=""
      supplierOptions={[{ value: 'sup1', label: 'KOKO' }]}
      loading={false}
      error={null}
      onHeaderChange={() => {}}
    />,
  )
}

// Bez `globals: true` RTL nie sprząta sam — kolejne render() zostawiałyby
// poprzedni formularz w DOM i zapytania trafiałyby na dwa wyniki naraz.
afterEach(cleanup)

describe('ReceptionForm w trybie edycji', () => {
  it('startuje z pozycjami zapisanej dostawy, a nie z pustym wierszem', () => {
    pokazFormularz()
    expect(screen.getByDisplayValue('A-1')).toBeTruthy()
  })

  it('pokazuje wagę obu numerów porządkowych — także tego bez pozycji HDI', () => {
    pokazFormularz()
    // 4200 kg numeru 494 siedzi w wierszu zastępczym; bez niego pozycja
    // wróciłaby z formularza z zerem.
    expect(screen.getByDisplayValue('4800')).toBeTruthy()
    expect(screen.getByDisplayValue('4200')).toBeTruthy()
  })

  it('pokazuje numery porządkowe NADANE dostawie, nie kolejne od jedynki', () => {
    // Zgłoszenie z produkcji: edycja pokazywała „#1, #2" zamiast 493 i 494.
    // Numery brały się z podpowiedzi sekwencji, której w edycji nie ma —
    // a to numery fizycznie nadane stosom w chłodni.
    pokazFormularz()
    expect(screen.getAllByText('493').length).toBeGreaterThan(0)
    expect(screen.getAllByText('494').length).toBeGreaterThan(0)
    expect(screen.queryByText('#1')).toBeNull()
  })

  it('wczytuje ręcznie policzone pojemniki, a nie wylicza ich od nowa', () => {
    // 317 to liczba PRZELICZONA na rampie; z kalibru 15 kg wyszłoby 320.
    // Nośniki to saldo wobec dostawcy — zapis edycji z wyliczoną liczbą
    // przeksięgowałby różnicę bez powodu.
    pokazFormularz()
    expect(screen.getByDisplayValue('317')).toBeTruthy()
  })

  it('mówi wprost, że to edycja, a nie nowe przyjęcie', () => {
    pokazFormularz()
    // Nagłówek bywa też w podtytule — wystarczy, że napis w ogóle jest.
    expect(screen.getAllByText(/Edycja dostawy 27\/08/).length).toBeGreaterThan(0)
  })
})
