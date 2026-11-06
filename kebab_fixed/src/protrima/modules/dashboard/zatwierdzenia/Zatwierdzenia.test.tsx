// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const api = vi.hoisted(() => ({
  sesje: { approve: vi.fn() },
  plany: { officeConfirm: vi.fn() },
  mieso: { all: vi.fn(), reconcile: vi.fn() },
}))
vi.mock('@/lib/api', async orig => ({ ...(await orig() as object), productionSessionsApi: api.sesje, productionPlansApi: api.plany, seasonedMeatApi: api.mieso }))
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Anna Biuro' } }) }))
import { ZatwierdzeniaPanel } from './Zatwierdzenia'
import type { PlanZ, SesjaLite } from './model'

const SESJA: SesjaLite = { id: 's1', processType: 'deboning', sessionDate: '2026-11-05', endedAt: '2026-11-05T14:02:00Z' }
const PLAN: PlanZ = {
  id: 'p1', planNo: 'PP/12/11/26', planDate: '2026-11-06', status: 'active', tabletFinishedAt: '2026-11-06T13:10:00Z', officeConfirmedAt: null,
  lines: [
    { id: 'l1', qty: 100, kgPerUnit: 40, productTypeName: 'KEBAB UDO', recipeId: 'r1', recipeName: 'KIRMIZI', clientName: 'YALCIN', batchAllocation: { m1: { batch_id: 'b1' } }, seasonedBatchNos: ['m1'] },
    { id: 'l2', qty: 50, kgPerUnit: 30, productTypeName: 'KEBAB UDO', recipeId: 'r2', recipeName: 'BEYAZ', clientName: 'POLAT', batchAllocation: {}, seasonedBatchNos: [] },
  ],
  tabletPendingEntries: [{ planLineId: 'l1', qty: 100, kgPerUnit: 40, workerNames: ['Jan'] }, { planLineId: 'l2', qty: 30, kgPerUnit: 30 }],
}
const app = { toast: vi.fn(), openModule: vi.fn() }
const onZmiana = vi.fn()
const mount = (p: { sesje?: SesjaLite[]; plany?: PlanZ[] } = {}) =>
  render(<AppCtx.Provider value={app as unknown as AppApi}><ZatwierdzeniaPanel sesje={p.sesje ?? [SESJA]} plany={p.plany ?? [PLAN]} dzis="2026-11-06" onZmiana={onZmiana} /></AppCtx.Provider>)
afterEach(cleanup)
beforeEach(() => {
  for (const g of Object.values(api)) Object.values(g).forEach(f => f.mockReset())
  app.toast.mockReset(); onZmiana.mockReset()
  api.mieso.all.mockResolvedValue([{ id: 'b1', batchNo: 'm1', recipeId: 'r1', recipeName: 'KIRMIZI', kgAvailable: 12.5, expiryDate: '2026-11-10' }])
})

describe('Pulpit — zatwierdzenia biura', () => {
  it('lista: zaległa sesja rozbioru i plan z tabletu; bez nic do zatwierdzenia panel znika', () => {
    mount()
    const panel = screen.getByRole('region', { name: 'Do zatwierdzenia przez biuro' })
    expect(within(panel).getByText('Rozbiór')).toBeTruthy()
    expect(within(panel).getByText('zaległa')).toBeTruthy()
    expect(within(panel).getByText('Produkcja PP/12/11/26')).toBeTruthy()
    cleanup()
    mount({ sesje: [], plany: [] })
    expect(screen.queryByRole('region', { name: 'Do zatwierdzenia przez biuro' })).toBeNull()
  })

  it('zatwierdzenie sesji: okno mówi, co się domyka; zapis z nazwiskiem osoby z biura', async () => {
    api.sesje.approve.mockResolvedValue({})
    mount({ plany: [] })
    fireEvent.click(screen.getByRole('button', { name: /Zatwierdź/ }))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText(/Rozbiór z dnia 05\.11\.2026/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zatwierdź dzień' }))
    await waitFor(() => expect(api.sesje.approve).toHaveBeenCalledWith('s1', { approvedBy: 'Anna Biuro' }))
    expect(onZmiana).toHaveBeenCalled()
  })

  it('potwierdzenie planu: najpierw co trafi do magazynu (z ostrzeżeniem o części), potem reszta mięsa', async () => {
    api.plany.officeConfirm.mockResolvedValue({})
    api.mieso.reconcile.mockResolvedValue({})
    mount({ sesje: [] })
    fireEvent.click(screen.getByRole('button', { name: /Sprawdź i potwierdź/ }))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getAllByText('130 szt. · 4 900 kg').length).toBeGreaterThan(0)
    expect(within(dlg).getByText(/BEYAZ 30 kg \(POLAT\): 30 z 50 szt\./)).toBeTruthy()
    expect(api.plany.officeConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Potwierdź i przyjmij na magazyn' }))
    await waitFor(() => expect(api.plany.officeConfirm).toHaveBeenCalledWith('p1'))
    // Krok 2: reszta mięsa przyprawionego (także po tablecie — stary MES pytał tylko przy ręcznym zamknięciu).
    const pole = await screen.findByLabelText('Zostało mięsa KIRMIZI (kg)')
    expect((pole as HTMLInputElement).value).toBe('12,5')
    fireEvent.click(screen.getByRole('button', { name: 'Nic nie zostało' }))
    expect((pole as HTMLInputElement).value).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz pozostałość' }))
    await waitFor(() => expect(api.mieso.reconcile).toHaveBeenCalledWith('b1', expect.objectContaining({ targetKg: 0, close: true })))
    expect(api.mieso.reconcile.mock.calls[0][1].reason).toMatch(/PP\/12\/11\/26/)
  })

  it('„Rozliczę później” — plan potwierdzony, partie bez korekty', async () => {
    api.plany.officeConfirm.mockResolvedValue({})
    mount({ sesje: [] })
    fireEvent.click(screen.getByRole('button', { name: /Sprawdź i potwierdź/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź i przyjmij na magazyn' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rozliczę później' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.mieso.reconcile).not.toHaveBeenCalled()
    expect(onZmiana).toHaveBeenCalled()
  })

  it('odmowa serwera przy potwierdzeniu — jego słowa w oknie, nic nie znika', async () => {
    api.plany.officeConfirm.mockRejectedValue(new Error('Plan już potwierdzony'))
    mount({ sesje: [] })
    fireEvent.click(screen.getByRole('button', { name: /Sprawdź i potwierdź/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź i przyjmij na magazyn' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Plan już potwierdzony')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
