import { describe, it, expect } from 'vitest'
import { poPolsku } from './tlumaczenia'

const psk = (s: string) => `{http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords}${s}`
const km = (s: string) => `{http://www.konicaminolta.com/printing/schema}${s}`

describe('opcje drukarki po polsku', () => {
  it('słowa Print Schema — zawsze po polsku, nawet gdy sterownik podał angielską nazwę', () => {
    expect(poPolsku(psk('PageInputBin'), 'Paper Source')).toBe('Zasobnik papieru')
    expect(poPolsku(psk('Monochrome'), 'Black and White')).toBe('Czarno-biało')
    expect(poPolsku(psk('TwoSidedLongEdge'), '2-Sided')).toBe('Dwustronnie (długa krawędź)')
    expect(poPolsku(psk('ISOA4'), 'A4 (210 x 297 mm)')).toBe('A4')
    expect(poPolsku(psk('ISOA3'), 'ISOA3')).toBe('A3')
  })
  it('opcje Konica: z nazwy sterownika albo z identyfikatora', () => {
    expect(poPolsku(km('Tray1'), 'Tray 1')).toBe('Zasobnik 1')
    expect(poPolsku(km('Tray4'), 'Tray4')).toBe('Zasobnik 4')
    expect(poPolsku(km('Bypass'), 'Bypass Tray')).toBe('Taca boczna (ręczna)')
    expect(poPolsku(km('Res600'), 'Res600')).toBe('600 dpi')
    expect(poPolsku(km('Thick1'), 'Thick 1 (106-163g/m2)')).toBe('Gruby 1 (106-163g/m2)')
    expect(poPolsku(km('StapleCorner'), 'StapleCorner')).toBe('Zszywanie w rogu')
    expect(poPolsku(km('Colored'), 'Colored')).toBe('Kolorowy')
  })
  it('nieznana nazwa zostaje taka, jak podał sterownik (także polska)', () => {
    expect(poPolsku(km('Xyz'), 'Specjalny tryb')).toBe('Specjalny tryb')
    expect(poPolsku(km('Q'), 'Quantum Mode')).toBe('Quantum Mode')
  })
})
