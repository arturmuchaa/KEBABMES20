import { afterEach, describe, expect, it, vi } from 'vitest'
import { palletScanApi } from './api'

vi.mock('@/features/auth/storage', () => ({ tokenStore: { get: () => '' } }))
afterEach(() => vi.unstubAllGlobals())

describe('skan z potwierdzonym stanem auta', () => {
  it('wysyła opcję i mapuje migawkę z POST bez dodatkowego GET', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      id: 'p1', pallet_no: 12, status: 'loaded', result: 'SUCCESS', order: { id: 'o1' },
      vehicle_state: { vehicle: { id: 'v1' }, orders: [{ id: 'o1', pallets: [
        { id: 'p1', pallet_no: 12, status: 'loaded', on_this_vehicle: true, carton_no: 366 },
      ] }], totals: { loaded_pallets: 1, loaded_kg: 250 } },
    }) })
    vi.stubGlobal('fetch', fetcher)
    const w = await palletScanApi.scan('PAL|o1|12', 'loaded', '', 'v1', true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ include_vehicle_state: true, vehicle_id: 'v1' })
    expect(w.vehicleState?.vehicle.id).toBe('v1')
    expect(w.vehicleState?.orders[0].pallets[0]).toMatchObject({ id: 'p1', palletNo: 12, onThisVehicle: true, cartonNo: '000366' })
    expect(w.vehicleState?.totals).toMatchObject({ loadedPallets: 1, loadedKg: 250 })
  })

  it('pozostałe ekrany nie zamawiają migawki; brak jej w odpowiedzi pozostaje jawny', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'p1', result: 'SUCCESS' }) })
    vi.stubGlobal('fetch', fetcher)
    const w = await palletScanApi.scan('PAL|o1|12', 'cold_storage')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('include_vehicle_state')
    expect(w.vehicleState).toBeNull()
  })
})
