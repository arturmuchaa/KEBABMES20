import { describe, expect, it } from 'vitest'
import { scalPozycjeWz } from './wzLineMerge'

/** Pozycja WZ w kształcie, jaki idzie na dokument. */
const p = (over: Partial<any> = {}): any => ({
  name: 'KEBAB UDO KIRMIZI 40kg', unit: 'szt', qty: 10,
  price: 12, value: 120, kg_per_unit: 40, total_kg: 400,
  vat_rate: 5, batch_no: '190826 487', stock_type: 'fg', ...over,
})

describe('scalPozycjeWz — sumowanie pozycji', () => {
  it('ten sam towar z RÓŻNYCH partii schodzi jako jedna pozycja', () => {
    // Właściciel (2026-09-02): „chciałem aby pozycje się sumowały na WZ,
    // 6 i 14 pokazuje 20 szt". Rozbicie na partie daje sekcja pod tabelą.
    const out = scalPozycjeWz([
      p({ qty: 6, batch_no: '190826 487', total_kg: 240, value: 72 }),
      p({ qty: 14, batch_no: '220826 495', total_kg: 560, value: 168 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe(20)
    expect(out[0].total_kg).toBe(800)
    expect(out[0].value).toBe(240)
  })

  it('sumuje też trzy partie', () => {
    const out = scalPozycjeWz([
      p({ qty: 6, batch_no: 'a' }), p({ qty: 14, batch_no: 'b' }), p({ qty: 10, batch_no: 'c' }),
    ])
    expect(out.map(l => l.qty)).toEqual([30])
  })

  it('tuleja NIESTANDARDOWA zostaje osobną pozycją', () => {
    // Znacznik siedzi w nazwie, a nazwa jest w kluczu scalania — dlatego
    // 80 cm nie wpada do worka ze standardem.
    const out = scalPozycjeWz([
      p({ qty: 14, name: 'KEBAB UDO KIRMIZI 40kg' }),
      p({ qty: 6, name: 'KEBAB UDO KIRMIZI 40kg (80cm)' }),
    ])
    expect(out).toHaveLength(2)
    expect(out.map(l => [l.name, l.qty])).toEqual([
      ['KEBAB UDO KIRMIZI 40kg', 14],
      ['KEBAB UDO KIRMIZI 40kg (80cm)', 6],
    ])
  })

  it('różna stawka VAT NIE scala — podsumowanie rozbija kwoty po stawkach', () => {
    const out = scalPozycjeWz([p({ vat_rate: 5 }), p({ vat_rate: 23 })])
    expect(out).toHaveLength(2)
  })

  it('różna cena NIE scala', () => {
    const out = scalPozycjeWz([p({ price: 12 }), p({ price: 14 })])
    expect(out).toHaveLength(2)
  })

  it('różna waga sztuki NIE scala', () => {
    const out = scalPozycjeWz([p({ kg_per_unit: 40 }), p({ kg_per_unit: 30 })])
    expect(out).toHaveLength(2)
  })

  it('nie modyfikuje pozycji wejściowych', () => {
    const wej = [p({ qty: 6 }), p({ qty: 14 })]
    scalPozycjeWz(wej)
    expect(wej.map(l => l.qty)).toEqual([6, 14])
  })

  it('pusta lista zostaje pusta', () => {
    expect(scalPozycjeWz([])).toEqual([])
  })

  it('pozycja bez ceny nie dostaje wartości z powietrza', () => {
    const out = scalPozycjeWz([
      p({ qty: 6, price: null, value: null }),
      p({ qty: 14, price: null, value: null }),
    ])
    expect(out[0].qty).toBe(20)
    expect(out[0].value == null).toBe(true)
  })
})
