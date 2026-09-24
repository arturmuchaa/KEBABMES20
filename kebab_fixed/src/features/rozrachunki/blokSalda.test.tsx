// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ blok: null as any, padnij: false }))
vi.mock('@/lib/api', () => ({
  rozrachunkiApi: {
    naDokumencie: () => (stan.padnij
      ? Promise.reject(new Error('brak rozrachunków'))
      : Promise.resolve(stan.blok)),
  },
}))

import { BlokSalda } from './BlokSalda'

beforeEach(() => {
  stan.padnij = false
  stan.blok = {
    waluta: 'EUR',
    pozycje: [{ number: 'WZ/1/09/26', doc_date: '2026-09-10',
                amount: -37000, dni_po_terminie: 5 }],
    saldo_przed: -37000, saldo_po: -64040,
    policzono: '2026-09-24T17:40',
  }
})
afterEach(cleanup)

describe('blok salda na dokumencie', () => {
  it('pokazuje zaległość PRZED i RAZEM po tym dokumencie', async () => {
    render(<BlokSalda wzId="w1" />)
    // 37 000 pojawia się dwa razy — jako pozycja i jako zaległość przed
    // dokumentem. To poprawne: wiersz mówi CO, podsumowanie ILE RAZEM.
    expect((await screen.findAllByText('37 000,00 €')).length).toBe(2)
    expect(screen.getByText('64 040,00 €')).toBeTruthy()
  })

  it('drukuje chwilę policzenia salda', async () => {
    render(<BlokSalda wzId="w1" />)
    expect(await screen.findByText(/2026-09-24 17:40/)).toBeTruthy()
  })

  it('kontrahent bez rozrachunków NIE dostaje bloku — dokument drukuje się normalnie', async () => {
    stan.padnij = true
    const { container } = render(<BlokSalda wzId="w1" />)
    await waitFor(() => expect(container.querySelector('[data-testid="blok-salda"]')).toBeNull())
  })

  it('brak zaległości jest napisany wprost, a nie pustą tabelą', async () => {
    stan.blok = { ...stan.blok, pozycje: [], saldo_przed: 0, saldo_po: -27040 }
    render(<BlokSalda wzId="w1" />)
    expect(await screen.findByText(/brak niezapłaconych/i)).toBeTruthy()
  })
})
