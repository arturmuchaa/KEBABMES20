import { describe, it, expect } from 'vitest'
import { planLayout, ROW_MAX, ROW_MIN, ROW_GAP } from './planLayout'

// Wysokość obszaru listy = ekran − nagłówek − pasek dnia − marginesy
// (production-hmi.css: paski 52 px do 760 px wysokości, 58 px do 820, potem 76).
const H720 = 720 - 2 * 52 - 20
const H768 = 768 - 2 * 58 - 20
const H1080 = 1080 - 2 * 76 - 32
/** Pasek zmian planu (44 px + odstęp) zabiera wysokość liście. */
const zPaskiem = (h: number) => h - 44 - 12

const miesciSie = (n: number, h: number) => {
  const u = planLayout(n, h)
  return u.rows * u.rowH + (u.rows - 1) * ROW_GAP <= h && !u.scroll && u.cols * u.rows >= n
}

describe('planLayout', () => {
  it('mały plan: jedna kolumna dużych wierszy, bez billboardu', () => {
    const u = planLayout(1, H1080)
    expect(u.cols).toBe(1)
    expect(u.rowH).toBe(ROW_MAX)
    expect(u.density).toBe('L')
  })

  it('10 pozycji na 1920×1080 — jedna kolumna', () => {
    expect(planLayout(10, H1080).cols).toBe(1)
  })

  it('30 pozycji — dwie kolumny po 15, nie 30 mikroskopijnych wierszy', () => {
    const u = planLayout(30, H720)
    expect(u.cols).toBe(2)
    expect(u.rows).toBe(15)
  })

  it.each([1, 10, 15, 20, 30])('%i pozycji mieści się bez przewijania na 1280×720, 1366×768 i 1920×1080', n => {
    for (const h of [H720, H768, H1080]) expect(miesciSie(n, h)).toBe(true)
  })

  it.each([1, 10, 15, 20, 30])('%i pozycji mieści się także z paskiem zmian planu', n => {
    for (const h of [H720, H768, H1080]) expect(miesciSie(n, zPaskiem(h))).toBe(true)
  })

  it('10 pozycji na 1280×720 — wciąż jedna kolumna', () => {
    expect(planLayout(10, H720).cols).toBe(1)
  })

  it('wiersz nigdy nie schodzi poniżej celu dotykowego', () => {
    for (const n of [1, 10, 15, 20, 30]) for (const h of [H720, H768, H1080]) {
      expect(planLayout(n, h).rowH).toBeGreaterThanOrEqual(ROW_MIN)
    }
  })

  it('ponad 30 pozycji na małym ekranie — JAWNE przewijanie, żadna pozycja nie ginie', () => {
    const u = planLayout(45, H720)
    expect(u.scroll).toBe(true)
    expect(u.cols * u.rows).toBeGreaterThanOrEqual(45)
  })

  it('przed pomiarem: układ zachowawczy, bez przewijania', () => {
    expect(planLayout(5, null)).toMatchObject({ cols: 1, scroll: false })
    expect(planLayout(30, null)).toMatchObject({ cols: 2, rows: 15 })
  })

  it('pusty plan', () => {
    expect(planLayout(0, H720).rows).toBe(0)
  })
})
