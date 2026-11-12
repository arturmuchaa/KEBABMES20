/**
 * Szczegóły dokumentu (D12): pigułka stanu w kafelku „Termin” nie może wychodzić poza kafelek.
 *
 * 12.11.2026 (zrzuty Task 6): okno ma stałą szerokość, kafelki dzielą ją na pięć,
 * a `.tag` ma `white-space: nowrap` — „zapłacona po 51 dniach” była ucięta na krawędzi
 * okna (1366 i 1920). jsdom nie liczy układu, więc strażnik czyta regułę z arkusza.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../styles/modules.css'), 'utf-8')

function regula(selektor: string): string {
  const i = css.indexOf(`${selektor} {`)
  expect(i, `brak reguły ${selektor}`).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('}', i))
}

describe('kafelki szczegółów dokumentu', () => {
  it('pigułka stanu w kafelku łamie się w nim zamiast wychodzić poza ramkę', () => {
    const r = regula('.rr-dok-kafle .rr-sum .s .tag')
    expect(r).toMatch(/white-space:\s*normal/)
    expect(r).toMatch(/height:\s*auto/)
    expect(r).toMatch(/max-width:\s*100%/)
  })
})
