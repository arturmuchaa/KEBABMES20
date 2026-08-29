import { describe, it, expect } from 'vitest'

import { receptionTagZpl } from './receptionTagZpl'
import { zplPreviewBoxes } from './zplPreview'

/**
 * Podgląd na ekranie rysujemy Z TEGO SAMEGO ZPL, który leci na drukarkę.
 * Ręcznie odwzorowany układ rozjeżdżał się z wydrukiem przy pierwszej
 * zmianie fontu, a biuro wypuszczało stos etykiet w ciemno.
 */
describe('zplPreviewBoxes — ZPL → pola do narysowania', () => {
  it('przelicza pozycję tekstu z punktów drukarki na milimetry', () => {
    const [pole] = zplPreviewBoxes('^XA^FO24,48^A0N,40,40^FDtest^FS^XZ')

    expect(pole).toMatchObject({ kind: 'text', text: 'test' })
    expect(pole.xMm).toBeCloseTo(3, 1)
    expect(pole.yMm).toBeCloseTo(6, 1)
    expect(pole.fontMm).toBeCloseTo(5, 1)
  })

  it('czyta kreski oddzielające sekcje', () => {
    const [pole] = zplPreviewBoxes('^XA^FO24,140^GB352,5,5^FS^XZ')

    expect(pole.kind).toBe('line')
    expect(pole.widthMm).toBeCloseTo(44, 0)
  })

  it('pomija nagłówek etykiety — to komendy drukarki, nie treść', () => {
    const boxes = zplPreviewBoxes('^XA^CI28^PW400^LL639^LH0,0^MNY^LS0^FO24,20^A0N,26,26^FDA^FS^XZ')

    expect(boxes).toHaveLength(1)
  })

  it('oddaje całą zawieszkę — tyle pól, ile drukarka narysuje', () => {
    const boxes = zplPreviewBoxes(receptionTagZpl({
      receptionNo: '12/08/2026', supplierName: 'KOKO', batchNo: '471',
      netKg: 540, containers: 36, containerKg: 15,
      palletIndex: 1, palletCount: 6, batchKg: 3000,
      slaughterDate: '2026-08-04', expiryDate: '2026-08-18', receivedDate: '2026-08-12',
    }))

    const teksty = boxes.filter(b => b.kind === 'text').map(b => b.text)
    expect(teksty).toContain('471')
    expect(teksty).toContain('Partia dostawcy')
    // Pięć kresek: pod dostawcą, numerem porządkowym, wagą, paletą i partią dostawcy.
    expect(boxes.filter(b => b.kind === 'line')).toHaveLength(5)
    // Nic nie wychodzi poza taśmę — ten sam warunek, co na drukarce.
    expect(boxes.every(b => b.yMm >= 0 && b.yMm < 80)).toBe(true)
  })
})

/**
 * Kilogramy na etykiecie palety mięsa idą blokiem `^FB` wyrównanym do prawej.
 * Podgląd, który tego nie rozumiał, pokazywał paletę BEZ kilogramów — czyli
 * kłamał w drugą stronę niż zwykle: etykieta drukowała się dobrze, a obraz na
 * ekranie wyglądał na błąd (29.08.2026).
 */
describe('zplPreviewBoxes — blok tekstu ^FB', () => {
  it('czyta tekst wyrównany do prawej razem z szerokością bloku', () => {
    const zpl = '^XA^FO24,184^A0N,65,65^FB352,1,0,R^FD170 kg^FS^XZ'
    const [box] = zplPreviewBoxes(zpl)
    expect(box.kind).toBe('text')
    expect(box.text).toBe('170 kg')
    expect(box.align).toBe('R')
    expect(box.widthMm).toBeCloseTo(44, 0)
  })

  it('zwykły tekst bez bloku nie dostaje wyrównania', () => {
    const [box] = zplPreviewBoxes('^XA^FO24,184^A0N,65,65^FD518^FS^XZ')
    expect(box.text).toBe('518')
    expect(box.align).toBeUndefined()
  })
})
