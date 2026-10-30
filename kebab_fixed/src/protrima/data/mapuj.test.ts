import { describe, it, expect } from 'vitest'
import { mapClientOrder } from '@/lib/api'
import { naMagazynie, wydane } from '@/features/orders/lineShipping'
import { computeMetrics, mixingByRecipe } from './model'
import { dataZApi, dokumentyZamowienia, krajZNip, mapujPalete, mapujWyrob, mapujZamowienie, planyPozycji } from './mapuj'

/**
 * Mapery PROTRIMA na odpowiedziach w kształcie prawdziwego API (dane syntetyczne).
 * Pole zgubione przez maper typuje się poprawnie i znika dopiero na ekranie —
 * stąd testy (CLAUDE.md: „Response mappers are testable and tested”).
 */

// Surowa odpowiedź /api/client-orders?planning=true — kształt z backendu, liczby wymyślone.
const RAW = {
  id: 'o1', order_no: 'TEST/Z/8/10/26', client_id: 'c1', client_name: 'TEST', order_date: '2026-10-28',
  delivery_date: '2026-11-05', total_kg: 1400, total_units: 47, status: 'confirmed', notes: null,
  created_at: '2026-10-28T09:00:00+00:00', coverage_basis: 'stock_and_documents',
  fulfillment: { ordered_kg: 1400, stock_kg: 300, delivered_kg: 200, covered_kg: 500, remaining_kg: 900 },
  lines: [
    {
      id: 'l1', qty: 20, kg_per_unit: 40, total_kg: 800, product_type_id: 'pt', product_type_name: 'KEBAB UDO 100%',
      recipe_id: 'r1', recipe_name: 'BEYAZ', packaging_id: 'pk', packaging_name: 'METAL 65CM', notes: null,
      qty_stock: 5, qty_delivered: 5, qty_done: 10,
      fulfillment: { ordered_kg: 800, stock_kg: 200, delivered_kg: 200, covered_kg: 400, remaining_kg: 400 },
      production: { reported_qty: 12, reported_kg: 480, remaining_qty: 8, remaining_kg: 320, unposted_qty: 2, source: 'linked_plan_reports' },
      mixing: { remaining_qty: 10, remaining_kg: 400, meat_kg: 320.4, additives_kg: 79.6, output_per_100kg: 124.8, growth_pct: 24.8, reason: null, basis: 'stock_and_documents', source: 'recipe_ingredients_per_100kg' },
    },
    {
      id: 'l2', qty: 27, kg_per_unit: 20 + 2.222, total_kg: 600, product_type_id: 'pt', product_type_name: 'KEBAB UDO 100%',
      recipe_id: 'r1', recipe_name: 'BEYAZ', packaging_id: 'pk', packaging_name: 'METAL 60CM', notes: 'bez folii',
      qty_stock: 4, qty_delivered: 0, qty_done: 4,
      fulfillment: { ordered_kg: 600, stock_kg: 88.888, delivered_kg: 0, covered_kg: 88.888, remaining_kg: 511.106 },
      production: null,
      mixing: { remaining_qty: 23, remaining_kg: 511.106, meat_kg: 409.2, additives_kg: 101.9, output_per_100kg: 124.8, growth_pct: 24.8, reason: null, basis: 'stock_and_documents', source: 'recipe_ingredients_per_100kg' },
    },
  ],
}

const ctx = {
  clients: [{ id: 'c1', code: 'K1', name: 'TEST SP. Z O.O.', displayName: 'TEST', nip: '7532482090', city: 'NYSA', postalCode: '48-300', address: 'UL. TESTOWA 1' } as never],
  pallets: { o1: [
    { id: 'p2', palletNo: 3, cartonNo: '000645', notes: '', status: 'cold_storage' as const, items: [{ orderLineId: 'l1', qty: 10 }] },
    { id: 'p1', palletNo: 1, cartonNo: '000634', notes: '', status: 'created' as const, items: [{ orderLineId: 'l2', qty: 27 }] },
  ] },
  wz: [
    { id: 'w1', number: 'WZ/5/10/26', source_type: 'order', source_id: 'o1', status: 'wstepny', issued_date: '2026-10-30', valued: false, lines: [], total_value: 0 },
    { id: 'w2', number: 'WZ/6/10/26', source_type: 'order', source_id: 'o1', status: 'anulowany', valued: false, lines: [], total_value: 0 },
    { id: 'w3', number: 'WZ/7/10/26', source_type: 'order', source_id: 'inne', status: 'wstepny', valued: false, lines: [], total_value: 0 },
  ],
  planByLine: { l1: 'PROD/28/10/26' },
}

