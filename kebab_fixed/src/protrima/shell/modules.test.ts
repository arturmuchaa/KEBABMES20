import { describe, it, expect } from 'vitest'
import { dostepnyDla, ALL_MODULES } from './modules'

describe('moduły tylko dla administratora', () => {
  it('Użytkownicy i uprawnienia — tylko administrator (jak w starym MES: Użytkownicy, Audyt)', () => {
    expect(dostepnyDla('uzytkownicy', 'admin')).toBe(true)
    expect(dostepnyDla('uzytkownicy', 'office')).toBe(false)
    expect(dostepnyDla('uzytkownicy', null)).toBe(false)
  })
  it('pozostałe moduły — każde konto biura', () => {
    for (const m of ALL_MODULES.filter(x => x.key !== 'uzytkownicy')) expect(dostepnyDla(m.key, 'office')).toBe(true)
  })
})
