import { afterEach, describe, expect, it, vi } from 'vitest'
import { orderPalletsApi } from './api'

vi.mock('@/features/auth/storage', () => ({ tokenStore: { get: () => '' } }))
afterEach(() => vi.unstubAllGlobals())

describe('tożsamość palety w API', () => {
  it('odczyt, zapis i mapowanie odpowiedzi nie gubią id, numeru QR ani kartonu', async () => {
    const raw = { id: 'p3', pallet_no: 3, carton_no: 366, notes: '', items: [{ order_line_id: 'l1', qty: 12 }] }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [raw] })
    vi.stubGlobal('fetch', fetcher)
    const pallets = await orderPalletsApi.list('o1')
    expect(pallets[0]).toMatchObject({ id: 'p3', palletNo: 3, cartonNo: '000366' })
    const result = await orderPalletsApi.save('o1', pallets)
    const body = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(body.pallets[0]).toEqual({ id: 'p3', pallet_no: 3, notes: '', items: [{ order_line_id: 'l1', qty: 12 }] })
    expect(result).toEqual(pallets)
  })
})
