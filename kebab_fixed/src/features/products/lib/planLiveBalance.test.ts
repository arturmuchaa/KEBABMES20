import { describe, it, expect } from 'vitest'
import { reservedByLot, withDayPool, liveFreeByLot } from './planLiveBalance'

const lot = (id: string, kgAvailable: number) => ({ id, kgAvailable })

describe('reservedByLot', () => {
  it('sumuje kg per partia z wielu wierszy', () => {
    const m = reservedByLot([
      { lots: [{ meatLotId: 'a', kgPlanned: 200 }, { meatLotId: 'b', kgPlanned: 100 }] },
      { lots: [{ meatLotId: 'a', kgPlanned: 50 }] },
    ])
    expect(m.get('a')).toBe(250)
    expect(m.get('b')).toBe(100)
  })

  it('pomija kg<=0 i puste id (wiersze done mają kgPlanned=0)', () => {
    const m = reservedByLot([
      { lots: [{ meatLotId: 'a', kgPlanned: 0 }, { meatLotId: '', kgPlanned: 10 }] },
    ])
    expect(m.size).toBe(0)
  })

  it('znosi null/undefined', () => {
    expect(reservedByLot(null).size).toBe(0)
    expect(reservedByLot(undefined).size).toBe(0)
  })
})

describe('withDayPool', () => {
  it('oddaje własne rezerwacje dnia do puli (kg_free + saved)', () => {
    // Partia 428: 1000 kg, plan dnia zarezerwował 600 → API kg_free=400.
    // Pula edytora = 400 + 600 = 1000 (nic nie znika po zapisie).
    const pool = withDayPool([lot('428', 400)], new Map([['428', 600]]))
    expect(pool[0].kgAvailable).toBe(1000)
  })

  it('partia w całości zarezerwowana przez ten plan wraca do puli (kg_free=0)', () => {
    const pool = withDayPool([lot('430', 0)], new Map([['430', 500]]))
    expect(pool).toHaveLength(1)
    expect(pool[0].kgAvailable).toBe(500)
  })

  it('partia zarezerwowana pod INNY dzień odpada (kg_free=0, saved=0)', () => {
    expect(withDayPool([lot('431', 0)], new Map())).toHaveLength(0)
  })

  it('nie modyfikuje wejścia i utrzymuje kolejność FEFO', () => {
    const input = [lot('a', 10), lot('b', 5)]
    const pool = withDayPool(input, new Map([['b', 1]]))
    expect(input[1].kgAvailable).toBe(5)
    expect(pool.map(l => l.id)).toEqual(['a', 'b'])
  })
})

describe('liveFreeByLot', () => {
  it('zaznaczenie schodzi na żywo, odznaczenie wraca', () => {
    const pool = [lot('428', 1000)]
    // zaznaczono KIRMIZI 600 kg z partii 428
    expect(liveFreeByLot(pool, new Map([['428', 600]])).get('428')).toBe(400)
    // odznaczono → wraca
    expect(liveFreeByLot(pool, new Map()).get('428')).toBe(1000)
  })

  it('szkic po wczytaniu zapisanego planu = kg_free z API (bez podwójnego odejmowania)', () => {
    // kg_free=400, saved=600 → pula 1000; szkic (niezmieniony) też bierze 600
    const pool = withDayPool([lot('428', 400)], new Map([['428', 600]]))
    expect(liveFreeByLot(pool, new Map([['428', 600]])).get('428')).toBe(400)
  })

  it('przekroczenie puli daje ujemne wolne (do podświetlenia)', () => {
    expect(liveFreeByLot([lot('a', 100)], new Map([['a', 150]])).get('a')).toBe(-50)
  })
})
