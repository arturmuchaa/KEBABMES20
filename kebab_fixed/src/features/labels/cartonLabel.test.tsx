// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { CartonLabel } from './CartonLabel'

/**
 * Kartka naklejana na paletę.
 *
 * Właściciel (2026-09-09): „na jedną paletę drukujemy 2 kartki tego samego
 * i naklejamy 2 na karton". Kopia nie może zależeć od tego, czy ktoś pamięta
 * ustawić w oknie drukarki liczbę egzemplarzy — kartka ma wyjść podwójna
 * z samego dokumentu.
 */
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))

afterEach(cleanup)

function pokaz(props: Partial<React.ComponentProps<typeof CartonLabel>> = {}) {
  return render(
    <MemoryRouter>
      <CartonLabel
        cornerNo="000005"
        clientName="YALCIN"
        mainLines={['10 X 80KG (BEYAZ AFIYET)', '5 X 40KG (KIRMIZI)']}
        totalKg={1000}
        footerLabel="ZAMÓWIENIE:"
        footerValue="YALCIN/Z/4/09/26"
        qrDataUrl="data:image/png;base64,AAA"
        qrCaption="P5 · YALCIN/Z/4/09/26"
        backTo="/office/zamowienia"
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('CartonLabel — dwie kopie', () => {
  it('drukuje kartke DWA razy', () => {
    pokaz()
    expect(screen.getAllByTestId('label-page')).toHaveLength(2)
  })

  it('obie kopie maja te sama tresc', () => {
    pokaz()
    expect(screen.getAllByText('YALCIN')).toHaveLength(2)
    expect(screen.getAllByText('10 X 80KG (BEYAZ AFIYET)')).toHaveLength(2)
    expect(screen.getAllByText('5 X 40KG (KIRMIZI)')).toHaveLength(2)
    expect(screen.getAllByText('000005')).toHaveLength(2)
  })

  it('pokazuje recepture przy kazdej pozycji', () => {
    pokaz({ mainLines: ['18 X 40KG (KIRMIZI · 80CM)'] })
    expect(screen.getAllByText('18 X 40KG (KIRMIZI · 80CM)')).toHaveLength(2)
  })

  it('pasek narzedzi jest JEDEN, nie jeden na kopie', () => {
    pokaz()
    expect(screen.getAllByRole('button', { name: /drukuj/i })).toHaveLength(1)
  })
})
