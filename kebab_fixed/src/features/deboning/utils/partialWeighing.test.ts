import { describe, expect, it } from 'vitest'
import { decideTakeSave } from './partialWeighing'

describe('decideTakeSave — jeden przycisk ZAPISZ + pytanie z %', () => {
  it('blokuje, gdy suma z już zważonym przekracza pobranie', () => {
    expect(decideTakeSave(100, 250, 300)).toBe('block')
  })
  it('blokuje bez porcji lub bez pobrania', () => {
    expect(decideTakeSave(0, 0, 300)).toBe('block')
    expect(decideTakeSave(0, 10, 0)).toBe('block')
  })
  it('pyta poniżej 63% (scenariusz z hali: 100 z 300 = 33%)', () => {
    expect(decideTakeSave(0, 100, 300)).toBe('ask')
  })
  it('pyta też przy kolejnej porcji, gdy łącznie wciąż < 63%', () => {
    expect(decideTakeSave(100, 60, 300)).toBe('ask') // 53%
  })
  it('domyka bez pytania w paśmie: 100 + 95 z 300 = 65%', () => {
    expect(decideTakeSave(100, 95, 300)).toBe('complete')
  })
  it('próg dokładnie 63% domyka bez pytania', () => {
    expect(decideTakeSave(0, 189, 300)).toBe('complete')
  })
})
