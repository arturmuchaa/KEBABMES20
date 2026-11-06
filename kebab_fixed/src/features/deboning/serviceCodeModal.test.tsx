// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ServiceCodeModal } from './ServiceCodeModal'

afterEach(cleanup)

describe('ServiceCodeModal (zmiana/usunięcie pobrania kodem serwisowym)', () => {
  it('sends the typed code and keeps the window open with the server error', async () => {
    const run = vi.fn().mockResolvedValueOnce('Błędny kod serwisowy — nic nie zmieniono').mockResolvedValueOnce(null)
    render(<ServiceCodeModal title="Usunięcie pobrania" detail="INNA · partia 694 · 120,0 kg" confirmLabel="Usuń pobranie" onCancel={() => {}} run={run} />)
    const ok = screen.getByRole('button', { name: 'Usuń pobranie' }) as HTMLButtonElement
    for (const d of '123') fireEvent.click(screen.getByRole('button', { name: d }))
    expect(ok.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await act(async () => { fireEvent.click(ok) })
    expect(run).toHaveBeenCalledWith('1234')
    expect(screen.getByRole('alert').textContent).toMatch(/Błędny kod serwisowy/)
    expect(screen.getByLabelText('Wpisany kod').textContent).toBe('kod serwisowy')
    for (const d of '0099') fireEvent.click(screen.getByRole('button', { name: d }))
    await act(async () => { fireEvent.click(ok) })
    expect(run).toHaveBeenLastCalledWith('0099')
  })
})
