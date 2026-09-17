import { describe, it, expect } from 'vitest'
import { MACHINES, OVER_KG, T_MIX_MIN, fitsMachine, waterWindow, batchNoFromLots } from './machines'

describe('masownice', () => {
  it('trzy maszyny: 200, 200, 600 kg', () => {
    expect(MACHINES.map(m => [m.id, m.cap])).toEqual([[1, 200], [2, 200], [3, 600]])
  })

  it('cykl masowania to 50 minut', () => {
    expect(T_MIX_MIN).toBe(50)
  })

  it('wsad mieści się do nominału plus cichy zapas', () => {
    expect(fitsMachine(600, 600)).toBe(true)
    expect(fitsMachine(630, 600)).toBe(true)
    expect(fitsMachine(600 + OVER_KG + 0.1, 600)).toBe(false)
  })
})

describe('waterWindow', () => {
  it('okno dozownika to ±3% dawki', () => {
    expect(waterWindow(100)).toEqual({ min: 97, max: 103 })
  })

  it('przy małej dawce okno nie schodzi poniżej 0,5 L', () => {
    expect(waterWindow(10)).toEqual({ min: 9.5, max: 10.5 })
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
