// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const plans = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/apiClient', async (orig) => ({ ...(await orig() as object), productionPlansApi: plans }))
vi.mock('@/features/production-plan/PlanEditor', () => ({ PlanEditor: () => <div data-testid="stary-edytor" /> }))
import { ProductionPlanEditorPage } from './ProductionPlanEditorPage'

afterEach(cleanup)
const otworz = (sciezka: string) => render(<MemoryRouter initialEntries={[sciezka]}><Routes>
  <Route path="/office/planowanie-produkcji/nowy" element={<ProductionPlanEditorPage />} />
  <Route path="/office/planowanie-produkcji/:id/edytuj" element={<ProductionPlanEditorPage />} />
</Routes></MemoryRouter>)

describe('stary edytor planu po wdrożeniu PROTRIMA (spec §7, §9)', () => {
  it('nowy plan jest wyłączony z odesłaniem do PROTRIMA', async () => {
    plans.list.mockResolvedValue([])
    otworz('/office/planowanie-produkcji/nowy')
    expect(await screen.findByText(/Plany produkcji układa się teraz w PROTRIMA/)).toBeTruthy()
    expect(screen.queryByTestId('stary-edytor')).toBeNull()
  })
  it('plan z blokadą palet otwiera się tylko do podglądu', async () => {
    plans.list.mockResolvedValue([{ id: 'p1', planNo: 'PROD/1', status: 'draft', palletGate: true,
      lines: [{ id: 'l1', qty: 14, kgPerUnit: 40, recipeName: 'KIRMIZI' }] }])
    otworz('/office/planowanie-produkcji/p1/edytuj')
    expect(await screen.findByText(/Plany produkcji układa się teraz w PROTRIMA/)).toBeTruthy()
    expect(screen.getByText('14 × 40 kg KIRMIZI')).toBeTruthy()
    expect(screen.queryByTestId('stary-edytor')).toBeNull()
  })
  it('stary plan bez blokady edytuje się jak dotąd', async () => {
    plans.list.mockResolvedValue([{ id: 'p2', planNo: 'PROD/2', status: 'draft', palletGate: false, lines: [] }])
    otworz('/office/planowanie-produkcji/p2/edytuj')
    expect(await screen.findByTestId('stary-edytor')).toBeTruthy()
  })
})
