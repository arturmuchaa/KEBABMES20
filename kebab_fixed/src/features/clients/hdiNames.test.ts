import { describe, it, expect } from 'vitest'
import { recipeNameOf, setRecipeName } from './hdiNames'

describe('własne nazwy receptur odbiorcy', () => {
  it('pusta lista nie ma nazwy dla żadnej receptury', () => {
    expect(recipeNameOf(undefined, 'r1')).toBe('')
    expect(recipeNameOf([], 'r1')).toBe('')
  })

  it('ustawienie nazwy dopisuje wpis', () => {
    expect(setRecipeName([], 'r1', 'BEYAZ')).toEqual([{ recipeId: 'r1', name: 'BEYAZ' }])
  })

  it('ponowne ustawienie podmienia, nie dubluje', () => {
    const po = setRecipeName([{ recipeId: 'r1', name: 'BEYAZ' }], 'r1', 'BEYAZ AF')
    expect(po).toEqual([{ recipeId: 'r1', name: 'BEYAZ AF' }])
  })

  it('wyczyszczone pole USUWA wpis — inaczej stara nazwa dalej schodzi na HDI', () => {
    expect(setRecipeName([{ recipeId: 'r1', name: 'BEYAZ' }], 'r1', '   ')).toEqual([])
  })

  it('nie rusza nazw innych receptur', () => {
    const po = setRecipeName([{ recipeId: 'r1', name: 'BEYAZ' }], 'r2', 'KIRMIZI')
    expect(recipeNameOf(po, 'r1')).toBe('BEYAZ')
    expect(recipeNameOf(po, 'r2')).toBe('KIRMIZI')
  })
})
