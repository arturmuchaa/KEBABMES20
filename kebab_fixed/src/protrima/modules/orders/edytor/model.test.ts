import { describe, it, expect } from 'vitest'
import { mapClientOrder } from '@/lib/api'
import { doDto, kolejnaPozycja, nowyFormularz, sumy, walidacja, zZamowienia, ostrzezenieUsuniecia } from './model'

const S = {
  productTypes: [{ id: 'pt', name: 'KEBAB UDO 100%' }],
  recipes: [{ id: 'r1', name: 'BEYAZ', productTypeId: 'pt' }],
  packaging: [{ id: 'pk', name: 'METAL 65CM' }],
}
const line = (o: Partial<ReturnType<typeof kolejnaPozycja>> = {}) => ({ ...kolejnaPozycja(), productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', qty: '20', kgPerUnit: '25', ...o })

describe('edytor zamówienia — model', () => {
  it('walidacja: klient, termin przed datą, ilość całkowita, gramatura', () => {
    const f = { ...nowyFormularz('2026-10-30'), deliveryDate: '2026-10-29', lines: [line({ qty: '2,5' }), line({ kgPerUnit: '0' })] }
    const e = walidacja(f)
    expect(Object.keys(e).sort()).toEqual(['client', 'deliveryDate', 'k1', 'q0'])
  })
  it('pusty wiersz na końcu nie jest pozycją i nie blokuje zapisu', () => {
    const f = { ...nowyFormularz('2026-10-30'), clientId: 'c1', lines: [line(), kolejnaPozycja()] }
    expect(walidacja(f)).toEqual({})
    expect(doDto(f, S).lines).toHaveLength(1)
  })
  it('DTO jak w starym edytorze: nazwy z kartotek, przecinek dziesiętny, id istniejącej pozycji', () => {
    const d = doDto({ ...nowyFormularz('2026-10-30'), clientId: 'c1', notes: '  ', lines: [line({ id: 'L1', kgPerUnit: '7,5' }), line({ packagingId: '' })] }, S)
    expect(d).toMatchObject({ clientId: 'c1', orderDate: '2026-10-30', deliveryDate: undefined, notes: undefined })
    expect(d.lines[0]).toMatchObject({ id: 'L1', qty: 20, kgPerUnit: 7.5, productTypeName: 'KEBAB UDO 100%', recipeName: 'BEYAZ', packagingName: 'METAL 65CM' })
    expect(d.lines[1]).toMatchObject({ id: undefined, packagingId: undefined, packagingName: undefined })
  })
  it('edycja zachowuje id pozycji (palety wskazują pozycję po id)', () => {
    const o = mapClientOrder({ id: 'o1', client_id: 'c1', order_date: '2026-10-28', delivery_date: '2026-11-02', status: 'confirmed', notes: 'x',
      lines: [{ id: 'L9', qty: 10, kg_per_unit: 20, product_type_id: 'pt', recipe_id: 'r1', packaging_id: 'pk', qty_stock: 3, qty_delivered: 0 }] })
    const f = zZamowienia(o)
    expect(f).toMatchObject({ clientId: 'c1', orderDate: '2026-10-28', deliveryDate: '2026-11-02', notes: 'x' })
    expect(doDto(f, S).lines[0].id).toBe('L9')
    expect(ostrzezenieUsuniecia(o, 'L9')).toContain('3 szt. w magazynie')
  })
  it('kolejna pozycja dziedziczy wszystko poza ilością; sumy', () => {
    const k = kolejnaPozycja(line())
    expect(k).toMatchObject({ productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', kgPerUnit: '25', qty: '', id: '' })
    expect(sumy({ ...nowyFormularz(''), lines: [line(), line({ qty: '4', kgPerUnit: '10' }), k] })).toEqual({ n: 2, szt: 24, kg: 540 })
  })
})
