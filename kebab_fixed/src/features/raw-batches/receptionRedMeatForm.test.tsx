// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReceptionForm } from './components/ReceptionForm'
import type { ReceptionHeader } from './types'

/**
 * Mięso czerwone w formularzu przyjęcia.
 *
 * Wołowina przychodzi ze ZBIORCZEJ zakładki („Mięso czerwone"), która nie
 * przesądza ani rodzaju (pięć: 80/20, zrazowa, mostek, dwa łoje), ani stanu.
 * Oba wybiera się dopiero tutaj — i to jedyne miejsce, gdzie operator widzi,
 * do ilu stopni wolno mu przyjąć dostawę.
 *
 * Drób nie ma tych pól WCALE: rodzaj daje mu zakładka, a formularz przyjęcia
 * biuro wypełnia ~45 razy w miesiącu i puste pole zawsze z tą samą wartością
 * jest tam tylko zaproszeniem do pomyłki.
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

const CZERWONE = [
  { id: 'mat-wolowina-8020', name: 'Wołowina 80/20', requiresDeboning: false, receivable: true, category: 'czerwone' },
  { id: 'mat-loj-otokowy',   name: 'Łój wołowy otokowy', requiresDeboning: false, receivable: true, category: 'czerwone' },
]

function header(over: Partial<ReceptionHeader> = {}): ReceptionHeader {
  return {
    receptionNo: '5/08', receivedDate: '2026-08-30', supplierId: 'sup1',
    materialTypeId: 'mat-wolowina-8020', documentNo: '', hdiNo: '', hdiScanId: '',
    docKg: 0, docContainers: 0, pricePerKg: 18, containerKg: 15,
    palletsH1: 0, palletsOther: 0, palletsOtherKind: 'net_e1',
    isService: false, storageState: 'chlodzony', notes: '',
    ...over,
  }
}

function pokaz(over: Partial<ReceptionHeader> = {}, choices = CZERWONE) {
  render(
    <ReceptionForm
      header={header(over)}
      materialChoices={choices}
      onClose={() => {}}
      onSubmit={() => {}}
      suggestedReceptionNo="5/08"
      suggestedBatchNo="520"
      supplierOptions={[{ value: 'sup1', label: 'ZM WOŁOWINA' }]}
      loading={false}
      error={null}
      onHeaderChange={() => {}}
    />,
  )
}

afterEach(cleanup)

describe('Przyjęcie mięsa czerwonego', () => {
  it('pyta o rodzaj, bo zbiorcza zakładka go nie rozstrzyga', () => {
    pokaz()
    expect(screen.getByText('Rodzaj surowca')).toBeTruthy()
    expect(screen.getByText('Wołowina 80/20')).toBeTruthy()
  })

  it('pyta o stan dostawy', () => {
    pokaz()
    expect(screen.getByText('Stan')).toBeTruthy()
  })

  it('chłodzona wołowina: próg +7 °C i magazyn nr 3', () => {
    pokaz()
    expect(screen.getByText('≤ +7 °C')).toBeTruthy()
    expect(screen.getByText(/Magazyn nr 3/)).toBeTruthy()
  })

  it('blok mrożony: próg −12 °C i magazyn nr 6', () => {
    pokaz({ storageState: 'mrozony' })
    expect(screen.getByText('≤ −12 °C')).toBeTruthy()
    expect(screen.getByText(/Magazyn nr 6/)).toBeTruthy()
  })

  it('przy mrożonym mówi wprost, że progu nie ma w instrukcji 1.1', () => {
    // Karta nie może przypisywać księdze zdania, którego w niej nie ma —
    // dopóki szef nie dopisze progu dla mrożonego, to założenie zakładowe.
    pokaz({ storageState: 'mrozony' })
    expect(screen.getByText(/instrukcja 1\.1 nie podaje progu/)).toBeTruthy()
  })

  it('drób nie widzi ani rodzaju, ani stanu — to formularz na 45 dostaw', () => {
    pokaz({ materialTypeId: 'mat-cwiartka' }, [])
    expect(screen.queryByText('Rodzaj surowca')).toBeNull()
    expect(screen.queryByText('Stan')).toBeNull()
  })
})

/**
 * Wejście BEZ zakładki — „Nowe przyjęcie" z zakładki „Wszystko".
 *
 * Formularz dostawał wtedy pustą listę rodzajów i cicho startował na
 * ćwiartce: pól mięsa czerwonego nie było w ogóle, mimo że komentarz na
 * liście obiecywał, że „tam rodzaj się wybiera". Biuro zgłosiło to
 * 31.08.2026 jako „zniknęły opcje temperatury" — bo próg widać tylko razem
 * z tymi polami.
 */
describe('ReceptionForm — wejście bez wskazanej zakładki', () => {
  afterEach(cleanup)

  const WSZYSTKIE = [
    { id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true,
      receivable: true, category: 'drob' },
    ...CZERWONE,
  ]

  it('pozwala wybrać rodzaj z PEŁNEJ listy, także drób', () => {
    pokaz({ materialTypeId: 'mat-cwiartka' }, WSZYSTKIE)
    expect(screen.getByText('Rodzaj surowca')).toBeTruthy()
  })

  it('przy wybranym DROBIU nie pokazuje stanu dostawy', () => {
    // Drób jeździ wyłącznie chłodzony — pole zawsze z tą samą wartością
    // to zaproszenie do pomyłki.
    pokaz({ materialTypeId: 'mat-cwiartka' }, WSZYSTKIE)
    expect(screen.queryByText('Stan')).toBeNull()
  })

  it('przy wybranym DROBIU próg to +4 °C, nie +7 °C', () => {
    pokaz({ materialTypeId: 'mat-cwiartka' }, WSZYSTKIE)
    expect(screen.getByText(/≤ \+4 °C/)).toBeTruthy()
  })

  it('po wybraniu WOŁOWINY wraca stan i próg +7 °C', () => {
    pokaz({ materialTypeId: 'mat-wolowina-8020' }, WSZYSTKIE)
    expect(screen.getByText('Stan')).toBeTruthy()
    expect(screen.getByText(/≤ \+7 °C/)).toBeTruthy()
  })

  it('kategoria idzie z WYBRANEGO rodzaju, nie z długości listy', () => {
    // Sedno regresji: „są opcje" nie znaczy „to wołowina".
    pokaz({ materialTypeId: 'mat-cwiartka' }, WSZYSTKIE)
    expect(screen.queryByText(/≤ \+7 °C/)).toBeNull()
  })
})
