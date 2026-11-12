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
  it('czas polski niezależnie od strefy przeglądarki (render PDF na serwerze w UTC)', async () => {
    const { chwilaWydruku } = await import('./druk')
    // 13:23 UTC w listopadzie (CET, UTC+1) = 14:23 w Polsce
    expect(chwilaWydruku(new Date(Date.UTC(2026, 10, 12, 13, 23)))).toBe('12.11.2026, 14:23')
    // tuż przed północą UTC to już następny dzień w Polsce
    expect(chwilaWydruku(new Date(Date.UTC(2026, 10, 11, 23, 5)))).toBe('12.11.2026, 00:05')
    // lato (CEST, UTC+2), zera wiodące
    expect(chwilaWydruku(new Date(Date.UTC(2026, 6, 2, 5, 7)))).toBe('02.07.2026, 07:07')
  })
})
