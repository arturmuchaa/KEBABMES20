// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ClientOrder } from '@/lib/mockApi'
import { OrderDocumentsMenu } from './OrderDocumentsMenu'

const api = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/lib/api', () => ({ hdiApi: api }))

beforeEach(() => {
  api.generate.mockReset().mockResolvedValue({ id: 'h1', number: '1/10/26', incomplete: false, totals: { qty: 160, kg: 3200 } })
  vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function menu(status = 'confirmed') {
  render(<MemoryRouter><OrderDocumentsMenu order={{ id: 'o1', orderNo: 'VATAN/Z/1', status } as ClientOrder} onCmr={vi.fn()} onSplit={vi.fn()} /></MemoryRouter>)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Dokumenty VATAN/Z/1' }), { key: 'Enter' })
}

it('wystawia HDI wstępne wyłącznie przez jawną opcję przed załadunkiem', async () => {
  menu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'HDI wstępne — przed załadunkiem' }))
  await waitFor(() => expect(api.generate).toHaveBeenCalledWith('o1', true))
  await waitFor(() => expect(window.open).toHaveBeenCalledWith('/office/hdi/h1/druk', '_blank'))
})

it('zwykłe HDI pozostawia na ścieżce wymagającej skanów', async () => {
  menu()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'HDI z załadunku' }))
  await waitFor(() => expect(api.generate).toHaveBeenCalledWith('o1', false))
})

it.each(['done', 'cancelled'])('nie oferuje HDI wstępnego dla %s', async status => {
  menu(status)
  expect(await screen.findByRole('menuitem', { name: 'Podgląd HDI (zamrożone)' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: /HDI wstępne/ })).toBeNull()
})

it('pokazuje braki produkcji i nie sugeruje potwierdzonego załadunku', async () => {
  api.generate.mockResolvedValue({ id: 'h1', number: '1/10/26', incomplete: true, totals: { qty: 100, kg: 2000 } })
  menu()
  fireEvent.click(await screen.findByRole('menuitem', { name: /HDI wstępne/ }))
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('zarejestrowaną produkcję i dostępny towar: 100 szt. / 2000 kg')))
})

it('odmowa serwera nie otwiera dokumentu', async () => {
  api.generate.mockRejectedValue(new Error('Brak wyprodukowanej produkcji'))
  menu()
  fireEvent.click(await screen.findByRole('menuitem', { name: /HDI wstępne/ }))
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Brak wyprodukowanej produkcji'))
  expect(window.open).not.toHaveBeenCalled()
})
