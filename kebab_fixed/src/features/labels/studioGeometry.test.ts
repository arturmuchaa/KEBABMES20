import { describe, expect, it } from 'vitest'
import { mmToPercent, percentToMm, moveField } from './studioGeometry'

describe('Studio: mm are a compatible view over legacy coordinates', () => {
  it('roundtrips fractional legacy coordinates without rounding stored values', () => {
    for (const axis of ['x', 'y'] as const) {
      for (const value of [0, 12.3456789, 50, 100]) {
        expect(mmToPercent(percentToMm(value, axis), axis)).toBeCloseTo(value, 12)
      }
    }
  })
  it('moves without jumping the marker origin; snapping is opt-in', () => {
    const position = { x: 10.123, y: 20.456 }
    const moved = moveField(position, 2.5, 4.25)
    expect(moved.x).toBeCloseTo(12.623)
    expect(moved.y).toBeCloseTo(24.706)
    expect(position).toEqual({ x: 10.123, y: 20.456 })
    const snapped = moveField(position, 2.5, 4.25, 1)
    expect(percentToMm(snapped.x, 'x')).toBeCloseTo(27)
    expect(percentToMm(snapped.y, 'y')).toBeCloseTo(73)
  })
  it('bounds invalid positioning without changing page geometry', () => {
    expect(moveField({ x: 0, y: 100 }, -10, 10)).toEqual({ x: 0, y: 100 })
    expect(() => mmToPercent(NaN, 'x')).toThrow()
    expect(() => mmToPercent(Infinity, 'y')).toThrow()
  })
})
