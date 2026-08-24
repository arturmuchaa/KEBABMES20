// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { BulkProgressBadge } from './BulkProgressBadge'

/**
 * Licznik partii na PANELU GŁÓWNYM rozbioru.
 *
 * Strażnik ważenia zbiorczego mieszkał wyłącznie w kreatorze palet. Zielony
 * przycisk szybkiej etykiety idzie inną drogą — zapisuje paletę od razu —
 * więc operator drukujący stamtąd nie widział ani ile z partii zostało, ani
 * że właśnie przekracza limit; dowiadywał się dopiero błędem zapisu, po
 * zważeniu (hala, 24.08.2026, partia 504).
 */

const P503 = { lotNo: '503', weighedKg: 1955, onPalletsKg: 1800, leftKg: 155 }

afterEach(cleanup)

describe('BulkProgressBadge — ile z partii zostało do rozważenia', () => {
  it('pokazuje zważone, na paletach i pozostało', () => {
    render(<BulkProgressBadge progress={P503} netKg={0} />)
    const t = screen.getByTestId('bulk-progress').textContent ?? ''
    expect(t).toContain('503')
    expect(t).toContain('1955')
    expect(t).toContain('1800')
    expect(t).toContain('155')
  })

  it('bez danych o partii nie udaje wiedzy — nic nie rysuje', () => {
    render(<BulkProgressBadge progress={null} netKg={120} />)
    expect(screen.queryByTestId('bulk-progress')).toBeNull()
  })

  it('waga mieszcząca się w reszcie partii nie budzi ostrzeżenia', () => {
    render(<BulkProgressBadge progress={P503} netKg={100} />)
    expect(screen.queryByTestId('bulk-over')).toBeNull()
  })

  it('waga ponad resztę partii daje ostrzeżenie z konkretną liczbą', () => {
    render(<BulkProgressBadge progress={P503} netKg={200} />)
    const t = screen.getByTestId('bulk-over').textContent ?? ''
    expect(t).toContain('155')
    expect(t).toContain('200')
  })

  it('partia wyczerpana ostrzega przy każdej wadze', () => {
    render(<BulkProgressBadge progress={{ lotNo: '504', weighedKg: 200, onPalletsKg: 200, leftKg: 0 }} netKg={100} />)
    expect(screen.getByTestId('bulk-over')).toBeTruthy()
  })

  it('równo na styk przechodzi — z tolerancją wagi', () => {
    render(<BulkProgressBadge progress={{ lotNo: '503', weighedKg: 300, onPalletsKg: 200, leftKg: 100 }} netKg={100} />)
    expect(screen.queryByTestId('bulk-over')).toBeNull()
  })
})