describe('mapujZamowienie', () => {
  const api = mapClientOrder(RAW)
  const o = mapujZamowienie(api, ctx)

  it('pozycje: magazyn i wydano z lineShipping, produkcja osobno (diagnostyka)', () => {
    const [a, b] = o.lines
    expect(a.stock).toBe(naMagazynie(api.lines[0]))
    expect(a.delivered).toBe(wydane(api.lines[0]))
    expect(a.produced).toBe(12)
    expect(a.unposted).toBe(2)
    expect(b.produced).toBe(0)
    expect(a.planNo).toBe('PROD/28/10/26')
    expect(b.planNo).toBeUndefined()
    expect(b.note).toBe('bez folii')
  })

  it('trzy miary NIE są sumą: pokrycie = magazyn + wydano, produkcja niezależna', () => {
    const m = computeMetrics(o)
    expect(m.stockKg).toBeCloseTo(5 * 40 + 4 * 22.222, 3)
    expect(m.deliveredKg).toBe(200)
    expect(m.coveredKg).toBeCloseTo(m.stockKg + m.deliveredKg, 6)
    expect(m.producedKg).toBe(12 * 40)
    expect(m.missingKg).toBeCloseTo(10 * 40 + 23 * 22.222, 3)
  })

  it('palety: stały numer z API (nie indeks), sortowane po numerze, status mroźni', () => {
    expect(o.pallets.map(p => p.no)).toEqual([1, 3])
    expect(o.pallets[1].status).toBe('cold')
    expect(o.pallets[1].carton).toBe('000645')
  })

  it('daty i klient', () => {
    expect(o.delivery?.getDate()).toBe(5)
    expect(o.delivery?.getMonth()).toBe(10)
    expect(o.client.name).toBe('TEST')
    expect(o.client.country).toBe('PL')
    expect(o.client.address).toBe('UL. TESTOWA 1, 48-300 NYSA')
  })

  it('dokumenty: tylko WZ z tego zamówienia, bez anulowanych', () => {
    expect(o.docs.map(d => d.number)).toEqual(['WZ/5/10/26'])
    expect(o.docs[0].date).toBe('30.10.2026')
  })
})

describe('mixingByRecipe', () => {
  it('zaokrągla w górę PO zsumowaniu pozycji receptury', () => {
    const o = mapujZamowienie(mapClientOrder(RAW), ctx)
    const [r] = mixingByRecipe(o.lines.map(line => ({ line, orderNo: o.no })))
    expect(r.recipe).toBe('BEYAZ')
    expect(r.meatKg).toBe(Math.ceil(320.4 + 409.2)) // 730, nie 321 + 410 = 731
    expect(r.known).toBe(true)
  })
  it('receptura bez składu → nieznane, nie zero', () => {
    const o = mapujZamowienie(mapClientOrder({ ...RAW, lines: [{ ...RAW.lines[0], mixing: { ...RAW.lines[0].mixing, meat_kg: null } }] }), ctx)
    const [r] = mixingByRecipe(o.lines.map(line => ({ line, orderNo: o.no })))
    expect(r.known).toBe(false)
    expect(r.meatKg).toBeNull()
  })
})

describe('pozostałe mapery', () => {
  it('mapujPalete bez id dostaje klucz z numeru', () => {
    expect(mapujPalete({ palletNo: 7, notes: '', items: [] }).id).toBe('nr-7')
  })
  it('mapujWyrob: tylko to, co leży; przydział po numerze zamówienia', () => {
    const o = mapujZamowienie(mapClientOrder(RAW), ctx)
    const fg = { id: 'f1', batchNo: '291026 669', planNo: '', planId: '', planLineId: '', productTypeId: 'pt', productTypeName: 'KEBAB UDO 100%', recipeId: 'r1', recipeName: 'BEYAZ', clientOrderNo: 'TEST/Z/8/10/26', clientName: 'TEST', qty: 3, kgPerUnit: 40, totalKg: 120, seasonedBatchNos: ['664'], rawBatchNos: [], qtyAvailable: 2, qtyShipped: 1, producedDate: '2026-10-29', producedBy: [], createdAt: '' }
    const p = mapujWyrob(fg, [o])!
    expect(p.qty).toBe(2)
    expect(p.orderId).toBe('o1')
    expect(p.lineId).toBe('l1')
    expect(p.seasonedBatches).toEqual(['664'])
    expect(mapujWyrob({ ...fg, qtyAvailable: 0 }, [o])).toBeNull()
    expect(mapujWyrob({ ...fg, clientOrderNo: 'ZAMKNIETE/1' }, [o])!.orderNo).toBe('ZAMKNIETE/1')
  })
  it('planyPozycji pomija anulowane plany', () => {
    expect(planyPozycji([{ planNo: 'A', status: 'cancelled', lines: [{ clientOrderLineId: 'x' }] }, { planNo: 'B', lines: [{ clientOrderLineId: 'x' }] }])).toEqual({ x: 'B' })
  })
  it('krajZNip i dataZApi', () => {
    expect(krajZNip('FR12345678901')).toBe('FR')
    expect(krajZNip('DE 123456789')).toBe('DE')
    expect(krajZNip('')).toBe('')
    expect(dataZApi('30.10.2026')?.getDate()).toBe(30)
    expect(dataZApi(null)).toBeUndefined()
  })
  it('dokumentyZamowienia: brak WZ = pusta lista', () => {
    expect(dokumentyZamowienia('o9', ctx.wz as never)).toEqual([])
  })
})
