// @vitest-environment jsdom
/**
 * Duplikowanie receptury z listy.
 *
 * Właściciel 24.09.2026: „np. KIRMIZI daję duplikuj i pojawia się
 * KIRMIZI(1)". Nazwę kopii nadaje backend (zna wszystkie zajęte numery),
 * ekran ma tylko poprosić i odświeżyć listę — bez odświeżenia operator
 * klika drugi raz i robi trzecią kopię.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ receptury: [] as any[] }))
const wolania = vi.hoisted(() => ({ duplikaty: [] as string[] }))

vi.mock('@/lib/apiClient', () => ({
  recipesApi: {
    list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.receptury))),
    create: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    deactivate: () => Promise.resolve(),
    calculate: () => Promise.resolve({}),
    duplicate: (id: string) => {
      wolania.duplikaty.push(id)
      const zrodlo = stan.receptury.find(r => r.id === id)
      const kopia = { ...zrodlo, id: `${id}-kopia`, name: `${zrodlo.name}(1)` }
      stan.receptury = [...stan.receptury, kopia]
      return Promise.resolve(kopia)
    },
  },
  ingredientsApi: {
    list: () => Promise.resolve([]),
    stock: () => Promise.resolve([]),
  },
  productTypesApi: {
    list: () => Promise.resolve([]),
    create: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    deactivate: () => Promise.resolve(),
  },
  ingredientReceiptsApi: { list: () => Promise.resolve([]) },
  rawBatchesApi: { materialTypes: () => Promise.resolve([]) },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RecipesPage } from './RecipesPage'

beforeEach(() => {
  stan.receptury = [{
    id: 'r1', name: 'KIRMIZI', ingredients: [], components: [],
    totalOutputPer100kg: 109.8, shelfLifeDays: 7,
  }]
  wolania.duplikaty = []
})
afterEach(cleanup)

describe('RecipesPage — duplikowanie', () => {
  it('przycisk Duplikuj prosi backend o kopię TEJ receptury', async () => {
    render(<RecipesPage />)
    await screen.findByText('KIRMIZI')

    fireEvent.click(screen.getByRole('button', { name: /duplikuj/i }))

    await waitFor(() => expect(wolania.duplikaty).toEqual(['r1']))
  })

  it('kopia pojawia się na liście bez przeładowania strony', async () => {
    render(<RecipesPage />)
    await screen.findByText('KIRMIZI')

    fireEvent.click(screen.getByRole('button', { name: /duplikuj/i }))

    expect(await screen.findByText('KIRMIZI(1)')).toBeTruthy()
  })

  it('duplikowanie nie otwiera formularza edycji', async () => {
    /** „Duplikuj" siedzi obok „Edytuj" w klikalnym wierszu — bez zatrzymania
     *  zdarzenia klik rozwinąłby też wiersz albo otworzył edycję oryginału. */
    render(<RecipesPage />)
    await screen.findByText('KIRMIZI')

    fireEvent.click(screen.getByRole('button', { name: /duplikuj/i }))

    await waitFor(() => expect(wolania.duplikaty.length).toBe(1))
    expect(screen.queryByText('Edytuj recepturę')).toBeNull()
  })
})
