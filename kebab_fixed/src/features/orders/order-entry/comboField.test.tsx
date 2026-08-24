// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useState } from 'react'

import { ComboField } from '@/components/terminal/fields'

/**
 * Pole wyboru na ekranie wprowadzania zamówień.
 *
 * Lista rozwijała się SAMA, gdy tylko pole stawało się aktywne — a aktywne
 * jest od wejścia na ekran, więc operator dostawał na dzień dobry rozwinięty
 * spis wszystkich rodzajów zasłaniający pół terminala (biuro, 24.08.2026).
 * Focus zostaje (cały ekran jest pod klawiaturę), rozwija się na żądanie.
 */

const ITEMS = [
  { id: 'pt1', label: 'Kebab drobiowy' },
  { id: 'pt2', label: 'Kebab wołowy' },
  { id: 'pt3', label: 'Kebab z indyka' },
]

function Pole({ startValue = '' }: { startValue?: string }) {
  const [value, setValue] = useState(startValue)
  return (
    <ComboField
      label="Rodzaj" items={ITEMS} value={value}
      active onActivate={() => {}}
      onPick={setValue} onNext={() => {}} onPrev={() => {}}
      placeholder="Rodzaj produktu…"
    />
  )
}

const pole = () => screen.getByLabelText('Rodzaj') as HTMLInputElement
/** Pozycje rozwiniętej listy. Pusto = lista zwinięta. */
const opcje = () => screen.queryAllByRole('button').map(b => b.textContent)

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(cleanup)

describe('ComboField — lista rozwija się na żądanie, nie sama', () => {
  it('aktywne pole NIE rozwija listy samo', () => {
    render(<Pole />)
    expect(opcje()).toEqual([])
  })

  it('pisanie rozwija listę i od razu filtruje', () => {
    render(<Pole />)
    fireEvent.change(pole(), { target: { value: 'woło' } })
    expect(opcje()).toEqual(['Kebab wołowy'])
  })

  it('strzałka w dół rozwija listę bez pisania', () => {
    render(<Pole />)
    fireEvent.keyDown(pole(), { key: 'ArrowDown' })
    expect(opcje()).toHaveLength(3)
  })

  it('klik w pole rozwija listę — myszką też się da', () => {
    render(<Pole />)
    fireEvent.click(pole())
    expect(opcje()).toHaveLength(3)
  })

  it('⏎ na pustym zwiniętym polu rozwija listę, a NIE wybiera po cichu pierwszej pozycji', () => {
    render(<Pole />)
    fireEvent.keyDown(pole(), { key: 'Enter' })
    expect(opcje()).toHaveLength(3)
    expect(pole().value).toBe('')
  })

  it('Esc zwija listę, zostawiając pole aktywne', () => {
    render(<Pole />)
    fireEvent.keyDown(pole(), { key: 'ArrowDown' })
    fireEvent.keyDown(pole(), { key: 'Escape' })
    expect(opcje()).toEqual([])
  })

  it('wybór z listy oddaje wartość i zwija ją z powrotem', () => {
    const onPick = vi.fn()
    render(
      <ComboField label="Rodzaj" items={ITEMS} value=""
        active onActivate={() => {}} onPick={onPick} onNext={() => {}} onPrev={() => {}} />,
    )
    fireEvent.change(pole(), { target: { value: 'indyk' } })
    fireEvent.keyDown(pole(), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('pt3')
    expect(opcje()).toEqual([])
  })

  it('⏎ na wypełnionym zwiniętym polu leci dalej, nie rozwija listy', () => {
    const onNext = vi.fn()
    render(
      <ComboField label="Rodzaj" items={ITEMS} value="pt1"
        active onActivate={() => {}} onPick={() => {}} onNext={onNext} onPrev={() => {}} />,
    )
    fireEvent.keyDown(pole(), { key: 'Enter' })
    expect(onNext).toHaveBeenCalled()
    expect(opcje()).toEqual([])
  })
})
