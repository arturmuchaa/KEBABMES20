// @vitest-environment jsdom
/** Wynik skanu palety przy wywozie na halę (plan produkcji, 26.11.2026). */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WywozPalety } from './WywozPalety'

afterEach(cleanup)

describe('WywozPalety', () => {
  it('paleta z planu: zielony komunikat z pozycją', () => {
    render(<WywozPalety wynik={{ ok: true, palletNo: 41, batchNo: '724', recipeName: 'KIRMIZI',
      lines: [{ lineId: 'l1', label: '20 × 40 kg KIRMIZI' }] }} onZamknij={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Paleta 41')
    expect(screen.getByRole('status')).toHaveTextContent('partia 724')
    expect(screen.getByRole('status')).toHaveTextContent('20 × 40 kg KIRMIZI')
  })

  it('blokada: czerwony komunikat serwera zostaje do zamknięcia', () => {
    const zamknij = vi.fn()
    render(<WywozPalety wynik={{ ok: false, komunikat: 'Paleta 41 (partia 725) nie jest w planie na dziś — zmiana tylko przez biuro' }}
      onZamknij={zamknij} />)
    expect(screen.getByRole('alert')).toHaveTextContent('nie jest w planie na dziś')
    fireEvent.click(screen.getByRole('button', { name: /Rozumiem/ }))
    expect(zamknij).toHaveBeenCalled()
  })

  it('bez wyniku nic nie pokazuje', () => {
    const { container } = render(<WywozPalety wynik={null} onZamknij={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
