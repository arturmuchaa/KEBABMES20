import { describe, it, expect } from 'vitest'
import { splitEvenly, wrappingIssues, wrappedTotal } from './wrapping'

describe('splitEvenly', () => {
  it('dwóch foliowczyków dzieli po połowie', () => {
    expect(splitEvenly(8000, 2)).toEqual([4000, 4000])
  })

  it('trzech — suma zgadza się CO DO KILOGRAMA, reszta do pierwszego', () => {
    const c = splitEvenly(1000, 3)
    expect(c.reduce((s, x) => s + x, 0)).toBe(1000)
    expect(c).toEqual([333.34, 333.33, 333.33])
  })

  it('jedna osoba bierze całość', () => {
    expect(splitEvenly(4321.5, 1)).toEqual([4321.5])
  })

  it('zero kilogramów i brak ludzi nie wybuchają', () => {
    expect(splitEvenly(0, 2)).toEqual([0, 0])
    expect(splitEvenly(1000, 0)).toEqual([])
  })
})

describe('wrappingIssues', () => {
  const s = (kg: number) => ({ workerId: 'w', workerName: 'VLAD', kg })

  it('poprawny wpis przechodzi', () => {
    expect(wrappingIssues([s(4000)], 8000)).toEqual([])
  })

  it('sam zero to brak wpisu', () => {
    expect(wrappingIssues([s(0)], 8000)).toContain('Wpisz kilogramy przynajmniej jednej osobie')
  })

  it('ujemne odrzucone', () => {
    expect(wrappingIssues([s(-5), s(10)], 8000)).toContain('Kilogramy nie mogą być ujemne')
  })

  it('wpis znacznie większy niż dzień jest kwestionowany', () => {
    expect(wrappingIssues([s(20000)], 8000)[0]).toMatch(/sprawdź wpis/)
  })

  it('trochę więcej niż dzień przechodzi — foliuje się też wczorajszą resztę', () => {
    expect(wrappingIssues([s(8400)], 8000)).toEqual([])
  })

  it('dzień bez produkcji nie blokuje wpisu foliowania', () => {
    expect(wrappingIssues([s(500)], 0)).toEqual([])
  })
})

describe('wrappedTotal', () => {
  it('sumuje kilogramy foliowczyków', () => {
    expect(wrappedTotal([{ kg: 4000 }, { kg: 3500.5 }])).toBe(7500.5)
  })
  it('pusto daje zero, nie NaN', () => {
    expect(wrappedTotal([])).toBe(0)
  })
})
