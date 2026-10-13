import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import QRCode from 'qrcode'
import type { FinishedUnitCard, LabelTemplate } from '@/lib/api'
import { SAMPLE_UNIT_QR, UNIT_QR_OPTIONS } from '@/features/labels/unitQr'
import { buildVectorPdf } from './LabelPrintPage'

let result: Blob
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    result = blob as Blob
    return 'blob:labels-test'
  })
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).includes('Bold') ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf'
    return new Response(await readFile(`src/assets/fonts/${name}`))
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const mm = 72 / 25.4
const units: FinishedUnitCard[] = ['53ee8a8fb1ef460c93ed', 'd19a778424e44f3089dc', 'c4f86e97a4b74e3b9159'].map(id => ({
  id, qrCode: `U|${id}`, status: 'planned', clientName: 'Truva', productTypeId: '',
  recipeId: 'r1', tuleja: '', weightKg: 20, batchNo: '622', trolleyId: null,
  cartonId: null, cartonNo: '', producedAt: '2026-10-13',
}))

async function fixture(width: number, height: number): Promise<LabelTemplate> {
  const src = await PDFDocument.create()
  const page = src.addPage([width, height])
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40 })
  return {
    id: 'truva', clientId: 'Truva', recipeId: 'r1', kind: 'overlay', zpl: '',
    backgroundPdf: await src.saveAsBase64({ dataUri: true }), backgroundData: '',
    fieldPositions: { qr: { x: 5.1, y: 85.7, size: 35 }, weight: { x: 30.8, y: 19.6, size: 45 } },
    pageSize: 'a4', labelsPerSheet: 2,
    slotOffsets: [{ dx: 0, dy: 0 }, { dx: 47.5, dy: 0 }],
    printCalib: { fit: false, scale: 100 },
  }
}

async function render(template: LabelTemplate) {
  const qrMap = Object.fromEntries(await Promise.all(units.map(async u => [
    u.id, await QRCode.toDataURL(u.qrCode, UNIT_QR_OPTIONS),
  ])))
  await buildVectorPdf(template, units, 2, 365, qrMap)
  return PDFDocument.load(await result.arrayBuffer())
}

// Odczyt rzeczywistych rozmiarów obrazów z operatorów gotowego PDF (bez mocka pdf-lib).
function images(doc: PDFDocument, pageIndex: number) {
  const contents = doc.getPage(pageIndex).node.lookup(PDFName.of('Contents'))
  const streams = contents instanceof PDFArray
    ? contents.asArray().map(ref => doc.context.lookup(ref) as PDFRawStream)
    : [contents as PDFRawStream]
  const text = streams.map(s => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
  return [...text.matchAll(/q\s+([\s\S]*?)\s+Q/g)]
    .map(m => m[1]).filter(block => /\/Image-[^\s]+ Do/.test(block))
    .map(block => {
      const matrices = [...block.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g)]
        .map(m => m.slice(1).map(Number))
      return {
        width: matrices.reduce((s, m) => s * m[0], 1) / mm,
        height: matrices.reduce((s, m) => s * m[3], 1) / mm,
        x: matrices[0][4] / mm,
        y: matrices[0][5] / mm,
      }
    })
}

describe('PDF etykiet — rozmiar w edytorze = rozmiar na A4', () => {
  it.each([
    ['Truva z Excela', 734.52, 1039.56],
    ['A4', 210 * mm, 297 * mm],
    ['mniejsze tło', 400, 500],
  ])('%s: 35 mm QR i dwie etykiety bez dopasowywania przez drukarkę', async (_, w, h) => {
    const doc = await render(await fixture(w, h))
    expect(doc.getPageCount()).toBe(2)
    for (const page of doc.getPages()) {
      expect(page.getWidth() / mm).toBeCloseTo(210, 5)
      expect(page.getHeight() / mm).toBeCloseTo(297, 5)
    }
    const first = images(doc, 0)
    expect(first).toHaveLength(2)
    expect(images(doc, 1)).toHaveLength(1)
    for (const box of first) {
      expect(box.width).toBeCloseTo(35, 5)
      expect(box.height).toBeCloseTo(35, 5)
    }
    expect(first[0].x).toBeCloseTo(210 * 0.051, 5)
    expect(first[1].x - first[0].x).toBeCloseTo(210 * 0.475, 5)
  })

  it('zachowuje kalibrację i niezależne ustawienia QR drugiej etykiety', async () => {
    const tpl = await fixture(734.52, 1039.56)
    tpl.printCalib = { scale: 98, dxMm: 2, dyMm: 1 }
    tpl.slotFieldPositions = { '1': { qr: { x: 60, y: 70, size: 40 } } }
    const boxes = images(await render(tpl), 0)
    expect(boxes[0].width).toBeCloseTo(34.3, 5)
    expect(boxes[1].width).toBeCloseTo(39.2, 5)
    expect(boxes[1].height).toBeCloseTo(39.2, 5)
    expect(boxes[1].x).toBeCloseTo(105 + 2 + (126 - 105) * 0.98, 5)
  })

  it('próbny QR ma gęstość rzeczywistej sztuki i własny prefix testowy', () => {
    const sample = QRCode.create(SAMPLE_UNIT_QR, UNIT_QR_OPTIONS)
    const real = QRCode.create(units[0].qrCode, UNIT_QR_OPTIONS)
    expect(sample.modules.size).toBe(real.modules.size)
    expect(SAMPLE_UNIT_QR.startsWith('U|')).toBe(false)
  })
})
