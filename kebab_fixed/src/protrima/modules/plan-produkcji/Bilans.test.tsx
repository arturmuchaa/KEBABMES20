// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'

const plans = vi.hoisted(() => ({ balance: vi.fn(), settleBalance: vi.fn(), balanceRange: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), productionPlansApi: plans }))
import { BilansPlanu, StratyOkno } from './Bilans'

afterEach(cleanup)
beforeEach(() => Object.values(plans).forEach(f => f.mockReset()))
const wiersz = (zm: Record<string, unknown>) => ({ planId: 'pl1', planNo: 'PROD/1', planDate: '2026-11-25', batchNo: '724', recipeId: 'kir', recipeName: 'KIRMIZI',
  kgTheory: 610, kgIn: 598, kgGoods: 560, kgReturned: 24, kgLoss: 14, lossPct: 2.3, ...zm })

describe('bilans planu', () => {
  it('pokazuje stratę partii w kg i procentach z teorią masowania', async () => {
    plans.balance.mockResolvedValue([wiersz({}), wiersz({ batchNo: '725', kgTheory: null, kgIn: 600, kgGoods: 560, kgReturned: 30, kgLoss: 10, lossPct: 1.7 })])
    render(<BilansPlanu planId="pl1" />)
    const tbl = await screen.findByRole('table', { name: 'Bilans partii planu' })
    const r724 = within(tbl).getByText('724').closest('tr')!
    expect(r724.textContent).toContain('610 kg')
    expect(r724.textContent).toContain('14 kg')
    expect(r724.textContent).toContain('2,3%')
    const suma = tbl.querySelector('tfoot')!.textContent!
    expect(suma).toContain('1 198 kg')
    expect(suma).toContain('24 kg')
    expect(suma).toContain('2%')
  })
  it('brak bilansu daje przycisk Policz bilans i woła settleBalance', async () => {
    plans.balance.mockResolvedValueOnce([]).mockResolvedValueOnce([wiersz({})])
    plans.settleBalance.mockResolvedValue([])
    render(<BilansPlanu planId="pl1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Policz bilans' }))
    await waitFor(() => expect(plans.settleBalance).toHaveBeenCalledWith('pl1'))
    expect(await screen.findByText('724')).toBeTruthy()
  })
  it('błąd bilansu (rezerwacje innych planów) widać słowami serwera', async () => {
    plans.balance.mockResolvedValue([])
    plans.settleBalance.mockRejectedValue(new Error('Partia 724: po bilansie zostaje 24 kg, a inne plany mają zarezerwowane 100 kg'))
    render(<BilansPlanu planId="pl1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Policz bilans' }))
    expect((await screen.findByRole('alert')).textContent).toContain('zarezerwowane 100 kg')
  })
})

describe('straty za zakres dat', () => {
  it('sumuje receptury i dni, wyróżnia największą stratę', async () => {
    plans.balanceRange.mockResolvedValue({
      rows: [wiersz({})],
      days: [{ date: '2026-11-25', kgIn: 598, kgLoss: 14, lossPct: 2.3 }, { date: '2026-11-26', kgIn: 900, kgLoss: 15, lossPct: 1.7 }],
      recipes: [{ recipeId: 'kir', recipeName: 'KIRMIZI', kgIn: 1198, kgLoss: 24, lossPct: 2.0 }, { recipeId: 'don', recipeName: 'DONER', kgIn: 300, kgLoss: 5, lossPct: 1.7 }],
    })
    render(<StratyOkno onClose={vi.fn()} />)
    const rec = await screen.findByRole('table', { name: 'Straty wg receptury' })
    expect(within(rec).getByText('KIRMIZI').closest('tr')!.textContent).toContain('2%')
    const dni = screen.getByRole('table', { name: 'Straty wg dnia' })
    expect(within(dni).getByText('25.11.2026').closest('tr')!.className).toContain('pp-max')
    expect(plans.balanceRange).toHaveBeenCalledTimes(1)
    const [od, doDnia] = plans.balanceRange.mock.calls[0]
    expect((Date.parse(doDnia) - Date.parse(od)) / 86_400_000).toBe(13)
  })
})
