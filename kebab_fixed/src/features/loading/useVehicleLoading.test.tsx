// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { VehicleState } from '@/lib/api'
import { POLL_MS, useVehicleLoading } from './useVehicleLoading'

const api = vi.hoisted(() => ({ state: vi.fn() }))
vi.mock('@/lib/api', () => ({ vehicleLoadingApi: api }))
afterEach(() => { cleanup(); vi.useRealTimers(); api.state.mockReset() })

const state = (loadedPallets: number) => ({ vehicle: { id: 'v1' }, orders: [],
  totals: { loadedPallets },
}) as VehicleState

describe('potwierdzenie skanu a synchronizacja auta', () => {
  it('migawka A i zapis B bez migawki w jednym renderze: B nadal wymaga świeżego odczytu', async () => {
    api.state.mockResolvedValueOnce(state(0))
    const { result } = renderHook(() => useVehicleLoading('v1'))
    await act(async () => {})
    let finish!: (s: VehicleState) => void
    api.state.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    act(() => {
      result.current.przyjmij(state(1))
      result.current.odswiezPoZapisie()
    })
    expect(result.current.czekaNaStan).toBe(true)
    await act(async () => { finish(state(2)) })
    expect(result.current.stan?.totals.loadedPallets).toBe(2)
    expect(result.current.czekaNaStan).toBe(false)
  })

  it('nowszy polling może rozliczyć synchronizację; starszy GET nie cofa potwierdzenia', async () => {
    vi.useFakeTimers()
    api.state.mockResolvedValueOnce(state(0))
    const { result } = renderHook(() => useVehicleLoading('v1'))
    await act(async () => {})
    let old!: (s: VehicleState) => void
    api.state.mockImplementationOnce(() => new Promise(resolve => { old = resolve }))
    act(() => { result.current.odswiezPoZapisie() })
    expect(result.current.czekaNaStan).toBe(true)
    api.state.mockResolvedValueOnce(state(2))
    await act(async () => { vi.advanceTimersByTime(POLL_MS) })
    expect(result.current.czekaNaStan).toBe(false)
    await act(async () => { old(state(1)) })
    expect(result.current.stan?.totals.loadedPallets).toBe(2)
  })

  it('brak sieci nie potwierdza synchronizacji; następny POST z migawką ją rozlicza', async () => {
    api.state.mockResolvedValueOnce(state(0))
    const { result } = renderHook(() => useVehicleLoading('v1'))
    await act(async () => {})
    api.state.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { result.current.odswiezPoZapisie() })
    expect(result.current.czekaNaStan).toBe(true)
    expect(result.current.online).toBe(false)
    act(() => { result.current.przyjmij(state(2)) })
    expect(result.current.czekaNaStan).toBe(false)
    expect(result.current.online).toBe(true)
  })
})
