import { describe, expect, it } from 'vitest'
import { etykietaSztukiZpl, numerKebaba } from './etykiety'

describe('numer kebaba', () => {
  it('ddmmrr i partia', () => {
    expect(numerKebaba('2026-11-27', 'PP7')).toBe('271126 PP7')
    expect(numerKebaba('2026-11-27', '355/356')).toBe('271126 355/356')
  })
})

describe('etykieta sztuki 80 × 100 (rolka zawieszek, właściciel 27.11)', () => {
  const zpl = etykietaSztukiZpl({
    id: 'abc', qrCode: 'U|abc', qrSeq: 3, razem: 20, planLineId: 'l1', linePosition: 1, batchNo: '724',
    recipeName: 'KIRMIZI', productTypeName: 'KEBAB 40', packagingName: 'METAL 65', clientName: 'YALCIN',
    weightKg: 40, producedDate: '2026-11-27', status: 'planned', labelPrintedAt: null,
  })
  it('ma QR sztuki, polskie znaki i rozmiar rolki', () => {
    expect(zpl).toContain('^FDQA,U|abc')
    expect(zpl).toContain('^CI28')
    expect(zpl).toContain('^PW639')
    expect(zpl).toContain('^LL799')
  })
  it('ma numer kebaba, wagę i numer sztuki', () => {
    expect(zpl).toContain('271126 724')
    expect(zpl).toContain('40 kg')
    expect(zpl).toContain('3/20')
    expect(zpl).toContain('YALCIN')
    expect(zpl).toContain('27.11.2026')
  })
  it('dane nie rozbijają komend ZPL', () => {
    const z = etykietaSztukiZpl({
      id: 'x', qrCode: 'U|x', qrSeq: 1, razem: 1, planLineId: 'l', linePosition: 1, batchNo: '7^24',
      recipeName: 'A~B', productTypeName: '', packagingName: '', clientName: '', weightKg: 40,
      producedDate: '2026-11-27', status: 'planned', labelPrintedAt: null,
    })
    expect(z).not.toContain('7^24')
    expect(z).not.toContain('A~B')
  })

  it('mieści się na rolce: żadne pole nie zaczyna się poza 80 × 100 mm', () => {
    for (const m of zpl.matchAll(/\^FO(\d+),(\d+)/g)) {
      expect(Number(m[1])).toBeLessThan(639)
      expect(Number(m[2])).toBeLessThan(799)
    }
  })
  it('długi numer kebaba mix dostaje mniejszą czcionkę', () => {
    const mix = etykietaSztukiZpl({
      id: 'm', qrCode: 'U|m', qrSeq: 1, razem: 1, planLineId: 'l', linePosition: 1, batchNo: '355/356',
      recipeName: 'MIX', productTypeName: '', packagingName: '', clientName: '', weightKg: 40,
      producedDate: '2026-11-27', status: 'planned', labelPrintedAt: null,
    })
    const wys = (z: string, txt: string) => Number(new RegExp(`\\^A0N,(\\d+),\\d+\\^FD${txt.replace('/', '\\/')}`).exec(z)?.[1])
    expect(wys(mix, '271126 355/356')).toBeLessThan(wys(zpl, '271126 724'))
  })
})
