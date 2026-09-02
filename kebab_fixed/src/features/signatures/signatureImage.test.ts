import { describe, expect, it } from 'vitest'
import { bounds, isBlank } from './signatureImage'

/** Płótno RGBA wypełnione przezroczystością, z zamalowanymi pikselami. */
function plotno(w: number, h: number, piksele: [number, number][]) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (const [x, y] of piksele) d[(y * w + x) * 4 + 3] = 255
  return d
}

describe('bounds', () => {
  it('puste płótno nie ma zawartości', () => {
    expect(bounds(plotno(10, 10, []), 10, 10)).toBe(null)
  })
  it('jeden piksel daje ramkę o zerowej rozpiętości', () => {
    expect(bounds(plotno(10, 10, [[4, 6]]), 10, 10)).toEqual({ x0: 4, y0: 6, x1: 4, y1: 6 })
  })
  it('ramka obejmuje skrajne piksele', () => {
    const d = plotno(10, 10, [[2, 3], [7, 8], [5, 1]])
    expect(bounds(d, 10, 10)).toEqual({ x0: 2, y0: 1, x1: 7, y1: 8 })
  })
  it('piksel przezroczysty się nie liczy', () => {
    const d = plotno(10, 10, [[4, 4]])
    d[(4 * 10 + 4) * 4 + 3] = 0
    expect(bounds(d, 10, 10)).toBe(null)
  })
  it('rysunek dotykający krawędzi mieści się w ramce', () => {
    const d = plotno(10, 10, [[0, 0], [9, 9]])
    expect(bounds(d, 10, 10)).toEqual({ x0: 0, y0: 0, x1: 9, y1: 9 })
  })
})

describe('isBlank', () => {
  it('puste płótno jest puste', () => {
    expect(isBlank(plotno(10, 10, []), 10, 10)).toBe(true)
  })
  it('płótno z rysunkiem nie jest puste', () => {
    expect(isBlank(plotno(10, 10, [[1, 1]]), 10, 10)).toBe(false)
  })
})
