import { describe, it, expect } from 'vitest'
import { mapMasowniaMeat } from '@/lib/api'

describe('mapMasowniaMeat', () => {
  it('mapuje snake_case backendu na kształt kafelków', () => {
    const out = mapMasowniaMeat({
      pallets: [{ id: 'p1', pallet_no: 'PAL/17/09/26/1', kg_net: '200.000',
                  expiry_date: '2026-10-01', lots: [{ lot_no: '511', kg: '200.000' }] }],
      lots: [{ meat_stock_id: 'ms1', lot_no: '511', material_name: 'Mięso z/s',
               material_type_id: 'mat-mieso-zs', kg_free: '1800.000', expiry_date: '2026-10-01' }],
      taken: { p1: '140.000' },
    })
    expect(out.pallets[0]).toEqual({
      id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-10-01',
      lots: [{ lotNo: '511', kg: 200 }],
    })
    expect(out.lots[0]).toEqual({
      meatStockId: 'ms1', lotNo: '511', materialName: 'Mięso z/s',
      materialTypeId: 'mat-mieso-zs', kgFree: 1800, expiryDate: '2026-10-01',
    })
    expect(out.taken).toEqual({ p1: 140 })
  })

  it('pusta odpowiedź nie wysypuje ekranu', () => {
    expect(mapMasowniaMeat({})).toEqual({ pallets: [], lots: [], taken: {} })
  })

  it('data w formacie ISO z czasem schodzi do samej daty', () => {
    const out = mapMasowniaMeat({
      pallets: [], lots: [{ meat_stock_id: 'ms1', lot_no: '511', material_name: '',
                            material_type_id: 'mat-mieso-zs', kg_free: 10,
                            expiry_date: '2026-10-01T00:00:00+00:00' }], taken: {},
    })
    expect(out.lots[0].expiryDate).toBe('2026-10-01')
  })
})
