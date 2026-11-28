// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

/** Statystyki rozbioru (spec 2026-11-28 §B). Dane fikcyjne w kształcie odpowiedzi serwera. */
const deb = vi.hoisted(() => ({ stats: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), deboningApi: deb }))
import { Statystyki } from './Statystyki'

import { STATS, PUSTE } from './fixture'

const app = { toast: vi.fn(), openModule: vi.fn() } as unknown as AppApi
const mount = (p: { active?: boolean; onPartia?: (n: string) => void } = {}) =>
  render(<AppCtx.Provider value={app}><Statystyki active={p.active ?? true} onPartia={p.onPartia ?? vi.fn()} /></AppCtx.Provider>)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 28, 10, 0))
  deb.stats.mockReset()
  deb.stats.mockResolvedValue(STATS)
  Element.prototype.scrollIntoView = vi.fn()
  // recharts ResponsiveContainer — jsdom nie ma ResizeObserver
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Statystyki rozbioru', () => {
  it('KPI: wydajność z/s z deltą do tego samego dnia tydzień temu', async () => {
    mount()
    expect(await screen.findByText('64,1%')).toBeTruthy()
    expect(screen.getByText('+1,2 p.p.')).toBeTruthy()
    expect(deb.stats).toHaveBeenCalledWith('2026-11-28', '2026-11-28', true)
    expect(screen.getByText(/na żywo/)).toBeTruthy()
  })

  it('„z wagi” z liczbą ręcznych; klik przewija do listy ważeń ręcznych', async () => {
    mount()
    const z = await screen.findByRole('button', { name: /97,4% z wagi · 4 ręcznie/ })
    fireEvent.click(z)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: /Ważenia ręczne/ })).toBeTruthy()
  })

  it('pusty dzień', async () => {
    deb.stats.mockResolvedValue(PUSTE)
    mount()
    expect(await screen.findByText('W tym dniu nie było rozbioru')).toBeTruthy()
  })

  it('tryb nieznany, gdy hala nie zapisała sposobu ważenia', async () => {
    deb.stats.mockResolvedValue({ ...STATS, weighing: { ...STATS.weighing, autoPct: null, manualCount: 0 } })
    mount()
    expect(await screen.findByText('tryb nieznany')).toBeTruthy()
  })

  it('„7 dni” pyta o ostatnie 7 dni', async () => {
    mount()
    await screen.findByText('64,1%')
    fireEvent.click(screen.getByRole('button', { name: '7 dni' }))
    await waitFor(() => expect(deb.stats).toHaveBeenLastCalledWith('2026-11-22', '2026-11-28', true))
  })

  it('odświeża co 30 s tylko, gdy karta jest aktywna', async () => {
    const { unmount } = mount({ active: false })
    await screen.findByText('64,1%')
    await act(async () => { vi.advanceTimersByTime(31_000) })
    expect(deb.stats).toHaveBeenCalledTimes(1)
    unmount()
    deb.stats.mockClear()
    mount({ active: true })
    await screen.findByText('64,1%')
    await act(async () => { vi.advanceTimersByTime(31_000) })
    await waitFor(() => expect(deb.stats).toHaveBeenCalledTimes(2))
  })

  it('pracownicy: ręczne ważenia i furtki; klik w partię → korekty partii', async () => {
    const onPartia = vi.fn()
    mount({ onPartia })
    const prac = await screen.findByRole('region', { name: 'Pracownicy' })
    const jan = within(prac).getByText('JAN TESTOWY').closest('tr')!
    expect(within(jan).getByText('3')).toBeTruthy()          // ręczne ważenia
    const adam = within(prac).getByText('ADAM PRZYKŁADOWY').closest('tr')!
    expect(within(adam).getAllByText('1').length).toBe(2)     // 1 ręczne + 1 furtka 0099
    fireEvent.click(screen.getByRole('button', { name: 'Partia 850' }))
    expect(onPartia).toHaveBeenCalledWith('850')
  })

  it('na żywo: pobrania w toku', async () => {
    mount()
    expect(await screen.findByText(/1 pobranie w toku/)).toBeTruthy()
  })
})
