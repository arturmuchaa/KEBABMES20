import { describe, expect, it } from 'vitest'
import type { SeasonedPallet } from '@/lib/api'
import { etykietaPaletyZpl, etykietaSztukiZpl, numerKebaba } from './etykiety'

describe('numer kebaba', () => {
  it('ddmmrr i partia', () => {
    expect(numerKebaba('2026-11-27', 'PP7')).toBe('271126 PP7')
    expect(numerKebaba('2026-11-27', '355/356')).toBe('271126 355/356')
  })
})

describe('etykieta sztuki 100 × 150', () => {
  const zpl = etykietaSztukiZpl({
    id: 'abc', qrCode: 'U|abc', qrSeq: 3, razem: 20, planLineId: 'l1', linePosition: 1, batchNo: '724',
    recipeName: 'KIRMIZI', productTypeName: 'KEBAB 40', packagingName: 'METAL 65', clientName: 'YALCIN',
    weightKg: 40, producedDate: '2026-11-27', status: 'planned', labelPrintedAt: null,
  })
  it('ma QR sztuki, polskie znaki i rozmiar rolki', () => {
    expect(zpl).toContain('^FDQA,U|abc')
    expect(zpl).toContain('^CI28')
    expect(zpl).toContain('^PW799')
    expect(zpl).toContain('^LL1199')
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
})

describe('etykieta palety / końcówki', () => {
  const p: SeasonedPallet = {
    id: 'k1', qr: 'SP|k1', palletNo: 57, batchNo: '724', recipeId: 'kir', recipeName: 'KIRMIZI', seasonedMeatId: 'sm',
    kgWeighed: 24, status: 'in_cold', isRemainder: true, parentId: 'p41', parentPalletNo: 41, labelPrintedAt: null,
    takenAt: null, takenBy: '', takenPlanId: null, returnedAt: null, kgReturned: null,
    mixedAt: '2026-11-26T08:00:00+01:00', materialName: 'UDO',
  }
  it('końcówka ma QR palety i swoje pochodzenie', () => {
    const zpl = etykietaPaletyZpl(p)
    expect(zpl).toContain('^FDQA,SP|k1')
    expect(zpl).toContain('KOŃCÓWKA z palety 41')
    expect(zpl).toContain('PALETA 57')
    expect(zpl).toContain('24 kg')
    expect(zpl).toContain('26.11.2026')
  })
  it('zwykła paleta bez dopisku końcówki', () => {
    expect(etykietaPaletyZpl({ ...p, isRemainder: false, parentPalletNo: null })).not.toContain('KOŃCÓWKA')
  })
})
