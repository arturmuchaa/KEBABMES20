import { describe, it, expect } from 'vitest'
import { dostepnyDla, ALL_MODULES, NAV_SECTIONS } from './modules'

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

describe('nawigacja boczna', () => {
  it('Rozrachunki w sekcji Sprzedaż, za dokumentami', () => {
    const sprzedaz = NAV_SECTIONS.find(s => s.label === 'Sprzedaż')!
    expect(sprzedaz.keys).toEqual(['zamowienia', 'kontrahenci', 'wysylki', 'dokumenty', 'rozrachunki'])
  })
  it('każdy klucz nawigacji to istniejący moduł, bez powtórzeń', () => {
    const klucze = NAV_SECTIONS.flatMap(s => s.keys)
    expect(new Set(klucze).size).toBe(klucze.length)
    for (const k of klucze) expect(ALL_MODULES.some(m => m.key === k)).toBe(true)
  })
})
