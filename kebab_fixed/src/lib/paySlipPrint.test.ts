import { describe, it, expect } from 'vitest'
import { settlementOverlapsRange, chunkIntoPages, pageCount } from './paySlipPrint'

describe('settlementOverlapsRange — filtr zakresu dat druku zbiorczego', () => {
  const s = { date_from: '2026-07-13', date_to: '2026-07-19' }

  it('okres w całości w zakresie', () => {
    expect(settlementOverlapsRange(s, '2026-07-01', '2026-07-31')).toBe(true)
  })

  it('zahacza początkiem lub końcem (brzegi włącznie)', () => {
    expect(settlementOverlapsRange(s, '2026-07-19', '2026-07-25')).toBe(true)
    expect(settlementOverlapsRange(s, '2026-07-06', '2026-07-13')).toBe(true)
  })

  it('całkowicie poza zakresem', () => {
    expect(settlementOverlapsRange(s, '2026-07-20', '2026-07-26')).toBe(false)
    expect(settlementOverlapsRange(s, '2026-07-06', '2026-07-12')).toBe(false)
  })

  it('pusty zakres = bez filtra (pokaż wszystko)', () => {
    expect(settlementOverlapsRange(s, '', '')).toBe(true)
    expect(settlementOverlapsRange(s, '2026-07-01', '')).toBe(true)
    expect(settlementOverlapsRange(s, '', '2026-07-12')).toBe(false)
  })
})

describe('chunkIntoPages — podział pasków na strony A4 po 4 (2×2)', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }))

  it('1 pasek → 1 strona dopełniona trzema pustymi', () => {
    const pages = chunkIntoPages(items(1))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toHaveLength(4)
    expect(pages[0].filter(x => x === null)).toHaveLength(3)
  })

  it('4 paski → 1 pełna strona bez pustych', () => {
    const pages = chunkIntoPages(items(4))
    expect(pages).toHaveLength(1)
    expect(pages[0].every(x => x !== null)).toBe(true)
  })

  it('5 pasków → 2 strony, druga z 3 pustymi', () => {
    const pages = chunkIntoPages(items(5))
    expect(pages).toHaveLength(2)
    expect(pages[1].filter(x => x === null)).toHaveLength(3)
  })

  it('12 pasków (typowa wypłata) → 3 pełne strony', () => {
    const pages = chunkIntoPages(items(12))
    expect(pages).toHaveLength(3)
    expect(pages.every(p => p.length === 4 && p.every(x => x !== null))).toBe(true)
  })

  it('0 pasków → 1 pusta strona (zachowanie dotychczasowego druku)', () => {
    const pages = chunkIntoPages([])
    expect(pages).toHaveLength(1)
    expect(pages[0]).toEqual([null, null, null, null])
  })

  it('kolejność zachowana wiersz po wierszu', () => {
    const pages = chunkIntoPages(items(6))
    expect(pages[0].map(x => (x ? x.id : null))).toEqual(['0', '1', '2', '3'])
    expect(pages[1].map(x => (x ? x.id : null))).toEqual(['4', '5', null, null])
  })
})

describe('pageCount — licznik kartek w stopce dialogu', () => {
  it('⌈n/4⌉, minimum 1', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(1)).toBe(1)
    expect(pageCount(4)).toBe(1)
    expect(pageCount(5)).toBe(2)
    expect(pageCount(12)).toBe(3)
    expect(pageCount(13)).toBe(4)
  })
})
