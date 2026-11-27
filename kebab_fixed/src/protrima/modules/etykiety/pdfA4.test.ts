import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { LabelDesign, LabelField } from '@/lib/api'
import { nowySzablon, PRZYKLAD } from './model'
import { punktPola, transformacjaA4, zbudujPdfA4 } from './pdfA4'

const MM = 72 / 25.4
const H = 297 * MM
const W = 210 * MM
const pole = (p: Partial<LabelField>): LabelField => ({ id: 'w', kind: 'weight', xMm: 32.2, yMm: 22.2, sizePt: 36, bold: true, ...p })
const szablon = (zm: Partial<LabelDesign> = {}): LabelDesign => ({ ...nowySzablon('a4'), clientId: 'cz', fields: [pole({})], ...zm })

async function pdfTla(wMm: number, hMm: number): Promise<string> {
  const doc = await PDFDocument.create()
  doc.addPage([wMm * MM, hMm * MM]).drawRectangle({ x: 10, y: 10, width: 50, height: 20 })
  return 'data:application/pdf;base64,' + Buffer.from(await doc.save()).toString('base64')
}

describe('silnik PDF A4', () => {
  it('kalibracja 100 % bez przesunięcia → przekształcenie tożsamościowe', () => {
    expect(transformacjaA4(szablon())).toEqual({ Sx: 1, Sy: 1, Tx: 0, Ty: 0 })
  })
  it('skala 99,5 % trzyma środek strony w miejscu', () => {
    const t = transformacjaA4(szablon({ calibration: { dxMm: 0, dyMm: 0, scale: 99.5 } }))
    expect(t.Tx + t.Sx * W / 2).toBeCloseTo(W / 2, 6)
    expect(t.Ty + t.Sy * H / 2).toBeCloseTo(H / 2, 6)
  })
  it('punkt pola: mm od lewego-górnego → pt od lewego-dolnego (linia bazowa)', () => {
    const p = punktPola(pole({}), transformacjaA4(szablon()))
    expect(p.xPt).toBeCloseTo(32.2 * MM, 2)
    expect(p.yPt).toBeCloseTo(H - 22.2 * MM - 36, 2)
    expect(p.sizePt).toBe(36)
  })
  it('3 sztuki po 2 na arkusz → 2 strony A4; tło nie-A4 (TRUVA 259 × 367) rozciągnięte na arkusz', async () => {
    const d = szablon({ labelsPerSheet: 2, backgroundPdf: await pdfTla(259, 367), fields: [pole({}), pole({ id: 'q', kind: 'qr', qrMm: 30, xMm: 5, yMm: 250 })] })
    const b64 = await zbudujPdfA4(d, [PRZYKLAD, { ...PRZYKLAD, id: 'b' }, { ...PRZYKLAD, id: 'c' }], { czcionki: null })
    const doc = await PDFDocument.load(Buffer.from(b64, 'base64'))
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getWidth()).toBeCloseTo(W, 1)
    expect(doc.getPage(0).getHeight()).toBeCloseTo(H, 1)
  })
})
