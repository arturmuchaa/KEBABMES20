import { describe, it, expect } from 'vitest'
import {
  tearOffZpl, tearOffMaxMm, CALIBRATE_ZPL, TEAR_OFF_MAX_DOTS,
} from './labelPrinterSetup'

describe('tearOffZpl — przesunięcie punktu odrywania', () => {
  it('milimetry przelicza na punkty drukarki (203 dpi)', () => {
    expect(tearOffZpl(2)).toBe('~TA016')
  })

  it('wartość ujemna cofa taśmę i zachowuje znak', () => {
    expect(tearOffZpl(-2)).toBe('~TA-016')
  })

  it('zero to zero, nie pusty parametr', () => {
    expect(tearOffZpl(0)).toBe('~TA000')
  })

  it('wartość zawsze trzycyfrowa — krótszą część firmware ignoruje', () => {
    expect(tearOffZpl(0.5)).toBe('~TA004')
  })

  it('przycina do limitu ZPL zamiast wysyłać nieprawidłową komendę', () => {
    expect(tearOffZpl(50)).toBe(`~TA${TEAR_OFF_MAX_DOTS}`)
    expect(tearOffZpl(-50)).toBe(`~TA-${TEAR_OFF_MAX_DOTS}`)
  })

  it('drukarka 300 dpi ma inne przeliczenie', () => {
    expect(tearOffZpl(2, 300)).toBe('~TA024')
  })
})

describe('tearOffMaxMm — ile milimetrów da się wyregulować', () => {
  it('203 dpi ≈ 15 mm w każdą stronę', () => {
    expect(tearOffMaxMm()).toBeCloseTo(15, 0)
  })

  it('300 dpi ≈ 10 mm', () => {
    expect(tearOffMaxMm(300)).toBeCloseTo(10.1, 1)
  })
})

describe('kalibracja', () => {
  it('to ~JC — drukarka sama mierzy etykietę i przerwę', () => {
    expect(CALIBRATE_ZPL).toBe('~JC')
  })
})
