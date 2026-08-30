// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { DDFIP_COLS } from './DdfipRegisterPrintPage'

/**
 * Siatka karty 1.3.1 musi się zmieścić w kolumnie tekstu arkusza A4 poziomo
 * (283 mm). Szerokości są podawane ręcznie w milimetrach, więc dołożenie
 * kolumny bez odjęcia gdzie indziej wypycha ostatnią poza kartkę — i widać
 * to dopiero na wydruku, po zużyciu papieru.
 */
describe('karta 1.3.1 — siatka kolumn', () => {
  it('sumuje się dokładnie do szerokości kolumny tekstu', () => {
    expect(DDFIP_COLS.reduce((s, c) => s + c.w, 0)).toBe(283)
  })

  it('ma jedenaście kolumn a–k, dokładnie jak wzór z księgi', () => {
    expect(DDFIP_COLS.map(c => c.letter)).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'])
  })

  it('asortyment jest najszerszy — mieści kilka nazw po przecinku', () => {
    const asortyment = DDFIP_COLS.find(c => c.letter === 'c')!
    expect(Math.max(...DDFIP_COLS.map(c => c.w))).toBe(asortyment.w)
  })
})
