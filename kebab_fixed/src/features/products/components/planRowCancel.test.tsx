// @vitest-environment jsdom
/**
 * Anulowanie zlecenia masowania z planu.
 *
 * 30.08.2026 (niedziela) dwa zlecenia z planu na ten dzień zostały nietknięte
 * i zamroziły 7 000 kg mięsa z partii 512/513/514. Plan miniony jest
 * read-only, a „Potwierdź" pokazuje się tylko dla dnia dzisiejszego — biuro
 * nie miało ŻADNEGO przycisku i jedyną drogą było odmrożenie rezerwacji
 * w bazie produkcyjnej.
 *
 * Potwierdzenie nie było wyjściem: rozchodowałoby mięso i przyprawy za
 * masowanie, którego nie było.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Wiersz rysuje układ desktop I mobile naraz (przełączane CSS-em), więc każdy
// przycisk jest w DOM dwa razy. Bierzemy pierwszy — oba wołają to samo.
const anulujBtn = () => screen.getAllByTestId('zlecenie-anuluj')[0]
const brakAnuluj = () => screen.queryAllByTestId('zlecenie-anuluj').length === 0

vi.mock('./MeatLotPicker', () => ({ MeatLotPicker: () => null }))
vi.mock('./IngredientPreview', () => ({ IngredientPreview: () => null }))

import { PlanRow, type PlanRowData } from './PlanRow'

const wiersz = (over: Partial<PlanRowData> = {}): PlanRowData => ({
  rowKey: 'k1', id: 'mo-1', recipeId: 'r1', meatKg: '4000',
  status: 'confirmed', kgDone: 0, lots: [], ...over,
})

const rysuj = (row: PlanRowData, over: any = {}) => {
  const onCancelOrder = vi.fn()
  render(
    <PlanRow
      row={row} index={0} total={1}
      recipes={[{ id: 'r1', name: 'BEYAZ AFIYET' }] as any}
      lots={[]} liveFree={new Map()} output={0} expanded={false}
      onUpdate={() => {}} onMove={() => {}} onDelete={() => {}}
      onToggle={() => {}} onAutoFefoRow={() => {}}
      onConfirmExecution={() => {}} onUndoConfirm={() => {}}
      onCancelOrder={onCancelOrder}
      confirmingExecution={false} canConfirmExecution
      showConfirmExecution={false}
      dragHandlers={{ draggable: false, onDragStart: () => {}, onDragOver: () => {},
                      onDrop: () => {}, onDragEnd: () => {} } as any}
      {...over}
    />,
  )
  return onCancelOrder
}

describe('PlanRow — anulowanie zlecenia', () => {
  afterEach(cleanup)

  it('niewykonane zlecenie da się anulować', () => {
    const anuluj = rysuj(wiersz())
    fireEvent.click(anulujBtn())
    expect(anuluj).toHaveBeenCalled()
  })

  it('działa TAKŻE na planie minionym — wtedy jest potrzebne', () => {
    // Plan miniony jest read-only, ale zamrożone mięso trzeba oddać.
    const anuluj = rysuj(wiersz(), { readOnly: true, showConfirmExecution: false })
    fireEvent.click(anulujBtn())
    expect(anuluj).toHaveBeenCalled()
  })

  it('zlecenie zaplanowane, jeszcze niepotwierdzone, też się anuluje', () => {
    const anuluj = rysuj(wiersz({ status: 'planned' }))
    fireEvent.click(anulujBtn())
    expect(anuluj).toHaveBeenCalled()
  })

  it('zlecenie W TRAKCIE nie ma czego anulować z biura', () => {
    // Sesja stoi na tablecie — najpierw trzeba ją tam zamknąć.
    rysuj(wiersz({ status: 'in_progress', kgDone: 200 }))
    expect(brakAnuluj()).toBe(true)
  })

  it('zlecenie GOTOWE nie ma przycisku anulowania', () => {
    // Od tego jest „Cofnij" — anulowanie zostawiłoby partię przyprawionego.
    rysuj(wiersz({ status: 'done', kgDone: 4000 }))
    expect(brakAnuluj()).toBe(true)
  })

  it('zlecenie z ROZPOCZĘTYM wykonaniem nie znika jednym kliknięciem', () => {
    rysuj(wiersz({ status: 'confirmed', kgDone: 150 }))
    expect(brakAnuluj()).toBe(true)
  })

  it('wiersz jeszcze niezapisany nie ma czego anulować', () => {
    rysuj(wiersz({ id: undefined, status: 'new' }))
    expect(brakAnuluj()).toBe(true)
  })
})
