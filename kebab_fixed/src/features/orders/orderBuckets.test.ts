import { describe, it, expect } from 'vitest'
import { podzielZamowienia, zamkniete } from './orderBuckets'

const z = (id: string, status: string) => ({ id, status })

describe('podział zamówień', () => {
  it('bieżące to szkic, potwierdzone i w produkcji', () => {
    const { biezace } = podzielZamowienia([
      z('a', 'draft'), z('b', 'confirmed'), z('c', 'in_production'),
    ])
    expect(biezace.map(o => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('zrealizowane i anulowane schodzą z listy bieżących', () => {
    const { biezace, zamkniete: zam } = podzielZamowienia([
      z('a', 'confirmed'), z('b', 'done'), z('c', 'cancelled'),
    ])
    expect(biezace.map(o => o.id)).toEqual(['a'])
    expect(zam.map(o => o.id)).toEqual(['b', 'c'])
  })

  it('kolejność z wejścia zostaje zachowana — sortowanie robi ekran', () => {
    const { zamkniete: zam } = podzielZamowienia([z('x', 'done'), z('y', 'done')])
    expect(zam.map(o => o.id)).toEqual(['x', 'y'])
  })

  it('nieznany status traktujemy jak bieżący — lepiej pokazać za dużo niż schować', () => {
    expect(zamkniete({ status: 'cos_nowego' })).toBe(false)
    expect(podzielZamowienia([z('a', '')]).biezace).toHaveLength(1)
  })

  it('pusta lista nie wywraca się', () => {
    expect(podzielZamowienia([])).toEqual({ biezace: [], zamkniete: [] })
  })
})
