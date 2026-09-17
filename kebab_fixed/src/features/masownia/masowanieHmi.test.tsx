// @vitest-environment jsdom
/**
 * Stelaż okablowania panelu masowania — sprawdza POŁĄCZENIA, nie logikę.
 * Zaślepiamy wyłącznie moduły sięgające na zewnątrz (API, sesja).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({
  zlecenia: [] as any[],
  pojemniki: [] as any[],
  wsady: [] as any[],
  mieso: { pallets: [] as any[], lots: [] as any[], taken: {} as Record<string, number> },
}))

vi.mock('@/lib/api', () => ({
  masowniaApi: {
    meat: vi.fn(async () => stan.mieso),
    carts: vi.fn(async () => stan.pojemniki),
    charges: vi.fn(async () => stan.wsady),
    createCart: vi.fn(async () => ({})),
    weighIngredient: vi.fn(async () => ({})),
    cancelCart: vi.fn(async () => ({})),
    load: vi.fn(async () => ({})),
    finish: vi.fn(async () => ({})),
  },
  mixingOrdersApi: { list: vi.fn(async () => stan.zlecenia) },
  recipesApi: { list: vi.fn(async () => []) },
}))

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Mehmet' } }),
}))

import { MasowanieHmiPage } from '@/pages/tablet/MasowanieHmiPage'

beforeEach(() => {
  stan.zlecenia = [{
    id: 'o1', orderNo: 'MAS/17/09/26', recipeId: 'r1', recipeName: 'KIRMIZI',
    meatKg: 1000, kgDone: 0, daySeq: 1, status: 'confirmed', meatLots: [],
  }]
  stan.pojemniki = [{
    id: 'c1', cart_no: 2, order_id: 'o1', order_no: 'MAS/17/09/26',
    kg_target: 200, ingredients: [], status: 'prepared',
  }]
  stan.wsady = [{
    id: 'ch1', machine_id: 3, order_id: 'o1', order_no: 'MAS/17/09/26',
    recipe_name: 'KIRMIZI', kg_meat: 600, water_l: 108, batch_no: '511',
    started_at: new Date().toISOString(), status: 'mixing', meat: [],
  }]
  stan.mieso = { pallets: [], lots: [], taken: {} }
})

afterEach(() => cleanup())

describe('MasowanieHmiPage', () => {
  it('pokazuje trzy masownice z wielkościami wsadu', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 1')).toBeInTheDocument())
    expect(screen.getByText('Masownica 3')).toBeInTheDocument()
    expect(screen.getAllByText('wsad 200 kg')).toHaveLength(2)
    expect(screen.getByText('wsad 600 kg')).toBeInTheDocument()
  })

  it('NIE pokazuje cichego zapasu ponad nominał', async () => {
    // Wypisane „max 660" zrobiłoby z zapasu normę — hala widzi 200 i 600.
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText('Masownica 3')).toBeInTheDocument())
    expect(screen.queryByText(/660/)).not.toBeInTheDocument()
    expect(screen.queryByText(/260/)).not.toBeInTheDocument()
  })

  it('pokazuje zlecenie z kolejki dnia', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText('KIRMIZI').length).toBeGreaterThan(0))
  })

  it('pokazuje stojący pojemnik z przyprawami', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/pojemnik 2/i)).toBeInTheDocument())
  })

  it('masownica z wsadem odlicza czas do końca masowania', async () => {
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/do końca masowania/i)).toBeInTheDocument())
  })

  it('wsad po 50 minutach woła o odbiór', async () => {
    stan.wsady[0].started_at = new Date(Date.now() - 51 * 60_000).toISOString()
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getAllByText(/Gotowe — odbierz/i).length).toBeGreaterThan(0))
  })

  it('pusta masownia mówi, co teraz robić', async () => {
    stan.wsady = []
    stan.pojemniki = []
    render(<MasowanieHmiPage />)
    await waitFor(() => expect(screen.getByText(/Przygotuj przyprawy/i)).toBeInTheDocument())
    expect(screen.getByText(/Załaduj masownicę/i)).toBeInTheDocument()
  })
})
