import { describe, it, expect } from 'vitest'
import { MACHINES, T_MIX_MIN, maszyna, fitsMachine, waterWindow, batchNoFromLots } from './machines'

describe('masownice', () => {
  it('trzy maszyny: 200, 200, 600 kg', () => {
    expect(MACHINES.map(m => [m.id, m.cap])).toEqual([[1, 200], [2, 200], [3, 600]])
  })

  it('cykl masowania to 50 minut', () => {
    expect(T_MIX_MIN).toBe(50)
  })

  it('dwójki biorą 200 kg standardu, najwyżej 250', () => {
    expect(MACHINES.filter(m => m.cap === 200).map(m => m.max)).toEqual([250, 250])
  })

  it('trójka bierze 600 kg standardu, najwyżej 700', () => {
    expect(maszyna(3)!.max).toBe(700)
  })

  it('wsad ponad maksimum maszyny nie przechodzi', () => {
    // Hala wrzuca czasem więcej niż nominał, ale ponad ten próg masownica
    // już nie miesza — blokujemy, zamiast pozwolić na przepełnienie.
    expect(fitsMachine(200, 1)).toBe(true)
    expect(fitsMachine(250, 1)).toBe(true)
    expect(fitsMachine(250.1, 1)).toBe(false)
    expect(fitsMachine(700, 3)).toBe(true)
    expect(fitsMachine(700.1, 3)).toBe(false)
  })

  it('nieznana maszyna nic nie przepuszcza', () => {
    expect(fitsMachine(10, 9)).toBe(false)
  })
})

describe('waterWindow', () => {
  it('odchył to pół litra, nie procent dawki', () => {
    // ±3% dawało przy 112 L widełki 108,6–115,4 — to nie dawka, tylko przedział.
    expect(waterWindow(112)).toEqual({ min: 111.5, max: 112.5 })
  })

  it('duża dawka ma tak samo wąskie okno jak mała', () => {
    expect(waterWindow(10)).toEqual({ min: 9.5, max: 10.5 })
    expect(waterWindow(600)).toEqual({ min: 599.5, max: 600.5 })
  })
})

describe('batchNoFromLots', () => {
  it('jeden wsad surowca → partia nosi jego numer', () => {
    expect(batchNoFromLots(['511'], 22)).toEqual({ no: '511', mixed: false })
  })

  it('dwa wsady → wspólny numer PP', () => {
    expect(batchNoFromLots(['511', '512'], 22)).toEqual({ no: 'PP23', mixed: true })
  })

  it('ta sama partia dwa razy to wciąż jeden wsad', () => {
    expect(batchNoFromLots(['511', '511'], 22)).toEqual({ no: '511', mixed: false })
  })

  it('bez partii nie zgaduje numeru', () => {
    expect(batchNoFromLots([], 22)).toEqual({ no: '', mixed: false })
  })
})
