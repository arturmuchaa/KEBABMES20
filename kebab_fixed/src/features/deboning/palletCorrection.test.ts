/**
 * Walidacja formularza korekty palety — to samo, czego pilnuje backend,
 * tylko pokazane od razu w oknie, zanim biuro kliknie „Zapisz".
 */
import { describe, it, expect } from 'vitest'
import { correctionIssues } from './palletCorrection'

const lots = (...pary: [string, number][]) => pary.map(([lotNo, kg]) => ({ lotNo, kg }))

describe('correctionIssues', () => {
  it('poprawna korekta nie zgłasza nic', () => {
    expect(correctionIssues(200, lots(['503', 200]), 'brak pojemników')).toEqual([])
  })

  it('suma składu musi się zgadzać z wagą palety', () => {
    const out = correctionIssues(200, lots(['503', 150]), 'powód')
    expect(out.some(s => s.includes('150') && s.includes('200'))).toBe(true)
  })

  it('tolerancja zaokrągleń jak w backendzie', () => {
    expect(correctionIssues(200, lots(['503', 200.03]), 'powód')).toEqual([])
  })

  it('paleta bez składu nie mówi masowni nic', () => {
    expect(correctionIssues(200, [], 'powód').some(s => s.includes('skład'))).toBe(true)
  })

  it('powód jest obowiązkowy', () => {
    expect(correctionIssues(200, lots(['503', 200]), '  ').some(s => s.includes('powód'))).toBe(true)
  })

  it('partia bez numeru albo z zerowa wagą to niedokończony wiersz', () => {
    expect(correctionIssues(200, lots(['', 200]), 'powód').some(s => s.includes('numer'))).toBe(true)
    expect(correctionIssues(200, lots(['503', 0]), 'powód').some(s => s.includes('kilogram'))).toBe(true)
  })

  it('ta sama partia dwa razy to pomyłka, nie skład', () => {
    const out = correctionIssues(200, lots(['503', 100], ['503', 100]), 'powód')
    expect(out.some(s => s.includes('503') && s.includes('dwa razy'))).toBe(true)
  })

  it('zerowa waga palety nie ma sensu', () => {
    expect(correctionIssues(0, lots(['503', 0]), 'powód').some(s => s.includes('Waga'))).toBe(true)
  })
})
