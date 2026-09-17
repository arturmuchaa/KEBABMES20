// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WaterStep } from './components/WaterStep'
import { PickupDialog } from './components/PickupDialog'

const wpisz = (tekst: string) => {
  for (const c of tekst) fireEvent.click(screen.getByRole('button', { name: c }))
}

afterEach(() => cleanup())

describe('WaterStep', () => {
  it('bez dozownika przyjmuje litry z klawiatury', () => {
    const onDone = vi.fn()
    render(<WaterStep targetL={108} onDone={onDone} onBack={vi.fn()} />)
    wpisz('108')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(onDone).toHaveBeenCalledWith(108)
  })

  it('dawka poza oknem ±3% nie przechodzi', () => {
    const onDone = vi.fn()
    render(<WaterStep targetL={100} onDone={onDone} onBack={vi.fn()} />)
    wpisz('120')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Zatwierdź/ })).toBeDisabled()
  })

  it('pokazuje zadaną dawkę', () => {
    render(<WaterStep targetL={108} onDone={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText(/108/)).toBeInTheDocument()
  })

  it('receptura bez wody przepuszcza dalej bez pytania o litry', () => {
    const onDone = vi.fn()
    render(<WaterStep targetL={0} onDone={onDone} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Dalej/ }))
    expect(onDone).toHaveBeenCalledWith(0)
  })
})

describe('PickupDialog', () => {
  const charge = {
    id: 'ch1', machine_id: 3, batch_no: '511', kg_meat: 600,
    recipe_name: 'KIRMIZI', order_no: 'MAS/17/09/26',
  } as any

  it('pokazuje wartość wyliczoną z receptury obok pola operatora', () => {
    render(<PickupDialog charge={charge} expectedKg={696} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/696/)).toBeInTheDocument()
  })

  it('oddaje kilogramy wpisane z paleciaka', () => {
    const onConfirm = vi.fn()
    render(<PickupDialog charge={charge} expectedKg={696} onConfirm={onConfirm} onClose={vi.fn()} />)
    wpisz('694')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(onConfirm).toHaveBeenCalledWith(694)
  })

  it('bez wpisanej wagi nie da się zamknąć wsadu', () => {
    const onConfirm = vi.fn()
    render(<PickupDialog charge={charge} expectedKg={696} onConfirm={onConfirm} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('mówi, z której masownicy i jaka partia', () => {
    render(<PickupDialog charge={charge} expectedKg={696} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Masownica 3/)).toBeInTheDocument()
    expect(screen.getByText(/511/)).toBeInTheDocument()
  })
})
