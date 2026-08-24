// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BatchPanel, type BatchPanelRow } from './BatchPanel'

/**
 * Panel partii przyprawionego odpowiada na dwa pytania planisty: czy starczy
 * mięsa i KTÓRA partia poszła na którą pozycję. Stary panel mięsa umiał tylko
 * to pierwsze, więc ręczna zmiana przydziału była zgadywanką.
 */
const ROWS: BatchPanelRow[] = [
  { id: 'b1', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '495',
    productionDay: '2026-08-22', kgFreeLive: 0,    usedByLines: [1] },
  { id: 'b2', recipeId: 'r1', recipeName: 'WROCŁAW', batchNo: '496',
    productionDay: '2026-08-22', kgFreeLive: 664,  usedByLines: [3] },
  { id: 'b3', recipeId: 'r2', recipeName: 'BULLI',   batchNo: '496',
    productionDay: '2026-08-22', kgFreeLive: 1220, usedByLines: [] },
]

afterEach(cleanup)

describe('BatchPanel', () => {
  it('grupuje partie po recepturze', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('grupa-r1')).toBeTruthy()
    expect(screen.getByTestId('grupa-r2')).toBeTruthy()
  })

  it('mówi, która partia poszła na którą pozycję', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1/)).toBeTruthy()
  })

  it('partia nietknięta nie udaje przypisanej', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b3')).queryByText(/poz\./)).toBeNull()
  })

  it('brak mięsa na recepturę widać PRZED zapisem', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 5000 } }} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('brak-r1').textContent).toContain('4336')
  })

  it('gdy mięsa starczy, nie straszy brakiem', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r1: { name: 'WROCŁAW', kg: 100 } }} onRecalc={vi.fn()} />)
    expect(screen.queryByTestId('brak-r1')).toBeNull()
  })

  it('receptura z zapotrzebowaniem, ale BEZ mięsa, też jest widoczna', () => {
    render(<BatchPanel rows={ROWS} demandByRecipe={{ r9: { name: 'INDYK', kg: 300 } }} onRecalc={vi.fn()} />)
    expect(screen.getByTestId('grupa-r9')).toBeTruthy()
    expect(screen.getByTestId('brak-r9').textContent).toContain('300')
  })

  it('„Przelicz FEFO od nowa" woła wołającego', () => {
    const onRecalc = vi.fn()
    render(<BatchPanel rows={ROWS} demandByRecipe={{}} onRecalc={onRecalc} />)
    fireEvent.click(screen.getByRole('button', { name: /Przelicz FEFO/ }))
    expect(onRecalc).toHaveBeenCalled()
  })

  it('partia zajęta przez kilka pozycji wymienia je wszystkie', () => {
    const wiele = [{ ...ROWS[0], usedByLines: [1, 3, 4] }]
    render(<BatchPanel rows={wiele} demandByRecipe={{}} onRecalc={vi.fn()} />)
    expect(within(screen.getByTestId('partia-b1')).getByText(/poz\. 1, 3, 4/)).toBeTruthy()
  })
})
