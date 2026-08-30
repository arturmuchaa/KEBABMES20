import { describe, it, expect } from 'vitest'
import {
  STORAGE_STATES, czyCzerwone, etykietaStanu, magazynStanu, progPrzyjecia,
  normalizeStan, type StorageState,
} from './storageState'

describe('normalizeStan', () => {
  it('pustemu i nieznanemu stanowi przypisuje chłodzony', () => {
    expect(normalizeStan(undefined)).toBe('chlodzony')
    expect(normalizeStan('')).toBe('chlodzony')
    expect(normalizeStan('zamrozony')).toBe('chlodzony')
  })

  it('przepuszcza znane stany', () => {
    expect(normalizeStan('mrozony')).toBe('mrozony')
    expect(normalizeStan('chlodzony')).toBe('chlodzony')
  })
})

describe('etykietaStanu', () => {
  it('nazywa oba stany po polsku', () => {
    expect(etykietaStanu('chlodzony')).toBe('Chłodzony')
    expect(etykietaStanu('mrozony')).toBe('Mrożony')
  })

  it('brak stanu czyta jak chłodzony (tak jechały wszystkie dostawy przed zmianą)', () => {
    expect(etykietaStanu(undefined)).toBe('Chłodzony')
  })
})

describe('magazynStanu', () => {
  it('kieruje do pomieszczeń z zestawienia zakładu', () => {
    expect(magazynStanu('chlodzony').nr).toBe(3)
    expect(magazynStanu('mrozony').nr).toBe(6)
  })

  it('podaje temperaturę pomieszczenia, nie progu przyjęcia', () => {
    expect(magazynStanu('mrozony').temp).toBe('−18 °C')
    expect(magazynStanu('chlodzony').temp).toBe('do +3 °C')
  })
})

describe('progPrzyjecia', () => {
  it('drób chłodzony: +4 °C (instrukcja 1.1)', () => {
    const p = progPrzyjecia('drob', 'chlodzony')
    expect(p.maxC).toBe(4)
    expect(p.opis).toBe('≤ +4 °C')
    expect(p.wKsiedze).toBe(true)
  })

  it('mięso czerwone chłodzone: +7 °C (instrukcja 1.1)', () => {
    const p = progPrzyjecia('czerwone', 'chlodzony')
    expect(p.maxC).toBe(7)
    expect(p.opis).toBe('≤ +7 °C')
    expect(p.wKsiedze).toBe(true)
  })

  it('mrożony: −12 °C, ale oznaczony jako próg SPOZA księgi', () => {
    // Instrukcja 1.1 podaje progi wyłącznie dla mięsa chłodzonego. Dopóki
    // szef nie dopisze zdania o surowcu mrożonym, karta nie może udawać,
    // że ten próg z niej pochodzi.
    const p = progPrzyjecia('czerwone', 'mrozony')
    expect(p.maxC).toBe(-12)
    expect(p.opis).toBe('≤ −12 °C')
    expect(p.wKsiedze).toBe(false)
  })

  it('mrożony wygrywa nad kategorią — blok wołowy i blok drobiowy tak samo', () => {
    expect(progPrzyjecia('drob', 'mrozony')).toEqual(progPrzyjecia('czerwone', 'mrozony'))
  })

  it('nieznana kategoria czyta się jak drób (jedyna sprzed zmiany)', () => {
    expect(progPrzyjecia(undefined, 'chlodzony').maxC).toBe(4)
  })
})

describe('czyCzerwone', () => {
  it('rozpoznaje mięso czerwone po kategorii słownika', () => {
    expect(czyCzerwone('czerwone')).toBe(true)
    expect(czyCzerwone('drob')).toBe(false)
    expect(czyCzerwone(undefined)).toBe(false)
  })
})

describe('STORAGE_STATES', () => {
  it('daje kolejność dla selecta: chłodzony pierwszy', () => {
    expect(STORAGE_STATES).toEqual<StorageState[]>(['chlodzony', 'mrozony'])
  })
})
