import { describe, it, expect } from 'vitest'
import { mapClientOrder } from '@/lib/api'
import { braki, doDto, kolejnaPozycja, najblizszeDni, nowyFormularz, opisTerminu, pierwszyBrak, poDniach, sumy, walidacja, wierszNastepny, zZamowienia, ostrzezenieUsuniecia } from './model'

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
  it('kolejna pozycja dziedziczy rodzaj, recepturę i tuleję — gramaturę i ilość wpisuje biuro; sumy', () => {
    const k = kolejnaPozycja(line())
    expect(k).toMatchObject({ productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', kgPerUnit: '', qty: '', id: '' })
    expect(sumy({ ...nowyFormularz(''), lines: [line(), line({ qty: '4', kgPerUnit: '10' }), k] })).toEqual({ n: 2, szt: 24, kg: 540 })
  })
  it('wpisana gramatura bez ilości to pozycja — walidacja jej nie gubi', () => {
    const f = { ...nowyFormularz('2026-10-30'), clientId: 'c1', lines: [line(), { ...kolejnaPozycja(line()), kgPerUnit: '15' }] }
    expect(walidacja(f)).toEqual({ q1: 'Ilość: liczba całkowita sztuk większa od zera.' })
  })
  it('przeskok kursora: pierwsze brakujące pole; następny wiersz tylko pod kompletną pozycją', () => {
    expect(pierwszyBrak(kolejnaPozycja())).toBe('p')
    expect(pierwszyBrak(line({ recipeId: '' }))).toBe('r')
    expect(pierwszyBrak(line({ packagingId: '', kgPerUnit: '' }))).toBe('k')
    expect(pierwszyBrak(line({ qty: '2,5' }))).toBe('q')
    // Najpierw sztuki, potem gramatura (właściciel 5.11.2026) — pusta pozycja po recepturze czeka na ilość.
    expect(pierwszyBrak(line({ kgPerUnit: '', qty: '' }))).toBe('q')
    expect(pierwszyBrak(line({ packagingId: '' }))).toBeNull()
    expect(wierszNastepny([line()])).toMatchObject({ productTypeId: 'pt', recipeId: 'r1', packagingId: 'pk', kgPerUnit: '', qty: '' })
    expect(wierszNastepny([line(), line({ qty: '' })])).toBeNull()
    expect(wierszNastepny([])).toBeNull()
  })
  it('braki: kolejność z ekranu, słowami operatora, numer pozycji jak w kolumnie Lp.; brak braków ⇔ walidacja bez błędów', () => {
    const pusty = nowyFormularz('2026-10-30')
    expect(braki(pusty).map(b => [b.cel, b.opis])).toEqual([
      [{ pole: 'client' }, 'wybierz klienta'],
      [{ pole: 'p', i: 0 }, 'wpisz pierwszą pozycję'],
    ])
    // Pusty wiersz w środku nie dostaje numeru — druga pozycja na ekranie to „poz. 2”, choć to trzeci wiersz.
    const f = { ...pusty, clientId: 'c1', deliveryDate: '2026-10-29', lines: [line(), kolejnaPozycja(), line({ qty: '2,5' }), line({ kgPerUnit: '', qty: '', id: 'L4' }), line({ recipeId: '' })] }
    expect(braki(f).map(b => [b.cel, b.opis])).toEqual([
      [{ pole: 'deliveryDate' }, 'popraw termin wyjazdu — jest przed datą zamówienia'],
      [{ pole: 'q', i: 2 }, 'poz. 2 — ilość w pełnych sztukach'],
      [{ pole: 'q', i: 3 }, 'poz. 3 — wpisz ilość'],
      [{ pole: 'r', i: 4 }, 'poz. 4 — wybierz recepturę'],
    ])
    expect(braki({ ...f, deliveryDate: '', lines: [line({ qty: '0' })] }).map(b => b.opis)).toEqual(['poz. 1 — ilość musi być większa od zera'])
    const ok = { ...pusty, clientId: 'c1', lines: [line(), kolejnaPozycja(line())] }
    expect(braki(ok)).toEqual([])
    expect(walidacja(ok)).toEqual({})
    expect(Object.keys(walidacja(f)).length > 0).toBe(true)
  })
  it('termin wyjazdu: szybki wybór i opis słowami (dzień tygodnia, za ile dni)', () => {
    expect(poDniach('2026-10-30', 1)).toBe('2026-10-31')
    expect(poDniach('2026-10-24', 1)).toBe('2026-10-25') // zmiana czasu w nocy na 25.10 nie przesuwa dnia
    expect(poDniach('2026-12-31', 2)).toBe('2027-01-02')
    expect(opisTerminu('', '2026-10-30')).toBe('')
    expect(opisTerminu('2026-10-30', '2026-10-30')).toBe('dziś · piątek')
    expect(opisTerminu('2026-10-31', '2026-10-30')).toBe('jutro · sobota')
    expect(opisTerminu('2026-11-01', '2026-10-30')).toBe('pojutrze · niedziela')
    expect(opisTerminu('2026-11-02', '2026-10-30')).toBe('poniedziałek · za 3 dni')
    expect(opisTerminu('2026-10-29', '2026-10-30')).toBe('wczoraj · czwartek')
    expect(opisTerminu('2026-10-25', '2026-10-30')).toBe('niedziela · 5 dni temu')
    const dni = najblizszeDni('2026-10-30')
    expect(dni.map(d => d.dzien)).toEqual(['sobota', 'niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek'])
    expect(dni[0]).toMatchObject({ iso: '2026-10-31', dzienMies: '31.10', rel: 'jutro' })
    expect(dni[6]).toMatchObject({ iso: '2026-11-06', dzienMies: '06.11', rel: '' })
  })
})
