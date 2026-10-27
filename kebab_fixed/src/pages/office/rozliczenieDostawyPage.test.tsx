// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { rozrachunkiApi } from '@/lib/api'
import { RozliczenieDostawyPage } from './RozliczenieDostawyPage'

vi.mock('@/lib/api', () => ({ rozrachunkiApi: { dostawa: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('rozliczenie konkretnego kursu', () => {
  it('przekazuje kurs także przy przeliczaniu cen i nie sięga po całe zamówienie', async () => {
    vi.mocked(rozrachunkiApi.dostawa).mockResolvedValue({ klient: { name: 'POLAT' }, waluta: 'PLN',
      order_no: 'Z/2', dokument: 'WM/SECOND', data_dostawy: '2026-10-21',
      grupy: [{ nazwa: 'KIRMIZI', kg: 800, cena: 0, wartosc: 0, pozycje: [{ qty: 40, kg_per_unit: 20, kg: 800 }] }],
      kg_razem: 800, za_dostawe: 0, saldo_przed: -1600, razem: -1600, policzono: '2026-10-21' })
    render(<MemoryRouter initialEntries={['/dostawa/o1?loading_id=second']}><Routes>
      <Route path="/dostawa/:id" element={<RozliczenieDostawyPage />} />
    </Routes></MemoryRouter>)
    await screen.findByText('WM/SECOND', { exact: false })
    expect(rozrachunkiApi.dostawa).toHaveBeenCalledWith('o1', {}, 'second')
    fireEvent.change(screen.getByLabelText('KIRMIZI'), { target: { value: '3,20' } })
    fireEvent.click(screen.getByText('Przelicz'))
    await waitFor(() => expect(rozrachunkiApi.dostawa).toHaveBeenLastCalledWith('o1', { KIRMIZI: 3.2 }, 'second'))
  })

  it('pokazuje odmowę niejednoznacznego rozliczenia zamiast dokumentu innego kursu', async () => {
    vi.mocked(rozrachunkiApi.dostawa).mockRejectedValue(new Error('Kilka dokumentów dostawy — wybierz konkretny kurs.'))
    render(<MemoryRouter initialEntries={['/dostawa/o1']}><Routes>
      <Route path="/dostawa/:id" element={<RozliczenieDostawyPage />} />
    </Routes></MemoryRouter>)
    await screen.findByText(/wybierz konkretny kurs/)
    expect(screen.queryByText('Drukuj')).toBeNull()
  })
})
