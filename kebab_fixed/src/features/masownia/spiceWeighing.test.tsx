// @vitest-environment jsdom
/**
 * Bramka wagi przypraw — to ona pilnuje, żeby nic nie „odważyło się" samo.
 *
 * Dwa wymagania hali (17.09.2026, właściciel): działka wagi przypraw to 100 g,
 * a pojemnik stoi na wadze przez całe ważenie — więc między składnikami wagę
 * się TARUJE. Bez tego odczyt poprzedniej przyprawy potrafi trafić w okno
 * następnej i zapisać ją bez dosypania choćby grama.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

const waga = vi.hoisted(() => ({
  gross: 0, stable: true, connected: true, available: true, tare: vi.fn(),
}))

vi.mock('@/features/deboning/useScale', () => ({
  useScale: () => ({ ...waga }),
}))

import { SpiceWeighing } from './components/SpiceWeighing'
import type { SpiceItem } from './spiceCheck'

const PRZYPRAWY: SpiceItem[] = [
  { seq: 0, name: 'Sól', unit: 'kg', qty: 2 },
  { seq: 1, name: 'Papryka', unit: 'kg', qty: 2 },
]

/** Panel odlicza DWELL_MS = 800 ms spokojnego odczytu przed zapisem. */
const ODCZEKAJ = () => act(() => { vi.advanceTimersByTime(1200) })

function ekran(props: Partial<Parameters<typeof SpiceWeighing>[0]> = {}) {
  const onWeigh = vi.fn()
  const view = render(
    <SpiceWeighing items={PRZYPRAWY} weighed={{}}
      onWeigh={onWeigh} onDone={vi.fn()} onBack={vi.fn()} {...props} />,
  )
  return { onWeigh, view }
}

beforeEach(() => {
  vi.useFakeTimers()
  waga.gross = 0
  waga.stable = true
  waga.connected = true
  waga.tare = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('bramka wagi przypraw', () => {
  it('zapisuje przyprawę, gdy odczyt ustoi się w oknie', () => {
    const { onWeigh, view } = ekran()
    waga.gross = 2
    view.rerender(
      <SpiceWeighing items={PRZYPRAWY} weighed={{}}
        onWeigh={onWeigh} onDone={vi.fn()} onBack={vi.fn()} />,
    )
    ODCZEKAJ()
    expect(onWeigh).toHaveBeenCalledTimes(1)
    expect(onWeigh.mock.calls[0][0].name).toBe('Sól')
  })

  it('NIE zapisuje kolejnej przyprawy, dopóki poprzednia leży na wadze', () => {
    const onWeigh = vi.fn()
    // Sól już odważona; na wadze nadal stoi pojemnik z solą (2 kg), a papryka
    // ma dokładnie tyle samo — bez tary panel „odważyłby" ją sam.
    waga.gross = 2
    render(
      <SpiceWeighing items={PRZYPRAWY} weighed={{ 0: { weighed: 2, manual: false } }}
        onWeigh={onWeigh} onDone={vi.fn()} onBack={vi.fn()} />,
    )
    ODCZEKAJ()
    expect(onWeigh).not.toHaveBeenCalled()
    expect(screen.getByText(/Wyzeruj wagę pod kolejną przyprawę/i)).toBeInTheDocument()
  })

  it('po wyzerowaniu wagi bramka znów przyjmuje odczyt', () => {
    const onWeigh = vi.fn()
    const props = { items: PRZYPRAWY, weighed: { 0: { weighed: 2, manual: false } },
      onWeigh, onDone: vi.fn(), onBack: vi.fn() }
    waga.gross = 2
    const view = render(<SpiceWeighing {...props} />)
    ODCZEKAJ()

    waga.gross = 0            // operator wcisnął tarę
    view.rerender(<SpiceWeighing {...props} />)
    ODCZEKAJ()
    expect(onWeigh).not.toHaveBeenCalled()  // pusta waga to nie odważona przyprawa

    waga.gross = 2            // dosypał paprykę
    view.rerender(<SpiceWeighing {...props} />)
    ODCZEKAJ()
    expect(onWeigh).toHaveBeenCalledTimes(1)
    expect(onWeigh.mock.calls[0][0].name).toBe('Papryka')
  })

  it('pusta waga nie zalicza drobnej przyprawy mieszczącej się w tolerancji', () => {
    const onWeigh = vi.fn()
    waga.gross = 0
    render(
      <SpiceWeighing items={[{ seq: 0, name: 'Kmin', unit: 'kg', qty: 0.1 }]} weighed={{}}
        onWeigh={onWeigh} onDone={vi.fn()} onBack={vi.fn()} />,
    )
    ODCZEKAJ()
    expect(onWeigh).not.toHaveBeenCalled()
  })

  it('przycisk zerowania wysyła tarę do miernika', () => {
    ekran()
    fireEvent.click(screen.getByRole('button', { name: /Wyzeruj wagę/i }))
    expect(waga.tare).toHaveBeenCalled()
  })

  it('bez wagi nie ma czego zerować — zostaje wpis ręczny', () => {
    waga.connected = false
    ekran()
    expect(screen.queryByRole('button', { name: /Wyzeruj wagę/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Zatwierdź ręcznie/ })).toBeInTheDocument()
  })
})
