// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React, { useState } from 'react'
import { PoleLiczby } from './PrzyjecieEditor'

/** Zgłoszenie 13.11.2026: w przyjęciu ćwiartki nie dało się wpisać ceny 4,70 — przecinek znikał. */
describe('PoleLiczby', () => {
  afterEach(cleanup)
  const Proba = ({ onV, start = 0 }: { onV: (v: number) => void; start?: number }) => {
    const [v, setV] = useState(start)
    return <><PoleLiczby value={v} label="Cena za kg" onChange={x => { setV(x); onV(x) }} /><button onClick={() => setV(5.25)}>z zewnątrz</button></>
  }
  it('cena z przecinkiem wpisywana znak po znaku zostaje w polu', () => {
    const onV = vi.fn()
    render(<Proba onV={onV} />)
    const pole = screen.getByLabelText('Cena za kg') as HTMLInputElement
    for (const t of ['4', '4,', '4,7', '4,70']) { fireEvent.change(pole, { target: { value: t } }); expect(pole.value).toBe(t) }
    expect(onV).toHaveBeenLastCalledWith(4.7)
    fireEvent.change(pole, { target: { value: '4.75' } })
    expect(onV).toHaveBeenLastCalledWith(4.75)
  })
  it('wartość wczytana i zmieniona z zewnątrz pokazuje się z przecinkiem', () => {
    render(<Proba onV={vi.fn()} start={4.7} />)
    const pole = screen.getByLabelText('Cena za kg') as HTMLInputElement
    expect(pole.value).toBe('4,7')
    fireEvent.click(screen.getByText('z zewnątrz'))
    expect(pole.value).toBe('5,25')
  })
})
