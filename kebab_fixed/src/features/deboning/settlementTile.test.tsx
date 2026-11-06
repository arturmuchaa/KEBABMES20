// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { SettlementBalancePanel } from './SettlementBalancePanel'
import { SettlementExceptionModal } from './SettlementExceptionModal'
import { SettlementSummaryCard } from './SettlementSummaryCard'
import { useTileSettlement } from './useTileSettlement'
import { settlementPendingKey, type TakeSettlement } from './settlement'
import { takeSettlementApi } from '@/lib/api'

vi.mock('@/lib/api', () => ({ takeSettlementApi: {
  weigh: vi.fn(), correct: vi.fn(), advance: vi.fn(), finish: vi.fn(), reopen: vi.fn(),
} }))

function state(overrides: Partial<TakeSettlement> = {}): TakeSettlement {
  return {
    id: 'take-1', sessionId: 's1', sessionDate: '2026-11-05', rawBatchId: 'batch-1', rawBatchNo: '694',
    workerId: 'w1', workerName: 'JAN', kgTaken: 300, kgMeat: 0, kgBacks: 0, kgBones: 0,
    kgRemainder: 300, yieldPct: 0, sessionNo: 'ROZ/05/11/26', createdAt: '2026-11-05T06:00:00Z',
    status: 'pending', meatType: 'zs', mode: 'worker', stage: 'balance',
    meatKg: 200, backsKg: 55, bonesKg: 30, totalKg: 285, differenceKg: -15, balancePct: 95,
    tolerancePct: 1, toleranceKg: 3, minKg: 297, maxKg: 303, withinTolerance: false,
    weighings: [
      { id: 'm1', kind: 'meat', kgNet: 120, weighMode: 'auto', reason: '', weighedAt: '2026-11-05T07:00:00Z' },
      { id: 'm2', kind: 'meat', kgNet: 80, weighMode: 'auto', reason: '', weighedAt: '2026-11-05T07:05:00Z' },
      { id: 'b1', kind: 'backs', kgNet: 55, weighMode: 'auto', reason: '', weighedAt: '2026-11-05T07:10:00Z' },
      { id: 'k1', kind: 'bones', kgNet: 30, weighMode: 'auto', reason: '', weighedAt: '2026-11-05T07:15:00Z' },
    ],
    ...overrides,
  }
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
afterEach(cleanup)

describe('SettlementBalancePanel (bilans na środku ekranu)', () => {
  it('shows every fraction with its share and the shortfall when out of tolerance', () => {
    render(<SettlementBalancePanel s={state()} onFix={() => {}} />)
    const panel = screen.getByLabelText('Bilans pobrania')
    expect(within(panel).getByText('Mięso')).toBeTruthy()
    expect(within(panel).getByText('Grzbiety')).toBeTruthy()
    expect(within(panel).getByText('Kości')).toBeTruthy()
    expect(within(panel).getByText('285,0 kg')).toBeTruthy()
    expect(within(panel).getByRole('status').textContent).toMatch(/Brakuje 15,0 kg/)
    expect(within(panel).getByRole('status').textContent).toMatch(/297,0–303,0 kg/)
  })

  it('says "W tolerancji" inside ±1%', () => {
    render(<SettlementBalancePanel s={state({ bonesKg: 43.4, totalKg: 298.4, differenceKg: -1.6, balancePct: 99.47, withinTolerance: true })} onFix={() => {}} />)
    expect(screen.getByRole('status').textContent).toMatch(/W tolerancji — brakuje 1,6 kg/)
  })

  it('"Popraw" fixes that fraction in place', () => {
    const onFix = vi.fn()
    render(<SettlementBalancePanel s={state()} onFix={onFix} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Popraw' })[2])
    expect(onFix).toHaveBeenCalledWith('bones')
  })
})

describe('SettlementExceptionModal (wyjątek kierownika)', () => {
  it('needs a reason and a code of at least 4 digits, then sends both', () => {
    const onConfirm = vi.fn()
    render(<SettlementExceptionModal s={state()} onCancel={() => {}} onConfirm={onConfirm} />)
    const confirm = screen.getByRole('button', { name: 'Zatwierdź z wyjątkiem' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Mięso upadło / odpad' }))
    for (const d of '432') fireEvent.click(screen.getByRole('button', { name: d }))
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByLabelText('Wpisany kod').textContent).toBe('••••')
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('4321', 'Mięso upadło / odpad')
  })

  it('shows the shortfall and the server error (wrong code)', () => {
    render(<SettlementExceptionModal s={state()} error="Błędny kod kierownika — rozliczenie nie zostało zatwierdzone" onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByRole('dialog').textContent).toMatch(/Brakuje 15,0 kg z 300,0 kg/)
    expect(screen.getByRole('alert').textContent).toMatch(/Błędny kod kierownika/)
  })
})

describe('SettlementSummaryCard (karta po prawej)', () => {
  it('offers "Popraw" also for the fraction being weighed once something is saved', () => {
    const onFix = vi.fn()
    render(<SettlementSummaryCard s={state({ stage: 'backs', bonesKg: 0, totalKg: 255 })} liveKg={0} onFix={onFix} />)
    const buttons = screen.getAllByRole('button', { name: 'Popraw' })
    expect(buttons).toHaveLength(2)   // mięso (done) + grzbiety (bieżące, zapisane); kości puste
    fireEvent.click(buttons[1])
    expect(onFix).toHaveBeenCalledWith('backs')
  })

  it('marks the fraction under correction instead of offering "Popraw" for it', () => {
    render(<SettlementSummaryCard s={state({ stage: 'meat' })} liveKg={0} fixing="meat" onFix={() => {}} />)
    expect(screen.getByText('poprawiasz — zważ wózek jeszcze raz')).toBeTruthy()
  })
})

describe('useTileSettlement', () => {
  it('a correction replaces the chosen weighing (correctingId) and keeps it safe until confirmed', async () => {
    const after = state({ stage: 'bones', bonesKg: 43.4 })
    let resolve!: (s: TakeSettlement) => void
    vi.mocked(takeSettlementApi.correct).mockImplementation(() => new Promise(r => { resolve = r }))
    const { result } = renderHook(() => useTileSettlement())
    act(() => result.current.open(state()))
    let p!: Promise<string | null>
    act(() => { p = result.current.correct('k1', { kind: 'bones', kgNet: 43.4, weighMode: 'manual', reason: 'Zważone jeszcze raz' }) })
    const stored = JSON.parse(localStorage.getItem(settlementPendingKey('take-1'))!)
    expect(stored.correctingId).toBe('k1')
    expect(stored.measurement.kgNet).toBe(43.4)
    await act(async () => { resolve(after); expect(await p).toBeNull() })
    expect(vi.mocked(takeSettlementApi.correct).mock.calls[0].slice(0, 2)).toEqual(['take-1', 'k1'])
    expect(localStorage.getItem(settlementPendingKey('take-1'))).toBeNull()
    expect(result.current.latest()?.bonesKg).toBe(43.4)
  })

  it('finish passes the manager exception and reports a wrong code', async () => {
    vi.mocked(takeSettlementApi.finish).mockRejectedValueOnce(Object.assign(new Error('Błędny kod kierownika'), { status: 403 }))
    const { result } = renderHook(() => useTileSettlement())
    act(() => result.current.open(state()))
    let err: string | null = null
    await act(async () => { err = await result.current.finish({ code: '1111', reason: 'Inne — wyjaśnię w biurze' }) })
    expect(err).toBe('Błędny kod kierownika')
    expect(takeSettlementApi.finish).toHaveBeenCalledWith('take-1', { code: '1111', reason: 'Inne — wyjaśnię w biurze' })
  })
})
