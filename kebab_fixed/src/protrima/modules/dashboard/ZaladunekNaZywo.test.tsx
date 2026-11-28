// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/** Pulpit — „Załadunek na żywo” (spec 2026-11-28 §C). Dane fikcyjne. */
const biuro = vi.hoisted(() => ({ zaladunekNaZywo: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), biuroApi: biuro }))
import { ZaladunekNaZywo } from './ZaladunekNaZywo'

const TERAZ = new Date('2026-11-28T11:00:00Z')
const AUTO = {
  vehicleId: 'v1', name: 'Chłodnia 1', plate: 'KR 47267', startedAt: '2026-11-28T10:18:00Z', lastLoadedAt: '2026-11-28T10:52:00Z',
  unitsLoaded: 14, unitsToLoad: 21, kgLoaded: 6120, kgToLoad: 9300,
  orders: [
    { orderId: 'o1', orderNo: 'TESTA/Z/7/11/26', clientName: 'Testa GmbH', clientShortName: 'TESTA', position: 0, unitsHere: 9, unitsShippedBefore: 0, unitsTotal: 9, kgHere: 4000, kgTotal: 4000, complete: true, orderStatus: 'confirmed' },
    { orderId: 'o2', orderNo: 'PRZYK/Z/3/11/26', clientName: 'Przykład Sp. z o.o.', clientShortName: '', position: 1, unitsHere: 5, unitsShippedBefore: 2, unitsTotal: 12, kgHere: 2120, kgTotal: 5300, complete: false, orderStatus: 'confirmed' },
  ],
}
const app = { openOrder: vi.fn() } as unknown as AppApi
const mount = () => render(<AppCtx.Provider value={app}><ZaladunekNaZywo active /></AppCtx.Provider>)

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(TERAZ); biuro.zaladunekNaZywo.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Załadunek na żywo', () => {
  it('nic się nie ładuje → panel się chowa', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([])
    const { container } = mount()
    await waitFor(() => expect(biuro.zaladunekNaZywo).toHaveBeenCalled())
    expect(container.querySelector('section')).toBeNull()
  })
  it('auto: rejestracja, postęp palet i kg, zamówienia z klientem', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([AUTO])
    mount()
    expect(await screen.findByText('KR 47267')).toBeTruthy()
    expect(screen.getByText('14 / 21')).toBeTruthy()
    expect(screen.getByText('TESTA')).toBeTruthy()
    expect(screen.getByText('Przykład Sp. z o.o.')).toBeTruthy()  // brak nazwy skróconej → pełna
    expect(screen.getByText('5 / 10')).toBeTruthy()                // 12 − 2 wysłane wcześniej
    expect(screen.getByText('+2 wysłane wcześniej')).toBeTruthy()
    expect(screen.getByLabelText('komplet')).toBeTruthy()
  })
  it('odmiana: 2 auta, 5 aut', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([AUTO, { ...AUTO, vehicleId: 'v2', plate: 'KR 2' }])
    mount()
    expect(await screen.findByText(/^2 auta w trakcie/)).toBeTruthy()
  })
  it('zamówienie częściowo na innym aucie: pasek liczy tylko to auto', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([{ ...AUTO, orders: [{ ...AUTO.orders[1], unitsShippedBefore: 0, unitsOtherVehicles: 4, unitsHere: 8, unitsTotal: 12 }] }])
    mount()
    expect(await screen.findByText('8 / 8')).toBeTruthy()
    expect(screen.getByText('+4 na innym aucie')).toBeTruthy()
  })
  it('kurs sprzed dziś: data przy godzinie startu', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([{ ...AUTO, startedAt: '2026-11-27T13:00:00Z' }])
    mount()
    expect(await screen.findByText(/ładuje od 27\.11 13:00/)).toBeTruthy()
  })
  it('bez ruchu ponad 30 min → dopisek', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([{ ...AUTO, lastLoadedAt: '2026-11-28T10:20:00Z' }])
    mount()
    expect(await screen.findByText(/bez ruchu od/)).toBeTruthy()
  })
  it('auto bez pierwszej palety', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([{ ...AUTO, startedAt: null, lastLoadedAt: null, unitsLoaded: 0 }])
    mount()
    expect(await screen.findByText('czeka na pierwszą paletę')).toBeTruthy()
  })
  it('klik w zamówienie otwiera jego kartę', async () => {
    biuro.zaladunekNaZywo.mockResolvedValue([AUTO])
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /TESTA\/Z\/7\/11\/26/ }))
    expect(app.openOrder).toHaveBeenCalledWith('o1')
  })
})
