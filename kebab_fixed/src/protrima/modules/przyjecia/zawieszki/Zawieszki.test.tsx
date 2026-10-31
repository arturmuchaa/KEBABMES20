// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

/** Zawieszki palet: rachunek ze starego MES + druk przez warstwę drukarki — dane w kształcie API (syntetyczne). */
const api = vi.hoisted(() => ({ byId: vi.fn(), suppliers: vi.fn(), setPalletLayout: vi.fn() }))
const druk = vi.hoisted(() => ({ drukujZawieszki: vi.fn(), opisBledu: vi.fn(), stanDrukarki: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), receptionsApi: { byId: api.byId }, suppliersApi: { list: api.suppliers, setPalletLayout: api.setPalletLayout } }))
vi.mock('../../../drukarka/drukarka', async (orig) => ({ ...(await orig() as object), ...druk }))
import { ZawieszkiDialog } from './ZawieszkiDialog'
import { wierszeZawieszek, zawieszkiWiersza } from './model'
import type { Reception } from '@/features/raw-batches/types'

const B = (o: Record<string, unknown>) => ({ id: 'b1', internalBatchNo: '471', kgReceived: 3000, containerKg: 15, containersCount: null, status: 'active',
  supplierBatchNo: 'L-77', supplierBatches: [], slaughterDate: '2026-10-28', expiryDate: '2026-11-04', receivedDate: '', ...o })
const REC = { id: 'r1', receptionNo: '12/10/2026', receivedDate: '2026-10-29', supplierId: 's1', supplierName: 'KOKO', batches: [
  B({}),
  B({ id: 'b2', internalBatchNo: '472', kgReceived: 598.5, containersCount: 40, supplierBatches: [{ supplierBatchNo: 'L-78', kgReceived: 300 }, { supplierBatchNo: 'L-79', kgReceived: 298.5 }] }),
  B({ id: 'b3', internalBatchNo: '473', status: 'cancelled' }),
] } as unknown as Reception

const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
afterEach(cleanup)
beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset()); Object.values(druk).forEach(f => f.mockReset())
  api.byId.mockResolvedValue(REC); api.suppliers.mockResolvedValue([{ id: 's1', name: 'KOKO', containersPerPallet: 36 }]); api.setPalletLayout.mockResolvedValue({})
  druk.drukujZawieszki.mockResolvedValue(undefined); druk.stanDrukarki.mockResolvedValue({ nazwa: 'ZDesigner GC420t', uid: 'u', model: 'GC420t', gotowa: true, problemy: [], rolka: '80 × 100 mm — przyjęcie', skokMm: 102.3, inne: [] })
})

describe('zawieszki — model', () => {
  it('bez anulowanych; 200 pojemników po 36 = 5 pełnych + reszta; ręczne liczenie obowiązuje do zmiany kalibru', () => {
    const w = wierszeZawieszek(REC, {}, 36)
    expect(w.map(x => [x.batch.internalBatchNo, x.plan.containers, x.plan.tags.length])).toEqual([['471', 200, 6], ['472', 40, 2]])
    const poZmianie = wierszeZawieszek(REC, { b2: { containerKg: 10, perPallet: 36, reczneLiczenie: false } }, 36)
    expect(poZmianie[1].plan.containers).toBe(60)
  })
  it('dane zawieszki: loty z HDI z kilogramami albo numer z przyjęcia; data przyjęcia z dokumentu, gdy partia jej nie ma', () => {
    const [a, b] = wierszeZawieszek(REC, {}, 36)
    expect(zawieszkiWiersza(REC, a)[0]).toMatchObject({ receptionNo: '12/10/2026', batchNo: '471', palletIndex: 1, palletCount: 6, netKg: 540, supplierLots: [{ no: 'L-77' }], receivedDate: '2026-10-29' })
    expect(zawieszkiWiersza(REC, a).reduce((s, t) => s + t.netKg, 0)).toBe(3000)
    expect(zawieszkiWiersza(REC, b)[0].supplierLots).toEqual([{ no: 'L-78', kg: 300 }, { no: 'L-79', kg: 298.5 }])
  })
})

describe('ZawieszkiDialog', () => {
  const mount = () => render(<AppCtx.Provider value={app}><ZawieszkiDialog receptionId="r1" onClose={vi.fn()} /></AppCtx.Provider>)

  it('liczy zawieszki, zmiana układu przelicza na oczach, „Drukuj wszystkie” wysyła komplet; układ można zapamiętać u dostawcy', async () => {
    mount()
    expect(await screen.findByLabelText('Zawieszek, 471')).toBeTruthy()
    expect(screen.getByLabelText('Zawieszek, 471').textContent).toBe('6')
    expect(screen.getByText(/8 zawieszek/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /Podgląd zawieszki 471, paleta 1 z 6/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '8 na warstwę = 32' }))
    expect(screen.getByLabelText('Zawieszek, 471').textContent).toBe('7')
    fireEvent.click(screen.getByRole('button', { name: /Zapamiętaj 32 u dostawcy/ }))
    await waitFor(() => expect(api.setPalletLayout).toHaveBeenCalledWith('s1', 32))
    fireEvent.click(screen.getByRole('button', { name: /Drukuj wszystkie/ }))
    await waitFor(() => expect(druk.drukujZawieszki).toHaveBeenCalledTimes(1))
    expect(druk.drukujZawieszki.mock.calls[0][0]).toHaveLength(9)
    expect(await screen.findByText('Wydrukowano 9 zawieszek.')).toBeTruthy()
  })

  it('błąd druku słowami i droga do ustawień drukarki — schowanych w tym samym oknie', async () => {
    druk.drukujZawieszki.mockRejectedValue(new Error('x'))
    druk.opisBledu.mockResolvedValue('Drukarka zgłasza brak papieru.')
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Drukuj 472' }))
    expect(await screen.findByText(/Drukarka zgłasza brak papieru/)).toBeTruthy()
    expect(druk.drukujZawieszki.mock.calls[0][0]).toHaveLength(2)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Ustawienia drukarki' }))
    expect(await screen.findByText('ZDesigner GC420t · GC420t')).toBeTruthy()
    expect(screen.queryByText('Przesunięcie w poziomie')).toBeNull() // milimetry zwinięte
    fireEvent.click(screen.getByRole('button', { name: /Wróć do zawieszek/ }))
    expect(await screen.findByLabelText('Zawieszek, 471')).toBeTruthy()
  })
})
