import { describe, expect, it } from 'vitest'
import { validateDeboningEntry } from './index'

describe('validateDeboningEntry — furtka serwisowa', () => {
  it('blokuje nierealną wydajność bez kodu', () => {
    // 442/ANATOLII: 298,5 kg mięsa z 300 kg ćwiartki = 99,5%.
    expect(validateDeboningEntry(300, 298.5, 1000)).toMatch(/nierealna/)
  })

  it('blokuje zbyt niską wydajność bez kodu', () => {
    expect(validateDeboningEntry(300, 60, 1000)).toMatch(/niska/)
  })

  it('przepuszcza oba progi z kodem serwisowym', () => {
    // Bez tego kod serwisowy byłby fikcją: wpis odbiłby się tutaj, przed
    // wysyłką, i nigdy nie dotarłby do backendu.
    expect(validateDeboningEntry(300, 298.5, 1000, true)).toBeNull()
    expect(validateDeboningEntry(300, 60, 1000, true)).toBeNull()
  })

  it('nie omija granic fizycznych nawet z kodem', () => {
    expect(validateDeboningEntry(300, 320, 1000, true)).not.toBeNull()  // mięso > ćwiartka
    expect(validateDeboningEntry(300, 0, 1000, true)).not.toBeNull()    // mięso 0
    expect(validateDeboningEntry(0, 100, 1000, true)).not.toBeNull()    // ćwiartka 0
    expect(validateDeboningEntry(300, 200, 100, true)).not.toBeNull()   // ponad stan partii
  })
})
