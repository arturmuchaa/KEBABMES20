// @vitest-environment jsdom
/** Zwrot końcówki palety z wagi paletowej (plan produkcji, 26.11.2026). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  zwroc: vi.fn(async () => ({ ok: true, palletNo: 41, closed: true, remainder: null })),
}))
vi.mock('@/lib/api', () => ({
  seasonedPalletsApi: { list: api.list, return: api.zwroc },
}))

import { ZwrotKoncowki } from './ZwrotKoncowki'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue([
    { id: 'p1', qr: 'SP|p1', palletNo: 41, batchNo: '724', recipeName: 'KIRMIZI', kgWeighed: 598, status: 'on_hall' },
  ])
})

const wpisz = (t: string) => { for (const c of t) fireEvent.click(screen.getByRole('button', { name: c })) }

describe('ZwrotKoncowki', () => {
  it('pokazuje palety na hali tego planu', async () => {
    render(<ZwrotKoncowki planId="pl1" onZamknij={() => {}} onZwrocono={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Paleta 41/)).toBeInTheDocument())
    expect(api.list).toHaveBeenCalledWith('on_hall', 'pl1')
  })

  it('wpis 24 i Zatwierdź oddaje końcówkę 24 kg', async () => {
    const zwrocono = vi.fn()
    render(<ZwrotKoncowki planId="pl1" onZamknij={() => {}} onZwrocono={zwrocono} />)
    fireEvent.click(await screen.findByRole('button', { name: /Paleta 41/ }))
    wpisz('24')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    await waitFor(() => expect(api.zwroc).toHaveBeenCalledWith('SP|p1', 24))
    await waitFor(() => expect(zwrocono).toHaveBeenCalled())
  })

  it('„Zużyta do zera” oddaje 0 kg', async () => {
    render(<ZwrotKoncowki planId="pl1" onZamknij={() => {}} onZwrocono={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Paleta 41/ }))
    fireEvent.click(screen.getByRole('button', { name: /Zużyta do zera/ }))
    await waitFor(() => expect(api.zwroc).toHaveBeenCalledWith('SP|p1', 0))
  })

  it('więcej niż wyjechało — Zatwierdź nieaktywny z podpowiedzią', async () => {
    render(<ZwrotKoncowki planId="pl1" onZamknij={() => {}} onZwrocono={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Paleta 41/ }))
    wpisz('600')
    expect(screen.getByRole('button', { name: /Zatwierdź/ })).toBeDisabled()
    expect(screen.getByText(/więcej niż wyjechało/)).toBeInTheDocument()
  })

  it('błąd serwera zostaje na ekranie', async () => {
    api.zwroc.mockRejectedValueOnce(new Error('Paleta 41 nie jest na hali'))
    render(<ZwrotKoncowki planId="pl1" onZamknij={() => {}} onZwrocono={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Paleta 41/ }))
    wpisz('5')
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nie jest na hali')
  })
})
