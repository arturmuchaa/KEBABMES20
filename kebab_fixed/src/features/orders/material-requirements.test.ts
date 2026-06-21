import { describe, it, expect } from 'vitest'
import { fmtRawList } from './material-requirements'

describe('fmtRawList', () => {
  it('łączy rodzaje surowca z kg', () => {
    const out = fmtRawList([
      { rawTypeId: 'mat-cwiartka', rawName: 'Ćwiartka z kurczaka', kgRaw: 140 },
      { rawTypeId: 'mat-filet-kurczak', rawName: 'Filet z kurczaka', kgRaw: 30 },
    ])
    expect(out).toContain('Ćwiartka')
    expect(out).toContain('140')
    expect(out).toContain('Filet')
  })

  it('pomija pozycje z zerowym kg', () => {
    const out = fmtRawList([
      { rawTypeId: 'mat-cwiartka', rawName: 'Ćwiartka z kurczaka', kgRaw: 140 },
      { rawTypeId: 'mat-filet-kurczak', rawName: 'Filet z kurczaka', kgRaw: 0 },
    ])
    expect(out).toContain('Ćwiartka')
    expect(out).not.toContain('Filet')
  })

  it('pusty wejściowy → kreska', () => {
    expect(fmtRawList([])).toBe('—')
  })
})
