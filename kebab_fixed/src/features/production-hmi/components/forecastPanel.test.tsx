// @vitest-environment jsdom
/**
 * Panel uzasadnienia prognozy.
 *
 * Liczba bez uzasadnienia na ścianie hali zostaje zignorowana albo obwiniona
 * o pierwszą pomyłkę — operator musi móc sprawdzić, z czego wyszła.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { ForecastPanel } from './ForecastPanel'

afterEach(cleanup)

const eta = {
  kind: 'eta' as const, at: '2026-08-27T10:10:00.000Z', hhmm: '10:10',
  remainingKg: 800, hours: 1.667, rateUsed: 120, breakAddedMin: 30,
}

describe('ForecastPanel', () => {
  it('mówi, o której i z czego to wyszło', () => {
    render(<ForecastPanel forecast={eta} crew={4} onClose={() => {}} />)
    expect(screen.getByText('10:10')).toBeTruthy()
    expect(screen.getByTestId('prognoza-zostalo').textContent).toMatch(/800/)
    expect(screen.getByTestId('prognoza-zaloga').textContent).toMatch(/4/)
    expect(screen.getByTestId('prognoza-tempo').textContent).toMatch(/120/)
    expect(screen.getByTestId('prognoza-przerwa').textContent).toMatch(/30/)
  })

  it('bez prognozy tłumaczy DLACZEGO jej nie ma', () => {
    render(<ForecastPanel forecast={{ kind: 'unknown', reason: 'za-wczesnie' }} crew={1} onClose={() => {}} />)
    expect(screen.getByText(/za mało pracy/i)).toBeTruthy()
  })

  it('bez załogi mówi wprost, że nikt nie układa', () => {
    render(<ForecastPanel forecast={{ kind: 'unknown', reason: 'brak-zalogi' }} crew={0} onClose={() => {}} />)
    expect(screen.getByText(/nikt jeszcze nie liczy/i)).toBeTruthy()
  })

  it('zamyka się', () => {
    const close = vi.fn()
    render(<ForecastPanel forecast={eta} crew={4} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: /Zamknij/i }))
    expect(close).toHaveBeenCalled()
  })
})
