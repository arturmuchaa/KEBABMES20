import { describe, it, expect } from 'vitest'
import { cudzeRezerwacje, doDto, sumy, walidacja, zPicks } from './model'

const PICKS = {
  order_id: 'o1', order_no: 'ISSA/Z/3/10/26', client_id: 'c1', ordered: 190,
  buyer: { name: 'SAS ISSA DISTRIB', address: '1 RUE X, PARIS', nip: 'FR77988827754' },
  picks: [
    { stock_id: 'f1', qty: 100, batch_no: '261026 663', name: 'KEBAB UDO BEYAZ HALAL 7kg', product_type_name: 'KEBAB UDO', recipe_name: 'BEYAZ HALAL', kg_per_unit: 7, qty_available: 100 },
    { stock_id: 'f2', qty: 80, batch_no: '261026 663', product_type_name: 'KEBAB UDO', recipe_name: 'BEYAZ HALAL', kg_per_unit: 10, qty_available: 80 },
  ],
}

describe('WZ z zamówienia — model', () => {
  const { form, brakuje, orderNo } = zPicks(PICKS, '2026-10-30')
  it('pozycje z serwera, nabywca, brakujące sztuki, VAT zagraniczny 0%', () => {
    expect(orderNo).toBe('ISSA/Z/3/10/26')
    expect(brakuje).toBe(10)
    expect(form.rows.map(r => [r.stockId, r.qtyStr, r.vatRate, r.batchNo])).toEqual([['f1', '100', 0, '261026 663'], ['f2', '80', 0, '261026 663']])
    expect(form.rows[0].name).toBe('KEBAB UDO BEYAZ HALAL 7kg')
    expect(form.rows[1].name).toMatch(/BEYAZ HALAL 10kg$/)
    expect(form.issuedDate).toBe('2026-10-30')
  })
  it('walidacja: ponad stan, ułamek, ceny przy wartościowym, kurs EUR', () => {
    expect(walidacja(form)).toBe('')
    expect(walidacja({ ...form, rows: [{ ...form.rows[0], qtyStr: '101' }] })).toMatch(/przekracza stan.*na stanie 100/)
    expect(walidacja({ ...form, rows: [{ ...form.rows[0], qtyStr: '2,5' }] })).toMatch(/całkowitą/)
    expect(walidacja({ ...form, valued: true })).toMatch(/potrzebuje ceny/)
    const zCenami = { ...form, valued: true, rows: form.rows.map(r => ({ ...r, priceStr: '12,50' })) }
    expect(walidacja({ ...zCenami, currency: 'EUR' })).toMatch(/kursu EUR/)
    expect(walidacja({ ...zCenami, currency: 'EUR', eurRateStr: '4,25' })).toBe('')
  })
  it('DTO jak w starym formularzu: orderId, rozchód po stock_id, pojemniki auto = null, palety', () => {
    const d = doDto({ ...form, palletsH1Str: '2', palletsOtherStr: '', notes: '  ' }, 'o1')
    expect(d.orderId).toBe('o1')
    expect(d.items.map(i => [i.stockType, i.stockId, i.qty, i.price, i.vatRate])).toEqual([['fg', 'f1', 100, 0, undefined], ['fg', 'f2', 80, 0, undefined]])
    expect(d).toMatchObject({ valued: false, containersTotal: null, palletsH1: 2, palletsOther: undefined, palletsOtherKind: undefined, notes: undefined, payrollDeduction: null })
    expect(doDto({ ...form, containersStr: '0' }, 'o1').containersTotal).toBe(0)
  })
  it('wartościowy w EUR: ceny, VAT, kurs', () => {
    const f = { ...form, valued: true, currency: 'EUR' as const, eurRateStr: '4,2512', rows: form.rows.map(r => ({ ...r, priceStr: '3,1', vatRate: 0 })) }
    const d = doDto(f, 'o1')
    expect(d.items[0]).toMatchObject({ price: 3.1, vatRate: 0 })
    expect(d.eurRate).toBe(4.2512)
    const s = sumy(f)
    expect(s.szt).toBe(180)
    expect(s.kg).toBe(1500)
    expect(s.vat?.netto).toBeCloseTo(558, 2)
  })
  it('ostrzeżenie: towar ze stemplem innego klienta', () => {
    const f = { ...form, rows: [{ ...form.rows[0], clientOrderNo: 'POLAT/Z/4/10/26', clientName: 'POLAT' }] }
    expect(cudzeRezerwacje(f).map(r => r.orderNo)).toEqual(['POLAT/Z/4/10/26'])
    expect(cudzeRezerwacje(form)).toEqual([])
  })
})
