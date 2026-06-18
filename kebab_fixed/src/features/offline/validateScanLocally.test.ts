import { describe, it, expect } from 'vitest'
import { validateScanLocally, validateScanPerLine } from './validateScanLocally'

describe('validateScanLocally — offline sprawdzanie skanu sztuki', () => {
  const eligible = new Set(['U|a', 'U|b', 'U|c'])

  it('uprawniona i nieskanowana → OK', () => {
    expect(validateScanLocally({ code: 'U|a', eligible, scanned: new Set() }))
      .toEqual({ ok: true })
  })

  it('nie na liście uprawnionych → nie pasuje', () => {
    const r = validateScanLocally({ code: 'U|zzz', eligible, scanned: new Set() })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/nie pasuje/i)
  })

  it('już zeskanowana w tej sesji → dubel', () => {
    const r = validateScanLocally({ code: 'U|a', eligible, scanned: new Set(['U|a']) })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/już/i)
  })

  it('dubel ma pierwszeństwo przed brakiem na liście', () => {
    const r = validateScanLocally({ code: 'U|x', eligible, scanned: new Set(['U|x']) })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/już/i)
  })
})

describe('validateScanPerLine — offline walidacja per pozycja kartonu mieszanego', () => {
  // Karton mix: pozycja A (10kg, 1 wolne) i pozycja B (15kg, 2 wolne).
  const lines = () => [
    { lineId: 'A', eligible: new Set(['U|a1', 'U|a2']), remaining: 1 },
    { lineId: 'B', eligible: new Set(['U|b1', 'U|b2']), remaining: 2 },
  ]

  it('sztuka pasująca do wolnej pozycji → OK', () => {
    expect(validateScanPerLine({ code: 'U|a1', lines: lines(), scanned: [] })).toEqual({ ok: true })
  })

  it('sztuka nie pasująca do żadnej pozycji → nie pasuje', () => {
    const r = validateScanPerLine({ code: 'U|zzz', lines: lines(), scanned: [] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/nie pasuje/i)
  })

  it('dubel → już zeskanowana', () => {
    const r = validateScanPerLine({ code: 'U|a1', lines: lines(), scanned: ['U|a1'] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/już/i)
  })

  it('pozycja pełna (przekroczone remaining) → odrzuć, choć sztuka uprawniona', () => {
    // pozycja A ma 1 wolne; jedna sztuka A już w kolejce → druga A nie wejdzie.
    const r = validateScanPerLine({ code: 'U|a2', lines: lines(), scanned: ['U|a1'] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/pełna|miejsca/i)
  })

  it('inna pozycja ma miejsce, gdy pierwsza pełna → OK (nie blokuje całego kartonu)', () => {
    // A pełna (a1 w kolejce), ale b1 trafia do B który ma 2 wolne.
    const r = validateScanPerLine({ code: 'U|b1', lines: lines(), scanned: ['U|a1'] })
    expect(r).toEqual({ ok: true })
  })
})
