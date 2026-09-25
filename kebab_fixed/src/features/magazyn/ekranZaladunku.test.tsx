// @vitest-environment jsdom
/**
 * Załadunek na kiosku magazynu.
 *
 * Pilnuje dwóch rzeczy, które kosztowały już produkcję:
 * 1. skan poza kolejnością OSTRZEGA, ale palety NIE odrzuca (21.09.2026),
 * 2. odmowa niesie KOD z backendu, nie zdanie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const s = vi.hoisted(() => ({
  migawka: null as any, wynik: null as any, odmowa: null as any,
  skany: [] as string[], dodane: [] as string[],
}))

vi.mock('@/lib/api', () => ({
  vehicleLoadingApi: {
    state: () => Promise.resolve(s.migawka),
    addOrder: (_v: string, id: string) => { s.dodane.push(id); return Promise.resolve(s.migawka) },
    removeOrder: () => Promise.resolve(s.migawka),
  },
  palletScanApi: {
    scan: (kod: string) => {
      s.skany.push(kod)
      return s.odmowa ? Promise.reject(s.odmowa) : Promise.resolve(s.wynik)
    },
    activeLoading: () => Promise.resolve([
      { id: 'nazar', orderNo: 'NAZAR/Z/4/09/26', clientName: 'NAZAR', deliveryDate: null,
        orderStatus: 'confirmed', totalPallets: 2, loadedPallets: 0, coldPallets: 2, createdPallets: 0 },
    ]),
    finalizeLoading: vi.fn(),
  },
  errCode: (e: any) => e?.code ?? '',
  isOfflineError: () => false,
}))
vi.mock('./dzwiek', () => ({ grajInny: () => {}, grajBlad: () => {} }))

import { EkranZaladunku } from './EkranZaladunku'

const MIGAWKA = {
  vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L', kind: 'own' },
  orders: [{
    id: 'polat', orderNo: 'POLAT/Z/2/09/26', clientName: 'POLAT', deliveryDate: null,
    orderStatus: 'confirmed', position: 0,
    pallets: [{ id: 'p1', palletNo: 1, status: 'cold_storage', totalKg: 620, totalQty: 24, items: [], onThisVehicle: false }],
    totals: { totalPallets: 1, loadedPallets: 0, coldPallets: 1, createdPallets: 0, shippedPallets: 0, totalKg: 620, loadedKg: 0 },
  }],
  totals: { totalPallets: 1, loadedPallets: 0, shippedPallets: 0, totalKg: 620, loadedKg: 0 },
}

beforeEach(() => {
  s.migawka = MIGAWKA; s.odmowa = null; s.skany = []; s.dodane = []
  s.wynik = { result: 'SUCCESS', palletNo: 1, totalKg: 620,
    order: { id: 'polat', orderNo: 'POLAT/Z/2/09/26' }, pozaKolejnoscia: null }
})
afterEach(cleanup)

function skan(kod: string) {
  const pole = screen.getByLabelText('Pole skanowania')
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.keyDown(pole, { key: 'Enter' })
}

describe('załadunek na kiosku', () => {
  it('pokazuje auto i zamówienia w kolejności załadunku', async () => {
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={() => {}} />)
    expect(await screen.findByText('SOLÓWKA')).toBeTruthy()
    expect(screen.getByText('1. POLAT')).toBeTruthy()
  })

  it('udany skan NIE podnosi alarmu — cisza znaczy dobrze', async () => {
    const onAlarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
    await screen.findByText('SOLÓWKA')
    skan('PAL|polat|1')
    await waitFor(() => expect(s.skany).toEqual(['PAL|polat|1']))
    expect(onAlarm).not.toHaveBeenCalled()
  })

  it('poza kolejnością: BURSZTYN z liczbami, paleta zaliczona', async () => {
    s.wynik = { ...s.wynik, pozaKolejnoscia: { pozycja: 3,
      czeka: { orderNo: 'POLAT/Z/2/09/26', clientName: 'POLAT', pozycja: 1, loaded: 2, total: 3 } } }
    const onAlarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
    await screen.findByText('SOLÓWKA')
    skan('PAL|nazar|1')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    const a = onAlarm.mock.calls[0][0]
    expect(a.ton).toBe('uwaga')
    expect(a.szczegol).toContain('POLAT')
    expect(a.szczegol).toContain('2 z 3')
  })

  it('paleta z obcego zamówienia to CZERWONY alarm', async () => {
    const e: any = new Error('nie ma go na tym samochodzie'); e.code = 'WRONG_ORDER'
    s.odmowa = e
    const onAlarm = vi.fn()
    render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
    await screen.findByText('SOLÓWKA')
    skan('PAL|obce|1')
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].ton).toBe('blad')
  })

  it('zamówienie dokłada się do auta z listy „Dołóż zamówienie"', async () => {
    render(<EkranZaladunku vehicleId="v1" onAlarm={vi.fn()} onKoniec={() => {}} />)
    fireEvent.click((await screen.findByText('NAZAR')).closest('button')!)
    await waitFor(() => expect(s.dodane).toEqual(['nazar']))
  })
})
