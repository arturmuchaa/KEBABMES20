/**
 * Kilogramy bez ozdobnego zera.
 *
 * Na ekranie zamówień pozycja czytała się „20 × 35,0" i „700,0 kg" — przecinek
 * zero nic nie wnosi, a rozbija wzrok przy szybkim przeglądaniu listy. Ucinamy
 * końcowe zera, ale NIE zaokrąglamy: 8,5 kg/szt to prawdziwa waga sztuki.
 */
import { describe, it, expect } from 'vitest'
import { fmtKgTrim } from './utils'

describe('fmtKgTrim', () => {
  it('okrągłą wagę pokazuje bez przecinka', () => {
    expect(fmtKgTrim(35)).toBe('35')
    expect(fmtKgTrim(700)).toBe('700')
  })

  it('nie zaokrągla realnych połówek', () => {
    expect(fmtKgTrim(8.5)).toBe('8,5')
    expect(fmtKgTrim(0.25)).toBe('0,25')
  })

  it('ucina tylko zera na końcu', () => {
    expect(fmtKgTrim(8.50)).toBe('8,5')
    expect(fmtKgTrim(340.05)).toBe('340,05')
  })

  it('czyta stringi z backendu', () => {
    expect(fmtKgTrim('700.00')).toBe('700')
    expect(fmtKgTrim('8.50')).toBe('8,5')
  })

  it('grupuje tysiące tak samo jak fmtKg', () => {
    expect(fmtKgTrim(12000)).toBe('12 000')
  })

  it('zero to zero, nie pusty napis', () => {
    expect(fmtKgTrim(0)).toBe('0')
  })
})
