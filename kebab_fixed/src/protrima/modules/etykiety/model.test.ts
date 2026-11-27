import { describe, expect, it } from 'vitest'
import type { LabelDesign, LabelField, UnitForLabel } from '@/lib/api'
import { PRZYKLAD, nowySzablon, polePlotna, poZaEtykieta, przesun, rozmiarStrony, wartosciPol } from './model'

const unit: UnitForLabel = {
  id: 'u3', qrCode: 'U|u3', qrSeq: 3, planLineId: 'l1', linePosition: 1, batchNo: '724', recipeName: 'KIRMIZI',
  productTypeName: 'KEBAB UDO 100%', packagingName: 'METAL 65CM', clientName: 'YALCIN', weightKg: 40,
  producedDate: '2026-11-28', status: 'planned', labelPrintedAt: null, shelfLifeDays: 364,
}
const pole = (p: Partial<LabelField>): LabelField => ({ id: 'f', kind: 'weight', xMm: 10, yMm: 10, sizePt: 20, ...p })

describe('wartości pól etykiety', () => {
  it('waga, partia, daty z receptury, numer sztuki', () => {
    const w = wartosciPol(unit, { razem: 29, orgCode: 'HAL-7' })
    expect(w.weight).toBe('40 kg')
    expect(w.batch).toBe('281126 724')
    expect(w.prod_date).toBe('28.11.2026')
    expect(w.freeze_date).toBe('28.11.2026')
    expect(w.best_before).toBe('27.11.2027')
    expect(w.unit_no).toBe('3/29')
    expect(w.org_code).toBe('HAL-7')
    expect(w.qr).toBe('U|u3')
    expect(w.client).toBe('YALCIN')
    expect(w.recipe).toBe('KIRMIZI')
  })
  it('waga ułamkowa bez zbędnych zer', () => {
    expect(wartosciPol({ ...unit, weightKg: 12.5 }, {}).weight).toBe('12,5 kg')
  })
  it('przykład do podglądu ma wszystkie wartości', () => {
    const w = wartosciPol(PRZYKLAD, { razem: 29 })
    expect(w.batch).toMatch(/^\d{6} \d+/)
    expect(w.best_before).not.toBe('')
  })
})

describe('geometria', () => {
  const a4: LabelDesign = { ...nowySzablon('a4'), clientId: 'cz', labelsPerSheet: 2 }
  const zebra: LabelDesign = { ...nowySzablon('zebra'), clientId: 'cy', widthMm: 100, heightMm: 150 }

  it('rozmiar strony: A4 zawsze 210 × 297 (także dla tła nie-A4), Zebra z szablonu', () => {
    expect(rozmiarStrony(a4)).toEqual({ w: 210, h: 297 })
    expect(rozmiarStrony(zebra)).toEqual({ w: 100, h: 150 })
  })
  it('slot 2: domyślnie +105 mm, nadpisanie pozycji pola', () => {
    const f = pole({ id: 'w' })
    expect(polePlotna(a4, f, 1)).toMatchObject({ xMm: 115, yMm: 10 })
    const z = { ...a4, slot2Fields: { w: { ...f, xMm: 120, yMm: 12 } } }
    expect(polePlotna(z, f, 1)).toMatchObject({ xMm: 120, yMm: 12 })
    expect(polePlotna(z, f, 0)).toMatchObject({ xMm: 10, yMm: 10 })
  })
  it('pole poza etykietą: QR 30 mm od x = 85 mm na Zebrze 100 mm', () => {
    expect(poZaEtykieta(zebra, pole({ kind: 'qr', xMm: 85, yMm: 10, qrMm: 30 }))).toBe(true)
    expect(poZaEtykieta(zebra, pole({ kind: 'qr', xMm: 60, yMm: 10, qrMm: 30 }))).toBe(false)
  })
  it('przesuń: krok i obcięcie do strony', () => {
    expect(przesun(pole({ xMm: 10 }), 0.5, 0, zebra).xMm).toBe(10.5)
    expect(przesun(pole({ xMm: 99 }), 5, 0, zebra).xMm).toBe(100)
    expect(przesun(pole({ yMm: 1 }), 0, -5, zebra).yMm).toBe(0)
  })
})
