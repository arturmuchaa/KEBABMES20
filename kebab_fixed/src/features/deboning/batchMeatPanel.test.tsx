// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BatchMeatPanel } from './BatchMeatPanel'
import { buildBatchMeatSummary } from './batchMeatSummary'

const PALETY = [
  { palletNo: 'PAL/24/08/26/13', kgNet: 200, containers: 9, lots: [{ lotNo: '503', kg: 200 }] },
  { palletNo: 'PAL/24/08/26/19', kgNet: 200, containers: 9,
    lots: [{ lotNo: '503', kg: 60 }, { lotNo: '504', kg: 140 }] },
]
const SUM = buildBatchMeatSummary({ lotNo: '503', kgInitial: 682, kgBulkFree: 422 }, PALETY)

afterEach(cleanup)

describe('BatchMeatPanel', () => {
  it('pokazuje zważone, na paletach i pozostało', () => {
    render(<BatchMeatPanel summary={SUM} onWeighRest={vi.fn()} />)
    const t = screen.getByTestId('bmp-liczby').textContent ?? ''
    expect(t).toContain('682')
    expect(t).toContain('260')
    expect(t).toContain('422')
  })

  it('daje zważyć końcówkę, gdy coś zostało', () => {
    const onWeighRest = vi.fn()
    render(<BatchMeatPanel summary={SUM} onWeighRest={onWeighRest} />)
    fireEvent.click(screen.getByTestId('bmp-zwaz-reszte'))
    expect(onWeighRest).toHaveBeenCalled()
  })

  it('partia rozważona do końca nie kusi przyciskiem', () => {
    const zero = buildBatchMeatSummary({ lotNo: '503', kgInitial: 260, kgBulkFree: 0 }, PALETY)
    render(<BatchMeatPanel summary={zero} onWeighRest={vi.fn()} />)
    expect(screen.queryByTestId('bmp-zwaz-reszte')).toBeNull()
  })

  it('wypisuje palety tej partii', () => {
    render(<BatchMeatPanel summary={SUM} onWeighRest={vi.fn()} />)
    expect(screen.getAllByTestId('bmp-paleta')).toHaveLength(2)
  })

  it('przy palecie łączonej pokazuje kilogramy Z TEJ partii, nie całą paletę', () => {
    render(<BatchMeatPanel summary={SUM} onWeighRest={vi.fn()} />)
    const laczona = screen.getAllByTestId('bmp-paleta').find(p => p.textContent?.includes('/19'))!
    expect(within(laczona).getByText('łączona')).toBeTruthy()
    expect(laczona.textContent).toContain('60 kg')
    expect(laczona.textContent).toContain('z 200')
  })

  it('pozwala przedrukować etykietę palety', () => {
    const onReprint = vi.fn()
    render(<BatchMeatPanel summary={SUM} onWeighRest={vi.fn()} onReprint={onReprint} />)
    fireEvent.click(screen.getAllByTitle(/Przedrukuj/)[0])
    expect(onReprint).toHaveBeenCalledWith('PAL/24/08/26/13')
  })

  it('partia bez palet mówi to wprost', () => {
    const pusta = buildBatchMeatSummary({ lotNo: '999', kgInitial: 100, kgBulkFree: 100 }, PALETY)
    render(<BatchMeatPanel summary={pusta} onWeighRest={vi.fn()} />)
    expect(screen.getByText(/nie zważono jeszcze żadnej palety/)).toBeTruthy()
  })
})
