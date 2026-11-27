// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

const plans = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), updateStatus: vi.fn(), byId: vi.fn(), balance: vi.fn(), settleBalance: vi.fn(), balanceRange: vi.fn() }))
const pallets = vi.hoisted(() => ({ list: vi.fn(), markLabelsPrinted: vi.fn() }))
const rec = vi.hoisted(() => ({ list: vi.fn() }))
const pt = vi.hoisted(() => ({ list: vi.fn() }))
const pkg = vi.hoisted(() => ({ list: vi.fn() }))
const orders = vi.hoisted(() => ({ list: vi.fn(), productionProgress: vi.fn() }))
const units = vi.hoisted(() => ({ generateFromPlanLine: vi.fn(), forPlan: vi.fn(), markLabelsPrinted: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig() as object), productionPlansApi: plans, seasonedPalletsApi: pallets, recipesApi: rec, productTypesApi: pt,
  packagingApi: pkg, clientOrdersApi: orders, finishedUnitsApi: units,
}))
import { PlanProdukcjiModule } from './PlanProdukcjiModule'

const H = 3_600_000
const temu = (h: number) => new Date(Date.now() - h * H).toISOString()
const jutro = (() => { const d = new Date(Date.now() + 24 * H); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' }) })()
let nr = 40
const pal = (p: Record<string, unknown>) => {
  nr += 1
  return { id: `p${nr}`, qr: `SP|p${nr}`, palletNo: nr, batchNo: '724', recipeId: 'kir', recipeName: 'KIRMIZI', seasonedMeatId: 'sm', kgWeighed: 598,
    status: 'in_cold', isRemainder: false, parentId: null, labelPrintedAt: null, takenAt: null, takenBy: '', takenPlanId: null, returnedAt: null,
    kgReturned: null, mixedAt: temu(30), materialTypeId: '', materialName: '', planIds: [], ...p }
}

describe('Plan produkcji — ekran', () => {
  const app = { toast: vi.fn(), openOrder: vi.fn(), openModule: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const cmds = vi.fn()
  const mount = () => render(<AppCtx.Provider value={app}><PlanProdukcjiModule active setCtx={vi.fn()} setCmds={cmds} /></AppCtx.Provider>)
  const cmd = (id: string) => cmds.mock.lastCall![0].find((c: { id: string }) => c.id === id)
  let P: Array<Record<string, unknown>> = []

  afterEach(cleanup)
  beforeEach(() => {
    nr = 40
    ;[...Object.values(plans), ...Object.values(pallets), rec.list, pt.list, pkg.list, ...Object.values(orders), ...Object.values(units), cmds].forEach(f => f.mockReset())
    P = [
      pal({ id: 'k1', palletNo: 57, kgWeighed: 24, isRemainder: true, batchNo: '724', mixedAt: temu(26.5), parentPalletNo: 41 }),
      pal({ id: 'p41', palletNo: 41, kgWeighed: 598 }),
      pal({ id: 'p42', palletNo: 42, kgWeighed: 600, mixedAt: temu(20) }),
      pal({ id: 'k2', palletNo: 58, kgWeighed: 31, isRemainder: true, batchNo: '731', mixedAt: temu(40) }),
    ]
    plans.list.mockResolvedValue([])
    pallets.list.mockImplementation(() => Promise.resolve(P))
    rec.list.mockResolvedValue([{ id: 'kir', name: 'KIRMIZI', components: [] }, { id: 'mixr', name: 'MIX KIRMIZI', components: [] }])
    pt.list.mockResolvedValue([{ id: 'udo', name: 'KEBAB UDO 100%', components: [] },
      { id: 'mix', name: 'KEBAB MIX 70/30', components: [{ materialTypeId: 'mat-udo', name: 'UDO', pct: 70 }, { materialTypeId: 'mat-filet', name: 'FILET', pct: 30 }] }])
    pkg.list.mockResolvedValue([])
    orders.list.mockResolvedValue([{ id: 'z1', orderNo: 'YAL/Z/1', clientId: 'c1', clientName: 'YALCIN', status: 'confirmed',
      lines: [{ id: 'zl1', qty: 14, kgPerUnit: 40, productTypeId: 'udo', recipeId: 'kir', recipeName: 'KIRMIZI' }] }])
    orders.productionProgress.mockResolvedValue({ lines: [] })
    plans.create.mockResolvedValue({ id: 'np', planNo: 'PROD/1', planDate: jutro, status: 'draft', lines: [], summary: null })
  })

  const zZamowienia = async () => {
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Z zamówień/ }))
    fireEvent.click(await screen.findByRole('button', { name: /YALCIN.*14 × 40 kg/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Palety w chłodni/ }))
  }

  it('pokazuje palety w chłodni z końcówką na górze i licznikiem leżenia', async () => {
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Palety w chłodni/ }))
    const panel = await screen.findByTestId('panel-palet')
    await within(panel).findByText('leży 26 h')
    const wiersze = within(panel).getAllByRole('button', { name: /^Paleta \d+/ })
    expect(wiersze[0].getAttribute('aria-label')).toMatch(/^Paleta 58/)  // końcówka leżąca najdłużej
    expect(wiersze[1].getAttribute('aria-label')).toMatch(/^Paleta 57/)
  })

  it('klik w paletę przypina ją do zaznaczonej pozycji i liczy sztuki', async () => {
    await zZamowienia()
    fireEvent.click(await screen.findByRole('button', { name: /^Paleta 41/ }))
    expect(await screen.findByText(/14 szt\. z palet/)).toBeTruthy()
  })

  it('zapis wysyła palletIds i palletGate', async () => {
    await zZamowienia()
    fireEvent.click(await screen.findByRole('button', { name: /^Paleta 41/ }))
    await React.act(async () => { await cmd('save').run() })
    expect(plans.create).toHaveBeenCalledWith(expect.objectContaining({
      planDate: jutro, palletGate: true,
      lines: [expect.objectContaining({ qty: 14, kgPerUnit: 40, recipeId: 'kir', palletIds: ['p41'], clientName: 'YALCIN' })],
    }))
  })

  it('błąd 409 serwera pokazuje się z numerem palety', async () => {
    plans.create.mockRejectedValue(new Error('Paleta 41 jest już zużyta — odśwież listę palet'))
    await zZamowienia()
    fireEvent.click(await screen.findByRole('button', { name: /^Paleta 41/ }))
    await React.act(async () => { await cmd('save').run() })
    expect((await screen.findByRole('alert')).textContent).toContain('Paleta 41 jest już zużyta')
  })

  it('pozycja z końcówek sumuje kg i liczy pełne sztuki', async () => {
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Palety w chłodni/ }))
    const panel = await screen.findByTestId('panel-palet')
    fireEvent.click(await within(panel).findByRole('checkbox', { name: /Końcówka 57/ }))
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Końcówka 58/ }))
    fireEvent.click(within(panel).getByRole('button', { name: /Pozycja z końcówek/ }))
    const kg = await screen.findByLabelText('kg/szt, pozycja 1')
    fireEvent.change(kg, { target: { value: '40' } })
    expect(await screen.findByText('55 kg → 1 szt.')).toBeTruthy()
  })

  it('pozycja mix grupuje palety po składnikach i podpowiada palety obu rodzajów', async () => {
    P = [pal({ id: 'u1', palletNo: 70, recipeId: 'mixr', recipeName: 'MIX KIRMIZI', materialTypeId: 'mat-udo', materialName: 'UDO', kgWeighed: 600 }),
      pal({ id: 'f1', palletNo: 71, recipeId: 'mixr', recipeName: 'MIX KIRMIZI', materialTypeId: 'mat-filet', materialName: 'FILET', kgWeighed: 300 })]
    orders.list.mockResolvedValue([{ id: 'z2', orderNo: 'TRU/Z/1', clientId: 'c2', clientName: 'TRUVA', status: 'confirmed',
      lines: [{ id: 'zl2', qty: 20, kgPerUnit: 40, productTypeId: 'mix', recipeId: 'mixr', recipeName: 'MIX KIRMIZI' }] }])
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Z zamówień/ }))
    fireEvent.click(await screen.findByRole('button', { name: /TRUVA.*20 × 40 kg/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Palety w chłodni/ }))
    const panel = await screen.findByTestId('panel-palet')
    expect(within(panel).getByText(/UDO 70%/)).toBeTruthy()
    expect(within(panel).getByText(/FILET 30%/)).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: /Podpowiedz palety/ }))
    await React.act(async () => { await cmd('save').run() })
    await waitFor(() => expect(plans.create).toHaveBeenCalled())
    expect(plans.create.mock.calls[0][0].lines[0].palletIds).toEqual(['u1', 'f1'])
  })
})
