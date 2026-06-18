import { describe, it, expect } from 'vitest'
import { validateScanLocally } from './validateScanLocally'

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
