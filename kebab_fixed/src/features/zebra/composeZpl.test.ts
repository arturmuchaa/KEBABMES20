import { describe, it, expect } from 'vitest'
import { composeZpl, mmToDots, type ZplField } from './composeZpl'

describe('mmToDots', () => {
  it('203 dpi: 1mm ≈ 8 dots, 10mm = 80', () => {
    expect(mmToDots(10, 203)).toBe(80)
    expect(mmToDots(1, 203)).toBe(8)
  })
  it('300 dpi: 10mm ≈ 118', () => {
    expect(mmToDots(10, 300)).toBe(118)
  })
})

const textField = (over: Partial<ZplField> = {}): ZplField => ({
  id: 't', type: 'text', value: '[[PARTIA]]', xMm: 10, yMm: 20, fontMm: 4, ...over,
})
const qrField = (over: Partial<ZplField> = {}): ZplField => ({
  id: 'q', type: 'qr', value: '[[QR]]', xMm: 5, yMm: 5, mag: 4, ...over,
})

describe('composeZpl', () => {
  it('pole tekstowe → ^FO/^A0N/^FD na pozycji w dots', () => {
    const out = composeZpl({ backgroundZpl: '^XA^XZ', fields: [textField()], dpi: 203 })
    expect(out).toContain('^FO80,160^A0N,32,32^FD[[PARTIA]]^FS')
  })

  it('pole QR → ^BQ z magnifikacją', () => {
    const out = composeZpl({ backgroundZpl: '^XA^XZ', fields: [qrField()], dpi: 203 })
    expect(out).toContain('^FO40,40^BQN,2,4^FDQA,[[QR]]^FS')
  })

  it('zachowuje treść tła i kończy ^XZ raz', () => {
    const bg = '^XA^FO0,0^GFA,...,...^FS^XZ'
    const out = composeZpl({ backgroundZpl: bg, fields: [textField()], dpi: 203 })
    expect(out).toContain('^GFA,...,...')                 // tło zachowane
    expect(out.match(/\^XZ/g)?.length).toBe(1)            // dokładnie jeden ^XZ
    expect(out.trim().endsWith('^XZ')).toBe(true)
    // pole jest PRZED ^XZ (na wierzchu tła)
    expect(out.indexOf('[[PARTIA]]')).toBeLessThan(out.indexOf('^XZ'))
  })

  it('brak tła → owija w ^XA…^XZ', () => {
    const out = composeZpl({ backgroundZpl: '', fields: [textField()], dpi: 203 })
    expect(out.trim().startsWith('^XA')).toBe(true)
    expect(out.trim().endsWith('^XZ')).toBe(true)
    expect(out).toContain('[[PARTIA]]')
  })

  it('zachowuje placeholdery, escapuje ^ i ~ w tekście statycznym', () => {
    const out = composeZpl({
      backgroundZpl: '^XA^XZ',
      fields: [textField({ value: 'Lot: [[PARTIA]] ^~' })],
      dpi: 203,
    })
    expect(out).toContain('[[PARTIA]]')   // placeholder nietknięty
    expect(out).not.toContain('Lot: [[PARTIA]] ^~') // ^ ~ zamienione
    expect(out).toContain('Lot: [[PARTIA]]')
  })
})
