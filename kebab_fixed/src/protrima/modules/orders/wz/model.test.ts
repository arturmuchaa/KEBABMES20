import { describe, it, expect } from 'vitest'
import { bezCeny, cenaDlaGrupy, cenaDlaWszystkich, cudzeRezerwacje, doDto, grupyCen, sumy, vatDlaWszystkich, walidacja, wartosc, wspolnaCena, wspolnyVat, zPicks, klientZWyboru, nabywcaZKlienta, zMagazynu, zNabywca, zNazwami } from './model'

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
    // Za KILOGRAM jak serwer: 1500 kg × 3,10 = 4650 (nie 180 szt × 3,10).
    expect(s.vat?.netto).toBeCloseTo(4650, 2)
    expect(wartosc(f.rows[0])).toBeCloseTo(700 * 3.1, 2)
  })
  it('jedna cena dla wszystkich pozycji; wspólna cena rozpoznana tylko gdy wszędzie ta sama', () => {
    const f = cenaDlaWszystkich({ ...form, valued: true }, '12,50')
    expect(f.rows.map(r => r.priceStr)).toEqual(['12,50', '12,50'])
    expect(walidacja(f)).toBe('')
    expect(wspolnaCena(f)).toBe('12,50')
    expect(wspolnaCena({ ...f, rows: [f.rows[0], { ...f.rows[1], priceStr: '13' }] })).toBe('')
    expect(wspolnaCena(form)).toBe('')
    expect(sumy(f).vat?.netto).toBeCloseTo(1500 * 12.5, 2)
  })
  it('ceny według wyrobu (bez gramatury), wspólny VAT, licznik pozycji bez ceny', () => {
    const dwa = { ...form, valued: true, rows: [...form.rows, { ...form.rows[0], stockId: 'f3', name: 'KEBAB UDO CZERWONY 10kg', grupa: 'KEBAB UDO CZERWONY', qtyStr: '10', kgPerUnit: 10 }] }
    const g = grupyCen(dwa)
    expect(g.map(x => [x.key, x.pozycji, x.kg])).toEqual([['KEBAB UDO BEYAZ HALAL', 2, 1500], ['KEBAB UDO CZERWONY', 1, 100]])
    const z = cenaDlaGrupy(dwa, 'KEBAB UDO BEYAZ HALAL', '12,5')
    expect(z.rows.map(r => r.priceStr)).toEqual(['12,5', '12,5', ''])
    expect(grupyCen(z)[0].priceStr).toBe('12,5')
    expect(bezCeny(z)).toBe(1)
    expect(wspolnaCena(z)).toBe('')
    expect(wspolnyVat(vatDlaWszystkich(z, 5))).toBe(5)
    expect(wspolnyVat({ ...z, rows: [z.rows[0], { ...z.rows[1], vatRate: 8 }] })).toBeNull()
  })
  it('ostrzeżenie: towar ze stemplem innego klienta', () => {
    const f = { ...form, rows: [{ ...form.rows[0], clientOrderNo: 'POLAT/Z/4/10/26', clientName: 'POLAT' }] }
    expect(cudzeRezerwacje(f).map(r => r.orderNo)).toEqual(['POLAT/Z/4/10/26'])
    expect(cudzeRezerwacje(form)).toEqual([])
  })
})

describe('WZ z magazynu (bez zamówienia)', () => {
  const FG = [
    { id: 'g1', batch_no: '291026 659', qty_available: 12, kg_per_unit: 20, name: 'KEBAB YAPRAK 20kg', product_type_name: 'KEBAB YAPRAK', recipe_name: 'YAPRAK', client_name: 'DEM`S', client_order_no: 'DEM-S/Z/4/10/26' },
    { id: 'g2', batch_no: '291026 660', qty_available: 5, kg_per_unit: 10, product_type_name: 'KEBAB UDO', recipe_name: 'BEYAZ', client_name: null, client_order_no: null },
  ]
  const KLIENCI = [
    { id: 'c1', name: 'DEM`S GMBH', displayName: 'DEM`S', address: 'Hauptstr. 1', city: 'Wien', nip: 'ATU12345678' },
    { id: 'c2', name: 'BUBU KEBAB S.C.', address: 'Niezapominajek 12', city: 'Nysa', nip: '7532482090' },
  ]
  it('pozycje w kolejności zaznaczenia, ilość ≤ stan, stempel cudzego zamówienia zostaje (ostrzeżenie)', () => {
    const f = zMagazynu(FG, [{ id: 'g2', qty: 5 }, { id: 'g1', qty: 99 }, { id: 'nie-ma', qty: 1 }], '2026-10-30')
    expect(f.rows.map(r => [r.stockId, r.qtyStr, r.available])).toEqual([['g2', '5', 5], ['g1', '12', 12]])
    expect(f.rows[0].name).toMatch(/BEYAZ 10kg$/)
    expect(walidacja(f)).toMatch(/nazwę odbiorcy/)
    const z = zNabywca(f, nabywcaZKlienta(KLIENCI[1]))
    expect(z.buyer).toEqual({ name: 'BUBU KEBAB S.C.', address: 'Niezapominajek 12 Nysa', nip: '7532482090' })
    expect(cudzeRezerwacje(z).map(r => r.orderNo)).toEqual(['DEM-S/Z/4/10/26'])
    // Ten sam odbiorca pod nazwą handlową — to realizacja, nie cudza rezerwacja.
    const dems = zNabywca(f, nabywcaZKlienta(KLIENCI[0]))
    expect(cudzeRezerwacje(dems).map(r => r.orderNo)).toEqual(['DEM-S/Z/4/10/26'])
    expect(cudzeRezerwacje(dems, [KLIENCI[0].name, KLIENCI[0].displayName!])).toEqual([])
    expect(doDto(z).orderId).toBeUndefined()
  })
  it('VAT idzie za nabywcą, ale ręcznie zmieniona stawka zostaje', () => {
    const f = zNabywca(zMagazynu(FG, [{ id: 'g1', qty: 1 }, { id: 'g2', qty: 1 }], '2026-10-30'), nabywcaZKlienta(KLIENCI[1]))
    expect(f.rows.map(r => r.vatRate)).toEqual([5, 5])
    const recznie = { ...f, rows: [{ ...f.rows[0], vatRate: 8 }, f.rows[1]] }
    expect(zNabywca(recznie, nabywcaZKlienta(KLIENCI[0])).rows.map(r => r.vatRate)).toEqual([8, 0])
  })
  it('nazwy wg kartoteki odbiorcy; odbiorca podpowiedziany tylko przy jednym kliencie w zaznaczeniu', () => {
    const f = zMagazynu(FG, [{ id: 'g1', qty: 1 }], '2026-10-30')
    expect(zNazwami(f, [{ ...FG[0], name: 'DÖNER YAPRAK 20kg' }]).rows[0].name).toBe('DÖNER YAPRAK 20kg')
    expect(klientZWyboru(FG, [{ id: 'g1', qty: 1 }], KLIENCI)?.id).toBe('c1')
    expect(klientZWyboru(FG, [{ id: 'g1', qty: 1 }, { id: 'g2', qty: 1 }], KLIENCI)).toBeUndefined()
  })
})
