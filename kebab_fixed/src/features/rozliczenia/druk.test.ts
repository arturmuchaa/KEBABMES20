import { describe, it, expect } from 'vitest'
import { dataPl, kwota } from './druk'

describe('kwota na wydruku rozliczeń', () => {
  it('euro ze zwykłą spacją tysięcy i przecinkiem', () => {
    expect(kwota(1234.5, 'EUR')).toBe('1 234,50 €')
  })

  it('minus typograficzny (U+2212) i złote', () => {
    expect(kwota(-38447.7, 'PLN')).toBe('−38 447,70 zł')
  })

  it('pełne tysiące też z separatorem', () => {
    expect(kwota(1000, 'PLN')).toBe('1 000,00 zł')
  })

  it('zero bez minusa', () => {
    expect(kwota(-0.001, 'PLN')).toBe('0,00 zł')
  })
})

describe('dataPl', () => {
  it('RRRR-MM-DD → DD.MM.RRRR', () => {
    expect(dataPl('2026-11-09')).toBe('09.11.2026')
    expect(dataPl('2026-11-09T12:30:00')).toBe('09.11.2026')
  })

  it('pusta data → pusty tekst', () => {
    expect(dataPl('')).toBe('')
    expect(dataPl(null)).toBe('')
  })
})

describe('chwila wydruku', () => {
  it('data i godzina po polsku, z zerami wiodącymi', async () => {
    const { chwilaWydruku } = await import('./druk')
    expect(chwilaWydruku(new Date(2026, 10, 2, 7, 5))).toBe('02.11.2026, 07:05')
  })
})
