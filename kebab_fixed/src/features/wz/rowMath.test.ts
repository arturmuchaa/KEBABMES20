import { describe, it, expect } from 'vitest'

import {
  fmtKg3, fmtKgPl, fmtMoneyPl, rowKg, rowQty, rowValue, sanitizeDecimal, sanitizeInt,
  toNum, type WzRow,
} from './rowMath'

const fg = (over: Partial<WzRow> = {}): WzRow => ({
  stockType: 'fg', stockId: 'g1', name: 'Kebab 10kg', unit: 'szt',
  qtyStr: '40', priceStr: '12,50', available: 100, kgPerUnit: 10, ...over,
})
const raw = (over: Partial<WzRow> = {}): WzRow => ({
  stockType: 'raw', stockId: 'b1', name: 'Grzbiety', unit: 'kg',
  qtyStr: '320,5', priceStr: '1,20', available: 400, ...over,
})

describe('toNum — liczby wpisywane po polsku', () => {
  it('przyjmuje przecinek i kropkę', () => {
    expect(toNum('3,25')).toBe(3.25)
    expect(toNum('3.25')).toBe(3.25)
  })

  it('śmieci i pustka to zero, nie NaN na dokumencie', () => {
    expect(toNum('')).toBe(0)
    expect(toNum('abc')).toBe(0)
  })
})

describe('sanitizeDecimal / sanitizeInt — co wolno wpisać w siatkę', () => {
  it('zostawia jeden separator dziesiętny', () => {
    expect(sanitizeDecimal('1,2,3')).toBe('1,23')
    expect(sanitizeDecimal('12a,5')).toBe('12,5')
  })

  it('pojemniki to sztuki — same cyfry', () => {
    expect(sanitizeInt('12,5')).toBe('125')
    expect(sanitizeInt('a7b')).toBe('7')
  })
})

describe('rowKg — waga pozycji', () => {
  it('wyrób gotowy liczy się przez wagę sztuki', () => {
    expect(rowKg(fg())).toBe(400)          // 40 szt × 10 kg
  })

  it('surowiec jest już w kilogramach', () => {
    expect(rowKg(raw())).toBe(320.5)
  })

  it('sztuki bez wagi jednostkowej nie udają kilogramów', () => {
    expect(rowKg(fg({ kgPerUnit: undefined }))).toBe(0)
  })
})

describe('rowValue — wartość pozycji', () => {
  it('wyrób gotowy wyceniany ZA KILOGRAM, nie za sztukę', () => {
    // 40 szt × 10 kg × 12,50 zł/kg = 5000 zł. Wycena za sztukę dałaby 500 zł.
    expect(rowValue(fg())).toBe(5000)
  })

  it('surowiec: kilogramy razy stawka', () => {
    expect(rowValue(raw())).toBeCloseTo(384.6, 2)
  })

  it('pozycja bez wagi liczy się po jednostkach', () => {
    expect(rowValue(fg({ kgPerUnit: undefined, qtyStr: '3', priceStr: '10' }))).toBe(30)
  })
})

describe('rowQty', () => {
  it('czyta ilość wpisaną po polsku', () => {
    expect(rowQty(raw({ qtyStr: '1 000,5'.replace(' ', '') }))).toBe(1000.5)
  })
})

describe('fmtKg3 — kilogramy na ekranie', () => {
  it('okrągłe bez ogona, ułamkowe do trzech miejsc', () => {
    expect(fmtKg3(400)).toBe('400')
    expect(fmtKg3(320.5)).toBe('320.5')
  })
})


describe('fmtKgPl / fmtMoneyPl — liczby na ekranie po polsku', () => {
  it('kilogramy z przecinkiem, jak w siatce i w stopce', () => {
    // Stopka pokazywała „1430.5 kg", a siatka tuż nad nią „1430,5 kg".
    expect(fmtKgPl(1430.5)).toBe('1430,5')
    expect(fmtKgPl(900)).toBe('900')
  })

  it('kwoty zawsze z dwoma miejscami i przecinkiem', () => {
    expect(fmtMoneyPl(0)).toBe('0,00')
    expect(fmtMoneyPl(5384.6)).toBe('5384,60')
  })
})
