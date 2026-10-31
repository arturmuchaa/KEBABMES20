// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { Dialog } from './context'

afterEach(cleanup)

/** Rodzic, który przerysowuje się sam (jak moduł z odświeżaniem danych) i za każdym razem daje nową funkcję onClose. */
function Rodzic({ onClose, autoFocus }: { onClose: () => void; autoFocus?: boolean }) {
  const [tik, setTik] = useState(0)
  useEffect(() => { const t = setInterval(() => setTik(x => x + 1), 10); return () => clearInterval(t) }, [])
  return (
    <Dialog title={`Okno ${tik >= 0 ? '' : ''}`} onClose={() => onClose()} footer={<button className="btn primary">Zapisz</button>}>
      <input aria-label="Pole" autoFocus={autoFocus} />
    </Dialog>
  )
}

describe('Dialog — fokus', () => {
  it('przerysowanie rodzica z nową funkcją onClose nie zabiera fokusu z pola w trakcie pisania', async () => {
    render(<Rodzic onClose={vi.fn()} />)
    expect(document.activeElement?.textContent).toBe('Zapisz') // bez autoFocus — przycisk główny
    const pole = screen.getByLabelText('Pole')
    pole.focus()
    await new Promise(r => setTimeout(r, 60))
    expect(document.activeElement).toBe(pole)
  })
  it('pole z autoFocus zostaje z fokusem; Esc woła najświeższe onClose', async () => {
    const onClose = vi.fn()
    render(<Rodzic onClose={onClose} autoFocus />)
    expect(document.activeElement).toBe(screen.getByLabelText('Pole'))
    await new Promise(r => setTimeout(r, 30))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
